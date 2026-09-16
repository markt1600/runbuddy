// Measures how loud a trainer's rendered audio actually is, so the playback
// levels can be set from evidence rather than by ear. A representative sample
// of each persona's files is decoded and its speech-weighted RMS taken; the
// suggestion for every other trainer is then whatever level makes their
// average land where Ah Beng's does at HIS current level. Runs entirely in the
// browser (Web Audio), nothing is stored.

import type { PersonaId } from "./types";

export interface LoudnessReading {
  /** Mean speech-gated RMS across the sampled files, in dBFS. */
  dbfs: number;
  /** How many files were decoded successfully. */
  files: number;
  /** Files that failed to fetch or decode. */
  failed: number;
}

/** Below this a frame is treated as silence and left out of the average. */
const GATE_DBFS = -50;
const FRAME_MS = 50;

/** Speech-gated RMS of one decoded clip, in dBFS. Null when it is all silence. */
function clipLoudness(buffer: AudioBuffer): number | null {
  const ch = buffer.getChannelData(0);
  const frame = Math.max(1, Math.round((buffer.sampleRate * FRAME_MS) / 1000));
  let sumSq = 0;
  let count = 0;
  for (let start = 0; start + frame <= ch.length; start += frame) {
    let s = 0;
    for (let i = start; i < start + frame; i++) s += ch[i] * ch[i];
    const rms = Math.sqrt(s / frame);
    const db = 20 * Math.log10(rms + 1e-12);
    if (db < GATE_DBFS) continue; // pauses between words don't count
    sumSq += rms * rms;
    count++;
  }
  if (count === 0) return null;
  return 20 * Math.log10(Math.sqrt(sumSq / count) + 1e-12);
}

/**
 * Pick `n` URLs spread evenly through the list — stable across runs, and a
 * fair cross-section of categories since the list is grouped by phrase id.
 */
export function sampleUrls(urls: string[], n: number): string[] {
  if (urls.length <= n) return urls;
  const step = urls.length / n;
  return Array.from({ length: n }, (_, i) => urls[Math.floor(i * step)]);
}

export async function measureLoudness(
  urls: string[],
  onProgress?: (done: number, total: number) => void
): Promise<LoudnessReading> {
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw new Error("Web Audio unavailable");
  const ctx = new Ctx();
  const readings: number[] = [];
  let failed = 0;
  let done = 0;
  try {
    for (const url of urls) {
      try {
        const res = await fetch(url, { cache: "force-cache" });
        if (!res.ok) throw new Error(String(res.status));
        const buf = await ctx.decodeAudioData(await res.arrayBuffer());
        const db = clipLoudness(buf);
        if (db === null) failed++;
        else readings.push(db);
      } catch {
        failed++;
      }
      done++;
      onProgress?.(done, urls.length);
    }
  } finally {
    void ctx.close().catch(() => {});
  }
  if (readings.length === 0) return { dbfs: NaN, files: 0, failed };
  // Mean in the power domain, so one loud clip doesn't dominate the dB average.
  const meanPower = readings.reduce((a, db) => a + 10 ** (db / 10), 0) / readings.length;
  return { dbfs: 10 * Math.log10(meanPower), files: readings.length, failed };
}

/**
 * The level that makes `persona` sit where the reference sits at its current
 * level: reference level scaled by the loudness gap. Clamped to the slider.
 */
export function suggestedVolume(
  readings: Partial<Record<PersonaId, LoudnessReading>>,
  reference: PersonaId,
  referenceVolume: number,
  persona: PersonaId,
  min: number,
  max: number
): number | null {
  const ref = readings[reference];
  const me = readings[persona];
  if (!ref || !me || !isFinite(ref.dbfs) || !isFinite(me.dbfs)) return null;
  const gain = 10 ** ((ref.dbfs - me.dbfs) / 20);
  const v = referenceVolume * gain;
  return Math.round(Math.min(max, Math.max(min, v)) * 20) / 20; // slider step 0.05
}
