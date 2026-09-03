// The runner's history, boiled down to what a coach would actually bring up
// mid-run. Computed client-side from the run list's summaries — those are
// encoded in blob pathnames, so building this costs one listing and zero
// body fetches.

/** Matches the summary shape GET /api/runs returns. */
export interface RunSummaryLike {
  startedAt: number;
  distanceKm: number;
  movingSec: number;
}

export interface RunHistoryDigest {
  totalRuns: number;
  daysSinceLast?: number;
  lastRunKm?: number;
  lastRunPace?: string; // "6:12" min/km
  longestKm?: number;
  bestPace?: string; // fastest average pace over runs of 3km+
  bestPaceKm?: number; // the distance of the run that set bestPace
  runsLast30Days: number;
}

/** Whole days since the epoch, counted on the local calendar. */
const localDayIndex = (t: number): number => {
  const d = new Date(t);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
};

const paceStr = (secPerKm: number): string => {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

export function buildHistoryDigest(
  runs: RunSummaryLike[],
  now = Date.now()
): RunHistoryDigest | null {
  if (runs.length === 0) return null;
  const sorted = [...runs].sort((a, b) => b.startedAt - a.startedAt);
  const digest: RunHistoryDigest = {
    totalRuns: sorted.length,
    runsLast30Days: sorted.filter((r) => now - r.startedAt < 30 * 86_400_000).length,
  };

  const last = sorted[0];
  // Calendar days in the runner's OWN timezone, not elapsed hours: a Tuesday
  // 07:05 run seen from Thursday 06:36 is 47.5 hours — "yesterday" by the
  // floor-of-hours maths, but two days ago on any calendar the runner uses.
  // This runs on the device, so local Date getters are the runner's zone.
  digest.daysSinceLast = localDayIndex(now) - localDayIndex(last.startedAt);
  // Treadmill runs store zero distance — recency still counts, figures don't.
  if (last.distanceKm > 0) {
    digest.lastRunKm = Number(last.distanceKm.toFixed(2));
    if (last.movingSec > 0) digest.lastRunPace = paceStr(last.movingSec / last.distanceKm);
  }

  const outdoor = sorted.filter((r) => r.distanceKm > 0);
  if (outdoor.length > 0) {
    digest.longestKm = Number(
      Math.max(...outdoor.map((r) => r.distanceKm)).toFixed(2)
    );
    // Pace PB only over real distances — a 400m dash isn't a pace record.
    const paced = outdoor.filter((r) => r.distanceKm >= 3 && r.movingSec > 0);
    if (paced.length > 0) {
      // Keep the distance it was set on: a 5km pace is not a fair benchmark
      // for a 14km run, and the prompt needs the distance to know that.
      const best = paced.reduce((a, b) =>
        a.movingSec / a.distanceKm <= b.movingSec / b.distanceKm ? a : b
      );
      digest.bestPace = paceStr(best.movingSec / best.distanceKm);
      digest.bestPaceKm = Number(best.distanceKm.toFixed(1));
    }
  }
  return digest;
}
