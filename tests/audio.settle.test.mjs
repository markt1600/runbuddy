// VoiceEngine settle regression — the "trainer permanently silent" bug.
//
// iOS pauses media elements when the app is backgrounded (camera, lock button)
// and fires neither "ended" nor "error". A playFile promise listening only for
// those two never settles, drain() waits on it forever, and every phrase queued
// for the rest of the run is silently dropped. The fix routes "pause" (when not
// our own stop) and a duration-based watchdog through the same settle path.
//
// Run: node --import ./tests/ts-resolve.mjs tests/audio.settle.test.mjs

import assert from "node:assert";

// ---- minimal DOM the engine touches ----
const created = [];
class FakeAudio {
  constructor(src) {
    this.src = src ?? "";
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
  /** Simulate iOS interrupting playback: a bare pause, no ended, no error. */
  systemInterrupt() {
    this.ended = false;
    this.onpause?.();
  }
}

Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
globalThis.window = {}; // no speechSynthesis → synth fallback resolves instantly
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
  if (speaking) spoken.push(text);
};

// Two phrases with audio URLs. The first will be interrupted mid-play.
engine.say("first line", "https://example.com/a.mp3");
engine.say("second line", "https://example.com/b.mp3");

// Let drain() start the first phrase.
await new Promise((r) => setTimeout(r, 50));
const player = created.find((a) => a.src === "https://example.com/a.mp3");
assert.ok(player, "first phrase never reached the player");

// The camera button: iOS pauses the element and says nothing else.
player.systemInterrupt();

// The engine must fall back (synth resolves instantly with no speechSynthesis),
// move on, and play the second phrase rather than hanging forever.
await new Promise((r) => setTimeout(r, 700));
const second = created.find((a) => a.src === "https://example.com/b.mp3");
assert.ok(second, "queue stalled after a system interruption — the settle path is broken");
assert.deepStrictEqual(spoken, ["first line", "second line"]);

// Let the second phrase finish normally; the engine must wind down to idle.
second.ended = true;
second.onended?.();
await new Promise((r) => setTimeout(r, 700));
assert.strictEqual(engine.busy, false, "engine still busy after the queue drained");

console.log("audio.settle: interruption settles, queue continues — passed");
