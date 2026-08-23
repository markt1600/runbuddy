// Personal-record effort mining: best rolling 1/5/10km windows from a run's
// route trace. Run: node --import ./tests/ts-resolve.mjs tests/efforts.test.mjs

import assert from "node:assert";

const { computeRunEfforts } = await import("../lib/efforts.ts");

// A straight-line route north at a scripted speed profile, one point per 5s.
const LAT0 = 1.3521;
const M_PER_DEG_LAT = 111_320;

function makeRun(profile) {
  // profile: [{seconds, mps}] segments
  const route = [];
  let y = 0;
  let t = 0;
  route.push({ lat: LAT0, lon: 103.82, t: 0 });
  for (const seg of profile) {
    for (let s = 0; s < seg.seconds; s += 5) {
      y += seg.mps * 5;
      t += 5;
      route.push({ lat: LAT0 + y / M_PER_DEG_LAT, lon: 103.82, t });
    }
  }
  return {
    elapsedMs: t * 1000,
    distanceKm: y / 1000,
    paceSecPerKm: null,
    avgPaceSecPerKm: null,
    speedNowKmh: null,
    lastKmSpeedKmh: null,
    avgSpeedKmh: null,
    splits: [],
    route,
  };
}

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}

console.log("efforts");

check("steady 12km at 3 m/s: efforts match constant pace", () => {
  const eff = computeRunEfforts(makeRun([{ seconds: 4000, mps: 3 }]));
  // 1km at 3 m/s = 333.3s; allow the 5s sampling to smear a little.
  assert.ok(Math.abs(eff["1"] - 1000 / 3) < 6, `1km read ${eff["1"]}s`);
  assert.ok(Math.abs(eff["5"] - 5000 / 3) < 6, `5km read ${eff["5"]}s`);
  assert.ok(Math.abs(eff["10"] - 10000 / 3) < 6, `10km read ${eff["10"]}s`);
});

check("a fast middle km is found as the 1km best", () => {
  const eff = computeRunEfforts(
    makeRun([
      { seconds: 600, mps: 2.5 },
      { seconds: 250, mps: 4 }, // 1km at 4 m/s = 250s, buried mid-run
      { seconds: 600, mps: 2.5 },
    ])
  );
  assert.ok(Math.abs(eff["1"] - 250) < 8, `fast km read ${eff["1"]}s`);
});

check("short and treadmill runs yield no efforts", () => {
  const short = computeRunEfforts(makeRun([{ seconds: 200, mps: 3 }])); // 600m
  assert.strictEqual(short["1"], null);
  const mill = computeRunEfforts({ ...makeRun([{ seconds: 4000, mps: 3 }]), treadmill: true });
  assert.strictEqual(mill["5"], null);
});

check("routes without per-point timing yield no efforts", () => {
  const run = makeRun([{ seconds: 4000, mps: 3 }]);
  run.route = run.route.map(({ lat, lon }) => ({ lat, lon }));
  const eff = computeRunEfforts(run);
  assert.strictEqual(eff["10"], null);
});

if (failures > 0) {
  console.error(`efforts: ${failures} check(s) failed`);
  process.exit(1);
}
console.log("efforts: all checks passed");
