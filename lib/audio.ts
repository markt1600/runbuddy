import type { Persona } from "./types";

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

export class VoiceEngine {
  private keepAlive: HTMLAudioElement | null = null;
  private player: HTMLAudioElement | null = null;
  private queue: { text: string; audioUrl?: string }[] = [];
  private playing = false;
  private persona: Persona;
  speaking = false;
  onSpeakingChange: (speaking: boolean, text: string | null) => void = () => {};
  /** How each spoken line was served this run. */
  counts = { prerendered: 0, live: 0, synth: 0 };

  constructor(persona: Persona) {
    this.persona = persona;
  }

  /** Must be called from a user gesture (Start Run tap) to unlock audio on iOS. */
  start() {
    setAudioSession("ambient");
    if (!this.keepAlive) {
      this.keepAlive = new Audio(makeSilentWavUrl());
      this.keepAlive.loop = true;
      this.keepAlive.volume = 0.01;
    }
    this.keepAlive.play().catch(() => {});
    // Prime speechSynthesis inside the gesture so later utterances are allowed
    if ("speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      window.speechSynthesis.speak(u);
    }
  }

  stop() {
    this.queue = [];
    this.player?.pause();
    this.keepAlive?.pause();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    this.setSpeaking(false, null);
    setAudioSession("ambient");
  }

  say(text: string, audioUrl?: string) {
    // Keep the queue short — a coach that monologues is worse than one that skips a line
    if (this.queue.length >= 2) this.queue.shift();
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
      setAudioSession("transient"); // duck the music under the voice
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
      p.src = url;
      p.onended = () => resolve();
      p.onerror = () => reject(new Error("audio error"));
      p.play().catch(reject);
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
      u.onend = () => resolve();
      u.onerror = () => resolve();
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
