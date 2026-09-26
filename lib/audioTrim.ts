// Where the speech starts and ends in a clip, so the silence ElevenLabs and
// a recording booth leave around it can be cut. Shared by the server (PCM
// from ElevenLabs, Int16) and the studio (Float32 from the microphone):
// callers pass how loud "full scale" is in their sample type.
//
// A window counts as voiced when its RMS clears a floor of -46 dBFS — well
// above the near-digital-zero silence a render carries, well below any
// spoken consonant. A little is kept either side so the first sound is not
// clipped and the last one is not cut off mid-decay; the coach queues the
// two halves of a split back to back, so what is left of the gap is the
// player's own.

export interface TrimBounds {
  start: number; // first sample to keep
  end: number; // one past the last sample to keep
}

const WINDOW_MS = 10;
const FLOOR = 0.005; // -46 dBFS
const PAD_BEFORE_MS = 40;
const PAD_AFTER_MS = 80;

export function findVoicedBounds(
  samples: ArrayLike<number>,
  sampleRate: number,
  fullScale: number
): TrimBounds {
  const n = samples.length;
  const win = Math.max(1, Math.round((sampleRate * WINDOW_MS) / 1000));
  const floor = FLOOR * fullScale;
  let first = -1;
  let last = -1;
  for (let i = 0; i < n; i += win) {
    const stop = Math.min(n, i + win);
    let sum = 0;
    for (let j = i; j < stop; j++) {
      const v = samples[j];
      sum += v * v;
    }
    const rms = Math.sqrt(sum / (stop - i));
    if (rms > floor) {
      if (first < 0) first = i;
      last = stop;
    }
  }
  if (first < 0) return { start: 0, end: n }; // nothing voiced: leave it alone
  const before = Math.round((sampleRate * PAD_BEFORE_MS) / 1000);
  const after = Math.round((sampleRate * PAD_AFTER_MS) / 1000);
  return { start: Math.max(0, first - before), end: Math.min(n, last + after) };
}

/** A few milliseconds of ramp at each new edge, so a cut never clicks. */
export const EDGE_FADE_MS = 5;

export function fadeEdges<T extends Int16Array | Float32Array>(samples: T, sampleRate: number): T {
  const len = Math.min(samples.length >> 1, Math.round((sampleRate * EDGE_FADE_MS) / 1000));
  for (let i = 0; i < len; i++) {
    const g = i / len;
    samples[i] = (samples[i] * g) as T[number];
    samples[samples.length - 1 - i] = (samples[samples.length - 1 - i] * g) as T[number];
  }
  return samples;
}
