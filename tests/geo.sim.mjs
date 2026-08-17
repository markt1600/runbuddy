// GPS tracker simulation — the scenarios that have actually produced bugs.
//
// Runs the real lib/geo.ts against a fake clock and a scripted geolocation
// watch. Timestamps and fix intervals are jittered with a seeded PRNG: an
// earlier armed-resume bug passed a clean-clock simulation because the fake
// fixes landed on exact window boundaries, and only failed on a real phone.
// Run: node tests/geo.sim.mjs   (self-contained; geo.ts imports nothing)

import assert from "node:assert";

// ---- deterministic randomness ----
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- fake environment ----
const clock = { now: 1_700_000_000_000 };
const realNow = Date.now;
Date.now = () => clock.now;
process.on("exit", () => { Date.now = realNow; });

// Node 22 ships a real `navigator` global with only a getter, so it has to be
// overridden with defineProperty rather than assignment.
let watchCb = null;
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    geolocation: {
      watchPosition(cb) { watchCb = cb; return 1; },
      clearWatch() { watchCb = null; },
    },
  },
});

const { GeoTracker } = await import("../lib/geo.ts");

// Metres → degrees at Singapore's latitude.
const LAT0 = 1.3521;
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = 111_320 * Math.cos((LAT0 * Math.PI) / 180);

/**
 * One simulated runner. `advance(seconds)` moves the world forward, delivering
 * jittered fixes along the way. Position noise is scaled to the accuracy the
 * receiver claims, which is how real GPS noise behaves.
 */
function makeWorld(tracker, rand, { accuracy = 10, doppler = true } = {}) {
  const world = {
    x: 0, // metres east of origin
    y: 0, // metres north
    speedMps: 0,
    accuracy,
    doppler,
    online: true, // false = tunnel: keep moving, deliver nothing
  };
  world.advance = (seconds) => {
    let remaining = seconds * 1000;
    while (remaining > 0) {
      const step = Math.min(remaining, 900 + rand() * 300); // ~1Hz, jittered
      clock.now += step;
      remaining -= step;
      world.x += 0; // heading due north keeps the maths transparent
      world.y += (world.speedMps * step) / 1000;
      if (!world.online || !watchCb) continue;
      const noise = () => (rand() * 2 - 1) * world.accuracy * 0.55;
      watchCb({
        timestamp: clock.now,
        coords: {
          latitude: LAT0 + (world.y + noise()) / M_PER_DEG_LAT,
          longitude: 103.8198 + (world.x + noise()) / M_PER_DEG_LON,
          accuracy: world.accuracy,
          speed: world.doppler ? Math.max(0, world.speedMps + (rand() - 0.5) * 0.2) : null,
        },
      });
    }
  };
  tracker.start(() => {});
  return world;
}

let failures = 0;
function scenario(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}

console.log("geo.sim");

scenario("stationary phone accumulates no distance (25m accuracy, no Doppler)", () => {
  const t = new GeoTracker();
  const w = makeWorld(t, mulberry32(1), { accuracy: 25, doppler: false });
  w.speedMps = 0;
  w.advance(600); // ten minutes standing at a crossing
  // The historical failure mode was ~3 km of pure noise in this exact setup.
  assert.ok(t.distanceKm < 0.03, `drifted ${(t.distanceKm * 1000).toFixed(0)}m while standing`);
  assert.ok(t.autoPaused, "ten minutes of standing should have auto-paused");
});

scenario("steady run measures distance within 8%", () => {
  const t = new GeoTracker();
  const w = makeWorld(t, mulberry32(2), { accuracy: 8 });
  w.speedMps = 3;
  w.advance(600);
  const truth = 1.8;
  assert.ok(
    Math.abs(t.distanceKm - truth) / truth < 0.08,
    `measured ${t.distanceKm.toFixed(3)}km for a ${truth}km run`
  );
  assert.ok(!t.autoPaused, "must not auto-pause mid-run");
});

scenario("stop → auto-pause, go → auto-resume, both back-dated", () => {
  const t = new GeoTracker();
  const w = makeWorld(t, mulberry32(3), { accuracy: 10 });
  let pausedAt = null;
  let resumedAt = null;
  t.onAutoPause = (at) => { pausedAt = at; };
  t.onAutoResume = (at) => { resumedAt = at; };

  w.speedMps = 3;
  w.advance(120);
  const stopWall = clock.now;
  w.speedMps = 0;
  w.advance(60);
  assert.ok(pausedAt !== null, "never auto-paused after a full minute standing");
  assert.ok(Math.abs(pausedAt - stopWall) < 6000, "pause not back-dated near the actual stop");
  const goWall = clock.now;
  w.speedMps = 3;
  w.advance(120);
  assert.ok(resumedAt !== null, "never auto-resumed after setting off again");
  assert.ok(resumedAt - goWall < 6000, "resume not close to the actual restart");
  // The stationary minute must not have counted as distance.
  const truth = (240 * 3) / 1000;
  assert.ok(
    Math.abs(t.distanceKm - truth) / truth < 0.1,
    `measured ${t.distanceKm.toFixed(3)}km for ${truth}km of actual motion`
  );
});

scenario("tunnel: signal loss while moving neither pauses nor freezes", () => {
  const t = new GeoTracker();
  const w = makeWorld(t, mulberry32(4), { accuracy: 10 });
  t.onAutoPause = () => { throw new Error("auto-paused inside the tunnel"); };
  w.speedMps = 3;
  w.advance(120);
  w.online = false; // into the tunnel, still running
  w.advance(25);
  w.online = true;
  const atExit = t.distanceKm;
  w.advance(15);
  // The historical failure mode: the Kalman filter's catch-up steps after the
  // gap read as teleports and were rejected, freezing distance for many fixes.
  assert.ok(
    t.distanceKm - atExit > 0.025,
    `distance frozen after tunnel exit (grew ${((t.distanceKm - atExit) * 1000).toFixed(0)}m in 15s)`
  );
});

scenario("armed resume: standing noise never fires it, walking off does", () => {
  const t = new GeoTracker();
  const w = makeWorld(t, mulberry32(5), { accuracy: 25, doppler: false });
  let fired = null;
  t.onArmedResume = (at) => { fired = at; };
  w.speedMps = 2.8;
  w.advance(60);
  w.speedMps = 0;
  w.advance(5);
  // A manual pause sets `paused` (the RunScreen does this) and then arms;
  // watchForArmedResume only runs while both are true.
  t.paused = true;
  t.armResume();
  w.advance(90); // a red light's worth of standing, at 25m accuracy
  assert.strictEqual(fired, null, "armed resume fired while standing still");
  w.speedMps = 2.5;
  w.advance(30);
  assert.ok(fired !== null, "armed resume never fired after 30s of walking away");
});

if (failures > 0) {
  console.error(`geo.sim: ${failures} scenario(s) failed`);
  process.exit(1);
}
console.log("geo.sim: all scenarios passed");
