// End-of-run hand-off between two engines on the native shell.
//
// The run screen's engine plays the sign-off and is told to stop when idle;
// the summary screen's engine waits for it, then speaks the closing line
// through the same native player, with the music ducked. The run engine's
// wind-down must not touch that line: it used to call stop() the moment it
// went idle — silencing the shared player and un-ducking the session — and
// its trailing breath handed the music back underneath whatever had started
// in it. Field report: the sum-up line arrived quiet and buried under the
// playlist.
//
// Run: node --import ./tests/ts-resolve.mjs tests/audio.handoff.test.mjs

import assert from "node:assert";

// ---- a fake Capacitor bridge: every native call, in order ----
const log = [];
const pendingPlays = [];
const nativePromise = (_plugin, method, options = {}) => {
  if (method === "play") {
    log.push(`play:${options.url ?? "data"}`);
    return new Promise((resolve) => pendingPlays.push(resolve));
  }
  log.push(method);
  return Promise.resolve();
};
const finishClip = () => {
  const resolve = pendingPlays.shift();
  assert.ok(resolve, "no clip is playing");
  resolve();
};

globalThis.window = {
  location: { href: "https://run.example/" },
  Capacitor: {
    isNativePlatform: () => true,
    Plugins: { RunBuddyNative: {} },
    nativePromise,
    nativeCallback: () => {},
  },
};
Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
globalThis.document = {
  visibilityState: "visible",
  addEventListener() {},
  removeEventListener() {},
};

const { VoiceEngine, coachIsSpeaking } = await import("../lib/audio.ts");
const { PERSONAS } = await import("../lib/personas.ts");

const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const SIGN_OFF = "https://example.com/signoff.mp3";

// The run engine: started on the Start Run tap, sign-off queued on End,
// then told to wind down as the run screen unmounts.
const run = new VoiceEngine(PERSONAS.ahbeng);
run.start();
run.say("okay lah, done already", SIGN_OFF);
await tick(20);
run.stopWhenIdle();
assert.deepStrictEqual(
  log,
  ["configureAudio", "keepAliveStart", "duckStart", `play:${SIGN_OFF}`, "keepAliveStop"],
  `sign-off did not start the way a run line does: ${JSON.stringify(log)}`
);
assert.strictEqual(coachIsSpeaking(), true, "the sign-off is playing, the coach is speaking");

// The summary engine does what SummaryScreen does: waits for the coach,
// then speaks its generated line (a data: URL) through the same player.
const summary = new VoiceEngine(PERSONAS.ahbeng);
const closing = (async () => {
  while (coachIsSpeaking()) await tick(50);
  summary.say("not bad lah", "data:audio/mpeg;base64,AAAA");
})();

// The sign-off ends. Give the run engine its full wind-down: the breath
// after the line, the drain loop's exit, and the idle check behind it.
finishClip();
await tick(900);
await closing;

const afterSignOff = log.slice(5);
assert.deepStrictEqual(
  afterSignOff,
  ["duckEnd", "duckStart", "play:data"],
  `hand-off out of order: ${JSON.stringify(afterSignOff)}`
);
assert.ok(!log.includes("stopPlayback"), "the run engine's wind-down stopped the shared player");
assert.strictEqual(coachIsSpeaking(), false, "the run engine never let go");
assert.strictEqual(summary.busy, true, "the closing line is not playing");

// Nothing else may land on the session while the closing line plays.
await tick(700);
assert.strictEqual(log.length, 8, `something interfered mid-line: ${JSON.stringify(log.slice(8))}`);

// The closing line ends; the summary engine hands the music back itself.
finishClip();
await tick(700);
assert.deepStrictEqual(log.slice(8), ["duckEnd"], `odd wind-down: ${JSON.stringify(log.slice(8))}`);
assert.strictEqual(summary.busy, false, "summary engine still busy after its line");

console.log("audio.handoff: the closing line survives the run engine's wind-down — passed");
