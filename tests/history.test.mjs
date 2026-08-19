// The coach's memory: run summaries → history digest. The edges that matter:
// treadmill runs (0 km) count for recency but never for distance/pace figures,
// short dashes never set a pace PB, and day math is floor-of-elapsed, not
// calendar-date arithmetic.
import assert from "node:assert";

const { buildHistoryDigest } = await import("../lib/history.ts");

const DAY = 86_400_000;
const NOW = 1_755_600_000_000;

// Empty history → no digest at all (the prompt block must not render).
assert.strictEqual(buildHistoryDigest([], NOW), null);

// A single treadmill run: recency yes, figures no.
{
  const d = buildHistoryDigest(
    [{ startedAt: NOW - 2 * DAY - 1000, distanceKm: 0, movingSec: 1800 }],
    NOW
  );
  assert.strictEqual(d.totalRuns, 1);
  assert.strictEqual(d.daysSinceLast, 2);
  assert.strictEqual(d.lastRunKm, undefined, "treadmill leaked a distance");
  assert.strictEqual(d.longestKm, undefined);
  assert.strictEqual(d.bestPace, undefined);
}

// The full mix: PBs come from the right runs.
{
  const runs = [
    // yesterday: 10.06 km in 62:12 → 6:11/km — the "last run"
    { startedAt: NOW - 1 * DAY, distanceKm: 10.06, movingSec: 3732 },
    // a fast 5k two weeks ago: 5.0 km in 27:30 → 5:30/km — the pace PB
    { startedAt: NOW - 14 * DAY, distanceKm: 5.0, movingSec: 1650 },
    // longest ever, but slow: 15 km in 100 min
    { startedAt: NOW - 40 * DAY, distanceKm: 15.0, movingSec: 6000 },
    // a 400m dash at absurd pace — must NOT become the pace PB
    { startedAt: NOW - 3 * DAY, distanceKm: 0.4, movingSec: 80 },
    // a treadmill session — counts in totals only
    { startedAt: NOW - 5 * DAY, distanceKm: 0, movingSec: 1800 },
  ];
  const d = buildHistoryDigest(runs, NOW);
  assert.strictEqual(d.totalRuns, 5);
  assert.strictEqual(d.daysSinceLast, 1);
  assert.strictEqual(d.lastRunKm, 10.06);
  assert.strictEqual(d.lastRunPace, "6:11", `last pace: ${d.lastRunPace}`);
  assert.strictEqual(d.longestKm, 15);
  assert.strictEqual(d.bestPace, "5:30", `pace PB: ${d.bestPace} (dash must not win)`);
  assert.strictEqual(d.runsLast30Days, 4);
}

// Order independence: the digest must not trust the API's sort.
{
  const runs = [
    { startedAt: NOW - 9 * DAY, distanceKm: 4, movingSec: 1500 },
    { startedAt: NOW - 1 * DAY, distanceKm: 6, movingSec: 2100 },
  ];
  const shuffled = [runs[0], runs[1]];
  const d1 = buildHistoryDigest(shuffled, NOW);
  const d2 = buildHistoryDigest([runs[1], runs[0]], NOW);
  assert.deepStrictEqual(d1, d2);
  assert.strictEqual(d1.lastRunKm, 6);
}

console.log("history.digest: passed");
