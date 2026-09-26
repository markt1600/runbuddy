// The silence trim: a clip of quiet, tone, quiet keeps the tone with a small
// margin either side; an all-quiet clip is left alone; the edge fade ramps
// from zero so a cut never clicks.
import assert from "node:assert";
import { findVoicedBounds, fadeEdges } from "../lib/audioTrim.ts";

const RATE = 24000;
const sec = (s) => Math.round(RATE * s);

// 0.6 s near-silence, 1.0 s of a 440 Hz tone at -12 dBFS, 0.9 s near-silence.
const clip = new Int16Array(sec(2.5));
for (let i = 0; i < clip.length; i++) {
  const t = i / RATE;
  const inTone = t >= 0.6 && t < 1.6;
  const noise = (Math.random() - 0.5) * 20; // ~-64 dBFS room tone
  clip[i] = inTone ? Math.round(8192 * Math.sin(2 * Math.PI * 440 * t)) + noise : noise;
}
const { start, end } = findVoicedBounds(clip, RATE, 32767);
assert.ok(start >= sec(0.5) && start <= sec(0.6), `start ${start} not ~40 ms before the tone`);
assert.ok(end >= sec(1.6) && end <= sec(1.7), `end ${end} not ~80 ms after the tone`);
const kept = (end - start) / RATE;
assert.ok(kept > 1.05 && kept < 1.2, `kept ${kept.toFixed(2)} s, expected the tone plus margins`);

const quiet = new Int16Array(sec(1)).map(() => Math.round((Math.random() - 0.5) * 20));
assert.deepStrictEqual(findVoicedBounds(quiet, RATE, 32767), { start: 0, end: quiet.length });

const f32 = new Float32Array(sec(0.2)).fill(0.5);
fadeEdges(f32, RATE);
assert.strictEqual(f32[0], 0, "fade starts from silence");
assert.ok(f32[sec(0.1)] === 0.5, "the middle is untouched");
assert.strictEqual(f32[f32.length - 1], 0, "fade ends in silence");

console.log("audioTrim: bounds, quiet clip untouched, edge fade — passed");
