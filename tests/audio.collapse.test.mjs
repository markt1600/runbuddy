// VoiceEngine topic collapse — the "backed-up pause announcements" bug.
//
// Under trees and towers the auto-pause flips several times in a few
// seconds, and every flip queued a chime and a line. The lines then played
// one after another, each about a state the run had already left. Items on
// a topic now replace whatever on that topic is still waiting: only the
// latest truth plays, after whatever line is already mid-sentence.
//
// Run: node --import ./tests/ts-resolve.mjs tests/audio.collapse.test.mjs

import assert from "node:assert";

// ---- minimal DOM the engine touches (same shape as audio.settle) ----
// The engine plays every phrase through ONE shared element and reassigns
// its src, so the element remembers every src it was given.
const created = [];
class FakeAudio {
  constructor(src) {
    this._src = "";
    this.srcHistory = [];
    if (src) this.src = src;
    this.volume = 1;
    this.currentTime = 0;
    this.loop = false;
    this.duration = NaN;
    this.ended = false;
    this.onended = null;
    this.onerror = null;
    this.onpause = null;
    this.onloadedmetadata = null;
    this._listeners = {};
    created.push(this);
  }
  get src() {
    return this._src;
  }
  set src(v) {
    this._src = v;
    this.ended = false;
    this.srcHistory.push(v);
  }
  play() {
    return Promise.resolve();
  }
  pause() {
    this.onpause?.();
  }
  addEventListener(type, fn) {
    (this._listeners[type] ??= []).push(fn);
  }
  removeEventListener(type, fn) {
    this._listeners[type] = (this._listeners[type] ?? []).filter((f) => f !== fn);
  }
  finish() {
    this.ended = true;
    this.onended?.();
  }
}

Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
globalThis.window = {};
globalThis.document = {
  visibilityState: "visible",
  addEventListener() {},
  removeEventListener() {},
};
globalThis.Audio = FakeAudio;
globalThis.URL = globalThis.URL ?? { createObjectURL: () => "blob:fake" };

const { VoiceEngine } = await import("../lib/audio.ts");
const { PERSONAS } = await import("../lib/personas.ts");

const engine = new VoiceEngine(PERSONAS.ahbeng);
const spoken = [];
engine.onSpeakingChange = (speaking, text) => {
  if (speaking && text) spoken.push(text);
};
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));
const url = (name) => `https://example.com/${name}.mp3`;

// An anecdote is mid-sentence when the sky goes bad.
engine.say("anecdote", url("anecdote"));
await tick();
const player = created.find((a) => a.src === url("anecdote"));
assert.ok(player, "the anecdote never started");

// Four flips in quick succession, each the way the run screen does it:
// a chime, then the trainer's line about it.
const flip = (kind, text) => {
  engine.cue(kind);
  engine.say(text, url(text), undefined, undefined, { topic: "pause-state" });
};
flip("pause", "paused-1");
flip("resume", "resumed-1");
flip("pause", "paused-2");
flip("resume", "resumed-2");

// Only the latest state waits: one chime, one line.
assert.deepStrictEqual(
  engine.pendingTexts,
  ["<cue>", "resumed-2"],
  `backlog not collapsed: ${JSON.stringify(engine.pendingTexts)}`
);

// A line on another topic is untouched by the flips, and the cue of a newer
// flip still jumps the queue while the older flip's line is dropped.
engine.say("km marker", url("km"));
flip("pause", "paused-3");
assert.deepStrictEqual(engine.pendingTexts, ["<cue>", "km marker", "paused-3"]);

// The anecdote finishes; the chime and the lines play through in order.
player.finish();
for (let i = 0; i < 6; i++) {
  await tick(300);
  if (!player.ended && player.onended) player.finish();
}
await tick(600);

const spokenUrls = player.srcHistory.filter((s) => s.startsWith("https://example.com/"));
assert.ok(spokenUrls.includes(url("km")), `the km marker was lost: ${spokenUrls}`);
assert.ok(spokenUrls.includes(url("paused-3")), `the final state never played: ${spokenUrls}`);
for (const stale of ["paused-1", "resumed-1", "paused-2", "resumed-2"]) {
  assert.ok(!spokenUrls.includes(url(stale)), `stale line ${stale} played`);
}
assert.deepStrictEqual(spoken, ["anecdote", "km marker", "paused-3"]);
assert.strictEqual(engine.busy, false, "engine still busy after the queue drained");

console.log("audio.collapse: a flurry of pause flips plays only the latest state — passed");
