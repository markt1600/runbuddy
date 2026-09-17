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
  const per = await measureFiles(
    urls.map((url, i) => ({ id: String(i), url })),
    onProgress
  );
  const readings = Object.values(per).filter((db) => isFinite(db));
  const failed = urls.length - readings.length;
  if (readings.length === 0) return { dbfs: NaN, files: 0, failed };
  return { dbfs: meanDb(readings), files: readings.length, failed };
}

/** Mean in the power domain, so one loud clip doesn't dominate the dB average. */
export function meanDb(dbs: number[]): number {
  const finite = dbs.filter((d) => isFinite(d));
  if (finite.length === 0) return NaN;
  const meanPower = finite.reduce((a, db) => a + 10 ** (db / 10), 0) / finite.length;
  return 10 * Math.log10(meanPower);
}

/**
 * Speech loudness of each file, keyed by id; NaN where a file failed to
 * fetch or decode. `bust` defeats the blob edge cache — needed right after a
 * re-render, when the same URL may still serve the old bytes for a while.
 */
export async function measureFiles(
  items: { id: string; url: string }[],
  onProgress?: (done: number, total: number) => void,
  opts?: { bust?: boolean }
): Promise<Record<string, number>> {
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw new Error("Web Audio unavailable");
  const ctx = new Ctx();
  const out: Record<string, number> = {};
  let done = 0;
  try {
    for (const { id, url } of items) {
      try {
        const target = opts?.bust ? `${url}${url.includes("?") ? "&" : "?"}nocache=${Date.now()}` : url;
        const res = await fetch(target, { cache: opts?.bust ? "no-store" : "force-cache" });
        if (!res.ok) throw new Error(String(res.status));
        const buf = await ctx.decodeAudioData(await res.arrayBuffer());
        out[id] = clipLoudness(buf) ?? NaN;
      } catch {
        out[id] = NaN;
      }
      done++;
      onProgress?.(done, items.length);
    }
  } finally {
    void ctx.close().catch(() => {});
  }
  return out;
}

/** The dB below which a file counts as `pct` percent quieter than `avgDb`. */
export function quietThresholdDb(avgDb: number, pct: number): number {
  const frac = Math.min(0.99, Math.max(0.01, pct / 100));
  return avgDb + 20 * Math.log10(1 - frac);
}

export interface VolumeSuggestion {
  /** The slider value to use — the ideal, clamped to the slider's range. */
  volume: number;
  /** What the maths actually asked for before clamping. */
  ideal: number;
  /** True when the ideal is outside the slider and `volume` is the cap. */
  capped: boolean;
}

/**
 * The level that makes `persona` sit where the reference sits at its current
 * level: reference level scaled by the loudness gap. The ideal is reported
 * alongside the clamped value, so "200%" can be told apart from "200% because
 * that's the top of the slider and it really wanted 260%".
 */
export function suggestedVolume(
  readings: Partial<Record<PersonaId, LoudnessReading>>,
  reference: PersonaId,
  referenceVolume: number,
  persona: PersonaId,
  min: number,
  max: number
): VolumeSuggestion | null {
  const ref = readings[reference];
  const me = readings[persona];
  if (!ref || !me || !isFinite(ref.dbfs) || !isFinite(me.dbfs)) return null;
  const gain = 10 ** ((ref.dbfs - me.dbfs) / 20);
  const ideal = referenceVolume * gain;
  const volume = Math.round(Math.min(max, Math.max(min, ideal)) * 20) / 20; // slider step 0.05
  return { volume, ideal, capped: ideal > max + 0.025 || ideal < min - 0.025 };
}

/**
 * The highest reference level at which EVERY measured trainer's suggestion
 * fits under the slider cap — the honest fix when several voices want more
 * than the cap: bring the reference down instead of pinning the others.
 */
export function referenceLevelToFitAll(
  readings: Partial<Record<PersonaId, LoudnessReading>>,
  reference: PersonaId,
  max: number
): number | null {
  const ref = readings[reference];
  if (!ref || !isFinite(ref.dbfs)) return null;
  let level = Infinity;
  for (const [id, r] of Object.entries(readings) as [PersonaId, LoudnessReading][]) {
    if (id === reference || !r || !isFinite(r.dbfs)) continue;
    const gain = 10 ** ((ref.dbfs - r.dbfs) / 20);
    level = Math.min(level, max / gain);
  }
  return isFinite(level) ? Math.floor(level * 20) / 20 : null;
}
