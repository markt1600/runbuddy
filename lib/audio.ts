import type { Persona } from "./types";
import { getVoiceVolume, recordLifetimePlay } from "./voiceLibrary";
import { runBuddyNative } from "./native";

// VoiceEngine — plays coach phrases on top of background music.
//
// Native shell: every clip goes through the plugin's AVAudioPlayer instead of
// an <audio> element. WebKit force-pauses page media the instant the screen
// locks and rejects play() while backgrounded — no session configuration
// changes that policy — so in-page playback can never survive a locked-phone
// run. Native playback can, and the plugin's looping silent buffer replaces
// the web keep-alive element for the same reason.
//
// iOS Safari specifics (the web path, unchanged):
// - navigator.audioSession.type = "ambient" lets our audio mix with the
//   Spotify / Podcasts app instead of pausing it. While actually speaking we
//   switch to "transient" so the music ducks under the voice, then restore.
//   Not "transient-solo": that INTERRUPTS the other app, and the web has no
//   setActive(false, .notifyOthersOnDeactivation) to tell it that it may come
//   back, so players were left paused for the rest of the run.
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

/** Wrap 16-bit mono PCM in a WAV container and hand back a blob URL. */
function wavBlobUrl(samples: Int16Array, sampleRate: number): string {
  const dataSize = samples.length * 2;
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
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, samples[i], true);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

/** A 1-second near-silent loop source that keeps the audio session alive. */
function makeSilentWavUrl(): string {
  const rate = 8000;
  const out = new Int16Array(rate);
  // amplitude 1 (out of 32767): inaudible but keeps the session "playing"
  for (let i = 0; i < out.length; i++) out[i] = i % 2;
  return wavBlobUrl(out, rate);
}

/** Two short beeps at the given pitches — the non-verbal pause / resume cue. */
function makeCueUrl(freqs: number[]): string {
  const rate = 22050;
  const toneN = Math.round(rate * 0.13);
  const gapN = Math.round(rate * 0.06);
  const fade = Math.round(rate * 0.012); // no clicks at the edges
  const out = new Int16Array(freqs.length * toneN + (freqs.length - 1) * gapN);
  let o = 0;
  for (let f = 0; f < freqs.length; f++) {
    for (let i = 0; i < toneN; i++) {
      const env = Math.min(1, i / fade, (toneN - i) / fade);
      out[o++] = Math.round(Math.sin((2 * Math.PI * freqs[f] * i) / rate) * 0.35 * env * 32767);
    }
    o += f < freqs.length - 1 ? gapN : 0;
  }
  return wavBlobUrl(out, rate);
}

// Built once, on first use — descending for a stop, ascending for a go.
let pauseCueUrl: string | null = null;
let resumeCueUrl: string | null = null;

/**
 * Buzz the phone. iOS Safari does not implement the Vibration API at all —
 * but the SHELL has the real haptic engine, so there the web-style pattern
 * maps onto iOS's semantic haptics: multi-pulse patterns (pause/resume,
 * record moments) become notification-style buzzes, single short pulses a
 * firm tap. Web keeps navigator.vibrate where it exists (Android).
 */
export function vibrate(pattern: number | number[]) {
  const native = runBuddyNative();
  if (native) {
    const pulses = Array.isArray(pattern) ? pattern.length : 1;
    const totalMs = Array.isArray(pattern)
      ? pattern.reduce((a, b) => a + b, 0)
      : pattern;
    void native.haptic({ kind: pulses >= 3 || totalMs >= 200 ? "success" : "medium" });
    return;
  }
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(pattern);
    }
  } catch {
    /* unsupported or blocked */
  }
}

/** Does this device have vibration at all? False on iPhone Safari, true in the shell. */
export function vibrationSupported(): boolean {
  if (runBuddyNative()) return true;
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
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

export class VoiceEngine {
  private keepAlive: HTMLAudioElement | null = null;
  private player: HTMLAudioElement | null = null;
  private queue: {
    text: string;
    audioUrl?: string;
    cue?: boolean;
    volume?: number;
    /** Whose line this is, when not the run persona — sets the synth fallback voice. */
    speaker?: Persona;
  }[] = [];
  private playing = false;
  private persona: Persona;
  private intentionalPause = false;
  /** True while the keep-alive loop is held down on purpose for ducking. */
  private duckHold = false;
  speaking = false;
  onSpeakingChange: (speaking: boolean, text: string | null) => void = () => {};
  /** How each spoken line was served this run. */
  counts = { prerendered: 0, live: 0, synth: 0 };

  constructor(persona: Persona) {
    this.persona = persona;
  }

  /** Mid-run trainer swap: later lines use the new voice's volume and TTS. */
  setPersona(persona: Persona) {
    this.persona = persona;
  }


  /**
   * Coming back from the camera roll or the lock button. iOS has torn the
   * audio session down and paused our elements without telling us, so
   * re-establish everything and get the queue moving again.
   */
  private onVisibility = () => {
    if (document.visibilityState !== "visible") return;
    setAudioSession(this.speaking ? "transient" : "ambient");
    // Mid-burst the phrase audio owns the session; restarting the keep-alive
    // here would keep it continuously active past the end of the burst, and a
    // session that never re-activates never applies the flip back to ambient.
    if (!this.duckHold) this.keepAlive?.play().catch(() => {});
    if (!this.playing && this.queue.length > 0) void this.drain();
  };

  /** The system pauses the keep-alive loop on interruption; start it again. */
  private onKeepAlivePause = () => {
    if (this.duckHold) return; // held down on purpose while the coach speaks
    // Safari-only (the shell's keep-alive is a native player): the visibility
    // gate stays because a hidden page fighting the system's pause just burns
    // battery, and WebKit refuses the play() anyway.
    if (document.visibilityState === "visible") {
      this.keepAlive?.play().catch(() => {});
    }
  };

  /** Must be called from a user gesture (Start Run tap) to unlock audio on iOS. */
  start() {
    activeEngine = this;
    document.addEventListener("visibilitychange", this.onVisibility);
    const native = runBuddyNative();
    if (native) {
      // Native shell: a real AVAudioSession (.playback + .mixWithOthers), a
      // native silent loop for the background-audio claim, and every clip
      // played by AVAudioPlayer — none of which needs a gesture unlock, and
      // none of which WebKit can pause when the screen locks. The web
      // keep-alive element and the unlock dance below are Safari-only.
      void native.configureAudio();
      void native.keepAliveStart();
    } else {
      setAudioSession("ambient");
      const silence = makeSilentWavUrl();
      if (!this.keepAlive) {
        this.keepAlive = new Audio(silence);
        this.keepAlive.loop = true;
        this.keepAlive.volume = 0.01;
        this.keepAlive.addEventListener("pause", this.onKeepAlivePause);
      }
      this.keepAlive.play().catch(() => {});

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
          // Volume is deliberately not restored here: playFile sets the persona's
          // level before every phrase, and this promise can resolve after one has
          // already started, which would stomp it back to full.
          if (this.player && this.player.src === silence) {
            this.player.pause();
            this.player.currentTime = 0;
          }
        })
        .catch(() => {});
    }

    // Prime speechSynthesis inside the gesture so later utterances are allowed
    // (still the fallback voice in the shell if a clip fails to decode).
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
    // Stopped mid-burst in the shell: silence the native player, drop the
    // background-audio claim, and make sure the music isn't left ducked.
    const native = runBuddyNative();
    if (native) {
      void native.stopPlayback();
      void native.keepAliveStop();
      void native.duckEnd();
    }
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
    // The run is over and the summary screen is up (foreground), so the
    // background-audio claim can go now; the sign-off still plays out.
    void runBuddyNative()?.keepAliveStop();
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

  /**
   * `volume` overrides the run persona's playback level for this one line —
   * cameo lines pass their own speaker's admin level, so a guest voice isn't
   * played at the host's setting.
   */
  say(text: string, audioUrl?: string, volume?: number, speaker?: Persona) {
    // Lines never overlap: drain() plays them strictly one at a time. The cap
    // only stops a backlog building up so far that the coach ends up narrating
    // a part of the run you've already left behind.
    if (this.queue.length >= 4) this.queue.shift();
    this.queue.push({
      text,
      audioUrl,
      volume: volume ?? (speaker ? getVoiceVolume(speaker.id) : undefined),
      speaker,
    });
    void this.drain();
  }

  /**
   * Queue a whole set piece (a duo argument runs 10–12 lines) past the
   * backlog cap. Only for scripted exchanges queued at a quiet moment —
   * everything still plays strictly one line at a time.
   */
  sayBatch(items: { text: string; audioUrl?: string; speaker?: Persona }[]) {
    for (const it of items) {
      this.queue.push({
        text: it.text,
        audioUrl: it.audioUrl,
        volume: it.speaker ? getVoiceVolume(it.speaker.id) : undefined,
        speaker: it.speaker,
      });
    }
    void this.drain();
  }

  /**
   * Drop everything waiting its turn, without cutting the line already being
   * spoken — ending a run mid-backlog shouldn't replay stale mid-run chatter
   * before the sign-off gets to talk.
   */
  clearPending() {
    this.queue = [];
  }

  /**
   * A short two-tone cue for a pause or a resume, queued ahead of whatever the
   * trainer is about to say about it. This is the part of "buzz on pause" that
   * an iPhone can actually deliver — Safari has no Vibration API — and it is
   * what tells you the clock stopped when the phone is in an arm sleeve.
   */
  cue(kind: "pause" | "resume") {
    if (!pauseCueUrl) pauseCueUrl = makeCueUrl([880, 587]); // falling: stopped
    if (!resumeCueUrl) resumeCueUrl = makeCueUrl([587, 880]); // rising: going
    this.queue.unshift({
      text: "",
      audioUrl: kind === "pause" ? pauseCueUrl : resumeCueUrl,
      cue: true,
    });
    void this.drain();
  }

  private setSpeaking(s: boolean, text: string | null) {
    this.speaking = s;
    this.onSpeakingChange(s, text);
  }

  private async drain() {
    if (this.playing) return;
    this.playing = true;
    const native = runBuddyNative();
    if (native) {
      // Native shell: the real thing. Re-activating the AVAudioSession with
      // .duckOthers is a system-level duck — no keep-alive choreography, and
      // it works with the screen locked, which the web dance never could.
      void native.duckStart();
    } else {
      // Hold the music out of the way for the whole burst rather than per
      // line: a km marker is three queued items back to back, and restoring
      // between each one made the music stutter in and out three times.
      setAudioSession("transient");
      // Retyping alone is not enough: iOS applies the session type when the
      // session comes UP, and the keep-alive loop holds it up continuously
      // from start() — activated under "ambient", so every later flip to
      // "transient" lands on a session the OS already configured, and the
      // music never ducks (a field regression introduced by unlocking the
      // players inside start()). Pausing the keep-alive lets the phrase's own
      // play() bring the session up fresh with duck-others actually applied;
      // the gap with no audio is a few milliseconds, and the screen is on
      // (AOD) so nothing gets suspended.
      this.duckHold = true;
      this.keepAlive?.pause();
    }
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift()!;
        this.setSpeaking(true, item.text);
        let served: keyof typeof this.counts = !item.audioUrl
          ? "synth"
          : item.audioUrl.startsWith("data:")
            ? "live"
            : "prerendered";
        try {
          if (item.audioUrl) {
            if (native) {
              await this.playNative(native, item.audioUrl, item.volume);
            } else {
              await this.playFile(item.audioUrl, item.volume);
            }
          } else {
            await this.speakSynth(item.text, item.speaker);
          }
        } catch {
          // If the rendered file 404s or fails, fall back to synthesis once.
          // A cue has no words, so there is nothing to fall back to.
          if (item.audioUrl && !item.cue) {
            served = "synth";
            try {
              await this.speakSynth(item.text, item.speaker);
            } catch {
              /* give up on this phrase */
            }
          }
        }
        if (!item.cue) {
          this.counts[served]++;
          recordLifetimePlay(served);
        }
        this.setSpeaking(false, null);
        await new Promise((r) => setTimeout(r, item.cue ? 120 : 400));
      }
    } finally {
      this.playing = false;
      if (native) {
        // Deactivate-with-notify tells the music it may come back up.
        void native.duckEnd();
      } else {
        // Type first, then reactivate: the keep-alive's play() is what brings
        // the session back up, and it must come up as "ambient" so the music
        // returns to full volume.
        setAudioSession("ambient");
        this.duckHold = false;
      }
      this.keepAlive?.play().catch(() => {});
    }
  }

  /**
   * Shell playback: hand the clip to the plugin's AVAudioPlayer. data: URLs
   * carry their base64 already; blob: URLs (the cues) are fetched in-page —
   * blobs are same-context so this always works; http(s) URLs (pre-rendered
   * phrases) go over as URLs for the native side to fetch — no CORS there.
   * The watchdog mirrors playFile's: a rejection falls back to synthesis.
   */
  private async playNative(
    native: NonNullable<ReturnType<typeof runBuddyNative>>,
    url: string,
    volumeOverride?: number
  ): Promise<void> {
    const volume = volumeOverride ?? getVoiceVolume(this.persona.id);
    let opts: { data?: string; url?: string; volume: number };
    if (url.startsWith("data:")) {
      opts = { data: url.slice(url.indexOf(",") + 1), volume };
    } else if (url.startsWith("blob:")) {
      const buf = await (await fetch(url)).arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      opts = { data: btoa(bin), volume };
    } else {
      opts = { url: new URL(url, window.location.href).toString(), volume };
    }
    let watchdog: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([
        // One immediate retry before giving up: a single dropped fetch at the
        // wrong moment once swallowed a one-shot record announcement whole.
        native.play(opts).catch(() => native.play(opts)),
        new Promise<never>((_, reject) => {
          watchdog = setTimeout(() => reject(new Error("playback stalled")), 60_000);
        }),
      ]);
    } finally {
      clearTimeout(watchdog!);
    }
  }

  private playFile(url: string, volumeOverride?: number): Promise<void> {
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
      // Per-persona level, set in admin. Levels above 1 are a native-side
      // amplify; an element tops out at 1 (and throws past it), so clamp.
      p.volume = Math.min(1, volumeOverride ?? getVoiceVolume(this.persona.id));
      p.src = url;
      p.play().catch((err) => settle(() => reject(err)));
    });
  }

  private speakSynth(text: string, speaker?: Persona): Promise<void> {
    // Shell: the native synthesizer sits on the app's audio session, so the
    // fallback voice keeps working with the screen locked — the page's
    // speechSynthesis is suspended there and every fallback came out as
    // silence. Watchdogged like everything else; failure just moves on.
    const who = speaker ?? this.persona;
    const native = runBuddyNative();
    if (native) {
      let watchdog: ReturnType<typeof setTimeout>;
      return Promise.race([
        native
          .speak({
            text,
            rate: who.tts.rate,
            pitch: who.tts.pitch,
            lang: who.tts.lang,
          })
          .catch(() => {}),
        new Promise<void>((resolve) => {
          watchdog = setTimeout(resolve, Math.min(text.length * 120 + 4000, 45_000));
        }),
      ]).finally(() => clearTimeout(watchdog!));
    }
    return new Promise((resolve) => {
      if (!("speechSynthesis" in window)) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = who.tts.rate;
      u.pitch = who.tts.pitch;
      u.lang = who.tts.lang;
      u.volume = Math.min(1, getVoiceVolume(who.id)); // levels >1 are native-only
      const voices = window.speechSynthesis.getVoices();
      const match =
        voices.find((v) => v.lang === who.tts.lang) ??
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
