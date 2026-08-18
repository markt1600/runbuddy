// Music-ducking regression — the session must be REACTIVATED, not just retyped.
//
// iOS applies an audio session's type when the session comes up. start()
// unlocks the players by playing silence immediately, which brings the session
// up under "ambient" — and the keep-alive loop then holds it up continuously,
// so a later flip to "transient" lands on a session the OS already configured:
// the coach speaks over the music at full volume. (Field-reported: ducking
// worked before the start() unlock existed, and died with it.)
//
// The fix pauses the keep-alive for each speech burst so the phrase's own
// play() activates the session fresh under "transient", then resumes it after
// the flip back to "ambient". This test asserts that exact choreography.
//
// Run: node --import ./tests/ts-resolve.mjs tests/audio.duck.test.mjs

import assert from "node:assert";

// Every session-type write and keep-alive play/pause, in order.
const log = [];

class FakeAudio {
  constructor(src) {
    this.src = src ?? "";
    this.volume = 1;
    this.currentTime = 0;
    this.loop = false;
    this.duration = NaN;
    this.ended = false;
    this.pausedState = true;
    this.onended = null;
    this.onerror = null;
    this.onpause = null;
    this.onloadedmetadata = null;
    this._listeners = {};
    FakeAudio.created.push(this);
  }
  static created = [];
  _isKeepAlive() {
    return this.loop === true;
  }
  play() {
    this.pausedState = false;
    if (this._isKeepAlive()) log.push("keepalive:play");
    return Promise.resolve();
  }
  pause() {
    this.pausedState = true;
    if (this._isKeepAlive()) log.push("keepalive:pause");
    this.onpause?.();
    for (const fn of this._listeners["pause"] ?? []) fn();
  }
  addEventListener(type, fn) {
    (this._listeners[type] ??= []).push(fn);
  }
  removeEventListener(type, fn) {
    this._listeners[type] = (this._listeners[type] ?? []).filter((f) => f !== fn);
  }
}

Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    audioSession: {
      set type(v) {
        log.push(`session:${v}`);
      },
    },
  },
});
globalThis.window = {};
globalThis.document = {
  visibilityState: "visible",
  addEventListener() {},
  removeEventListener() {},
};
globalThis.Audio = FakeAudio;

const { VoiceEngine } = await import("../lib/audio.ts");
const { PERSONAS } = await import("../lib/personas.ts");

const engine = new VoiceEngine(PERSONAS.ahbeng);
engine.start(); // the user-gesture unlock: session comes up ambient, keep-alive loops

const keepAlive = FakeAudio.created.find((a) => a.loop);
assert.ok(keepAlive, "start() never created the keep-alive loop");

log.length = 0; // only judge the burst itself

engine.say("oi, faster lah", "https://example.com/a.mp3");
await new Promise((r) => setTimeout(r, 50));

// Mid-burst: transient was set, THEN the keep-alive was paused so the phrase's
// play() reactivates the session — and the pause-restart handler must not have
// fought the hold by starting it again.
const midBurst = [...log];
assert.ok(midBurst.includes("session:transient"), `no transient flip: ${midBurst}`);
assert.ok(midBurst.includes("keepalive:pause"), `keep-alive never paused for the burst: ${midBurst}`);
assert.ok(
  midBurst.indexOf("session:transient") < midBurst.indexOf("keepalive:pause"),
  `type must be set before reactivation: ${midBurst}`
);
assert.ok(
  !midBurst.includes("keepalive:play"),
  `keep-alive restarted mid-burst — the duck hold is broken: ${midBurst}`
);
assert.strictEqual(keepAlive.pausedState, true, "keep-alive audibly running during speech");

// Finish the phrase; the burst winds down.
const player = FakeAudio.created.find((a) => a.src === "https://example.com/a.mp3");
assert.ok(player, "phrase never reached the player");
player.ended = true;
player.onended?.();
await new Promise((r) => setTimeout(r, 700));

// After the burst: ambient set FIRST, then the keep-alive brought the session
// back up — that reactivation is what returns the music to full volume.
const ambientAt = log.lastIndexOf("session:ambient");
const resumeAt = log.lastIndexOf("keepalive:play");
assert.ok(ambientAt !== -1, `no ambient restore: ${log}`);
assert.ok(resumeAt !== -1, `keep-alive never resumed after the burst: ${log}`);
assert.ok(ambientAt < resumeAt, `ambient must be set before the session reactivates: ${log}`);
assert.strictEqual(keepAlive.pausedState, false, "keep-alive left paused after the burst");

console.log("audio.duck: burst reactivates the session under transient, restores ambient — passed");
