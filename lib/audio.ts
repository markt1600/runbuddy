import type { Persona } from "./types";
import { recordLifetimePlay } from "./voiceLibrary";

// VoiceEngine — plays coach phrases on top of background music.
//
// iOS specifics:
// - navigator.audioSession.type = "ambient" lets our audio mix with the
//   Spotify / Podcasts app instead of pausing it. While actually speaking we
//   switch to "transient" so the music ducks under the voice, then restore.
// - A looping, near-silent <audio> element keeps the page's audio session
//   alive so Safari keeps running us (timers + GPS) when the phone is locked.
// - Pre-rendered ElevenLabs MP3s play via <audio>; if a phrase has no
//   rendered file we fall back to on-device speechSynthesis.

function setAudioSession(type: AudioSessionType) {
  try {
    if (navigator.audioSession) navigator.audioSession.type = type;
  } catch {
    // Older Safari / non-Safari: nothing to do.
  }
}

/** Build a 1-second near-silent WAV as a blob URL (keep-alive loop source). */
function makeSilentWavUrl(): string {
  const sampleRate = 8000;
  const samples = sampleRate; // 1 second
  const dataSize = samples * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  v.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  writeStr(36, "data");
  v.setUint32(40, dataSize, true);
  // amplitude 1 (out of 32767): inaudible but keeps the session "playing"
  for (let i = 0; i < samples; i++) v.setInt16(44 + i * 2, i % 2, true);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

// The engine currently attached to a run. The summary screen checks it so its
// own closing line waits for the trainer's sign-off instead of talking over it.
let activeEngine: VoiceEngine | null = null;

/** True while the run's trainer still has something to say. */
export function coachIsSpeaking(): boolean {
  return activeEngine?.busy ?? false;
}

/** Is the API that lets us duck or pause the runner's music available at all? */
export function audioSessionSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.audioSession;
}

/** What should happen to the music while the trainer talks. */
export type DuckMode = "duck" | "pause";

export class VoiceEngine {
  private keepAlive: HTMLAudioElement | null = null;
  private player: HTMLAudioElement | null = null;
  private queue: { text: string; audioUrl?: string }[] = [];
  private playing = false;
  private persona: Persona;
  private duckMode: DuckMode;
  private intentionalPause = false;
  speaking = false;
  onSpeakingChange: (speaking: boolean, text: string | null) => void = () => {};
  /** How each spoken line was served this run. */
  counts = { prerendered: 0, live: 0, synth: 0 };

  constructor(persona: Persona, duckMode: DuckMode = "pause") {
    this.persona = persona;
    this.duckMode = duckMode;
  }

  /**
   * "transient" asks iOS to duck the music under the voice; "transient-solo"
   * pauses it outright for the length of the line, which is what turn-by-turn
   * navigation does and is far easier to make out at running effort.
   */
  private get speakingSession(): AudioSessionType {
    return this.duckMode === "pause" ? "transient-solo" : "transient";
  }

  /**
   * Coming back from the camera roll or the lock button. iOS has torn the
   * audio session down and paused our elements without telling us, so
   * re-establish everything and get the queue moving again.
   */
  private onVisibility = () => {
    if (document.visibilityState !== "visible") return;
    setAudioSession(this.speaking ? this.speakingSession : "ambient");
    this.keepAlive?.play().catch(() => {});
    if (!this.playing && this.queue.length > 0) void this.drain();
  };

  /** The system pauses the keep-alive loop on interruption; start it again. */
  private onKeepAlivePause = () => {
    if (document.visibilityState === "visible") this.keepAlive?.play().catch(() => {});
  };

  /** Must be called from a user gesture (Start Run tap) to unlock audio on iOS. */
  start() {
    activeEngine = this;
    setAudioSession("ambient");
    const silence = makeSilentWavUrl();
    if (!this.keepAlive) {
      this.keepAlive = new Audio(silence);
      this.keepAlive.loop = true;
      this.keepAlive.volume = 0.01;
      this.keepAlive.addEventListener("pause", this.onKeepAlivePause);
    }
    this.keepAlive.play().catch(() => {});
    document.addEventListener("visibilitychange", this.onVisibility);

    // Unlock the phrase player in the same gesture. iOS only allows a
    // programmatic play() on an element that has already played once under a
    // user gesture — and with a delayed start the first phrase is 10 seconds
    // away, long past the activation window. Without this the very first MP3
    // is rejected, and because the element never got unlocked every phrase
    // after it fails too, so the whole run comes out in the robotic fallback
    // voice. Playing a moment of silence here is what buys the unlock.
    if (!this.player) this.player = new Audio();
    this.player.src = silence;
    this.player.volume = 0.01;
    void this.player
      .play()
      .then(() => {
        // Only tidy up if nothing real has claimed the element in the meantime.
        if (this.player && this.player.src === silence) {
          this.player.pause();
          this.player.currentTime = 0;
        }
        if (this.player) this.player.volume = 1;
      })
      .catch(() => {
        if (this.player) this.player.volume = 1;
      });

    // Prime speechSynthesis inside the gesture so later utterances are allowed
    if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      window.speechSynthesis.speak(u);
    }
  }

  stop() {
    if (activeEngine === this) activeEngine = null;
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.queue = [];
    this.intentionalPause = true;
    this.keepAlive?.removeEventListener("pause", this.onKeepAlivePause);
    this.player?.pause();
    this.keepAlive?.pause();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    this.setSpeaking(false, null);
    setAudioSession("ambient");
  }

  /**
   * End of run: drop the keep-alive loop but let whatever is already queued
   * play out. Calling stop() here would cut the trainer's sign-off off a few
   * hundred milliseconds in, which is all the time the summary screen takes to
   * appear.
   */
  stopWhenIdle(maxWaitMs = 15_000) {
    // Drop the restart handler first, or pausing the loop just starts it again.
    this.keepAlive?.removeEventListener("pause", this.onKeepAlivePause);
    this.keepAlive?.pause();
    const startedAt = Date.now();
    const check = () => {
      if (!this.busy || Date.now() - startedAt > maxWaitMs) {
        this.stop();
        return;
      }
      setTimeout(check, 200);
    };
    check();
  }

  /** True while anything is playing OR still waiting its turn. */
  get busy(): boolean {
    return this.speaking || this.queue.length > 0;
  }

  say(text: string, audioUrl?: string) {
    // Lines never overlap: drain() plays them strictly one at a time. The cap
    // only stops a backlog building up so far that the coach ends up narrating
    // a part of the run you've already left behind.
    if (this.queue.length >= 4) this.queue.shift();
    this.queue.push({ text, audioUrl });
    void this.drain();
  }

  private setSpeaking(s: boolean, text: string | null) {
    this.speaking = s;
    this.onSpeakingChange(s, text);
  }

  private async drain() {
    if (this.playing) return;
    this.playing = true;
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      setAudioSession(this.speakingSession); // get the music out of the way
      this.setSpeaking(true, item.text);
      let served: keyof typeof this.counts = !item.audioUrl
        ? "synth"
        : item.audioUrl.startsWith("data:")
          ? "live"
          : "prerendered";
      try {
        if (item.audioUrl) {
          await this.playFile(item.audioUrl);
        } else {
          await this.speakSynth(item.text);
        }
      } catch {
        // If the rendered file 404s or fails, fall back to synthesis once.
        if (item.audioUrl) {
          served = "synth";
          try {
            await this.speakSynth(item.text);
          } catch {
            /* give up on this phrase */
          }
        }
      }
      this.counts[served]++;
      recordLifetimePlay(served);
      this.setSpeaking(false, null);
      setAudioSession("ambient"); // un-duck the music
      await new Promise((r) => setTimeout(r, 400));
    }
    this.playing = false;
  }

  private playFile(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.player) this.player = new Audio();
      const p = this.player;
      let settled = false;
      let watchdog: ReturnType<typeof setTimeout>;

      // Every exit path has to go through here. iOS pauses media when the app
      // is backgrounded (camera, lock button) and fires neither "ended" nor
      // "error" — so a promise that only listens for those two never settles,
      // drain() waits on it forever, and the trainer goes silent for the rest
      // of the run no matter how much gets queued behind it.
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        p.onended = null;
        p.onerror = null;
        p.onpause = null;
        p.onloadedmetadata = null;
        fn();
      };
      const arm = (ms: number) => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => settle(() => reject(new Error("playback stalled"))), ms);
      };

      arm(20_000); // until we know the real duration
      p.onloadedmetadata = () => {
        if (isFinite(p.duration) && p.duration > 0) {
          arm(Math.min(p.duration * 1000 * 1.5 + 4000, 45_000));
        }
      };
      p.onended = () => settle(resolve);
      p.onerror = () => settle(() => reject(new Error("audio error")));
      p.onpause = () => {
        // Our own stop() pauses deliberately; anything else is an interruption.
        if (!p.ended && !this.intentionalPause) {
          settle(() => reject(new Error("interrupted")));
        }
      };
      p.src = url;
      p.play().catch((err) => settle(() => reject(err)));
    });
  }

  private speakSynth(text: string): Promise<void> {
    return new Promise((resolve) => {
      if (!("speechSynthesis" in window)) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = this.persona.tts.rate;
      u.pitch = this.persona.tts.pitch;
      u.lang = this.persona.tts.lang;
      const voices = window.speechSynthesis.getVoices();
      const match =
        voices.find((v) => v.lang === this.persona.tts.lang) ??
        voices.find((v) => v.lang.startsWith("en"));
      if (match) u.voice = match;
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        resolve();
      };
      // speechSynthesis drops "end" on the floor when it's interrupted by the
      // app going to the background — same stall as above.
      const watchdog = setTimeout(done, Math.min(text.length * 120 + 4000, 45_000));
      u.onend = done;
      u.onerror = done;
      window.speechSynthesis.speak(u);
    });
  }
}

export class WakeLockManager {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;
  private onVisibility = () => {
    if (this.wanted && document.visibilityState === "visible") void this.acquire();
  };

  async enable() {
    this.wanted = true;
    document.addEventListener("visibilitychange", this.onVisibility);
    await this.acquire();
  }

  private async acquire() {
    try {
      if ("wakeLock" in navigator) {
        this.sentinel = await navigator.wakeLock.request("screen");
      }
    } catch {
      // Low battery or unsupported — screen may sleep; keep-alive audio still runs.
    }
  }

  async disable() {
    this.wanted = false;
    document.removeEventListener("visibilitychange", this.onVisibility);
    try {
      await this.sentinel?.release();
    } catch {
      /* already released */
    }
    this.sentinel = null;
  }
}
