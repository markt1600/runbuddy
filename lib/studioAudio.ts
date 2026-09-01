"use client";

// The @breezystack fork, not upstream lamejs: upstream's Mp3Encoder crashes
// at runtime ("MPEGMode is not defined") when bundled as an ES module.
import { Mp3Encoder } from "@breezystack/lamejs";

// Studio audio plumbing: uncompressed mono WAV capture (the clone training
// wants raw takes, and MediaRecorder's opus/AAC would bake compression in),
// plus in-browser MP3 encoding for the paths that need small files — library
// promotion and clone-sample upload. All CPU spent on the admin's laptop or
// the actor's machine, never on a serverless function.

export interface CaptureResult {
  samples: Float32Array;
  sampleRate: number;
  peak: number;
  /** Root-mean-square level, linear 0..1 — loudness for calibration. */
  rms: number;
  seconds: number;
}

export const dbfs = (linear: number): number =>
  linear <= 0 ? -120 : 20 * Math.log10(linear);

export class WavRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private peak = 0;

  /** onLevel gets the current input peak (0..1) a few times a second.
   *  deviceId pins a specific microphone — the mic check's selection. */
  async start(onLevel?: (level: number) => void, deviceId?: string): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false, // raw takes — no browser processing
        autoGainControl: false,
      },
    });
    this.ctx = new AudioContext();
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    this.peak = 0;
    this.node.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(data));
      let p = 0;
      for (let i = 0; i < data.length; i++) {
        const a = Math.abs(data[i]);
        if (a > p) p = a;
      }
      if (p > this.peak) this.peak = p;
      onLevel?.(p);
    };
    source.connect(this.node);
    this.node.connect(this.ctx.destination);
  }

  async stop(): Promise<CaptureResult> {
    const sampleRate = this.ctx?.sampleRate ?? 44100;
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close().catch(() => {});
    this.node = null;
    this.stream = null;
    this.ctx = null;
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const samples = new Float32Array(total);
    let off = 0;
    for (const c of this.chunks) {
      samples.set(c, off);
      off += c.length;
    }
    this.chunks = [];
    let sq = 0;
    for (let i = 0; i < samples.length; i++) sq += samples[i] * samples[i];
    const rms = total > 0 ? Math.sqrt(sq / total) : 0;
    return { samples, sampleRate, peak: this.peak, rms, seconds: total / sampleRate };
  }
}

/** 16-bit mono WAV container around raw samples. */
export function toWav(samples: Float32Array, sampleRate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

/** Decode any audio (a stored WAV take) back to mono samples. */
export async function decodeToMono(
  data: ArrayBuffer
): Promise<{ samples: Float32Array; sampleRate: number }> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(data);
    const samples = decoded.getChannelData(0);
    return { samples: new Float32Array(samples), sampleRate: decoded.sampleRate };
  } finally {
    await ctx.close().catch(() => {});
  }
}

/** Mono MP3 at the given bitrate — 112k for playback, 192k for clone samples. */
export function encodeMp3(samples: Float32Array, sampleRate: number, kbps: number): Uint8Array {
  const enc = new Mp3Encoder(1, sampleRate, kbps);
  const int16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const parts: Uint8Array[] = [];
  const CHUNK = 1152 * 32;
  for (let i = 0; i < int16.length; i += CHUNK) {
    const out = enc.encodeBuffer(int16.subarray(i, i + CHUNK));
    if (out.length > 0) parts.push(out);
  }
  const tail = enc.flush();
  if (tail.length > 0) parts.push(tail);
  const total = parts.reduce((n, p) => n + p.length, 0);
  const mp3 = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    mp3.set(p, off);
    off += p.length;
  }
  return mp3;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
