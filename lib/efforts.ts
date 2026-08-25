import { haversineKm } from "./geo";
import type { RunStats } from "./types";

// Personal records: fastest rolling 1 / 5 / 10 km efforts, mined from saved
// runs' route traces (points carry t = seconds since start, so any window of
// the run can be timed, not just whole-km splits). Best-window search with
// linear interpolation at the window's start, so a 5k effort that begins
// mid-segment is timed fairly.
//
// Efforts are computed client-side and cached per run id in localStorage —
// a run's trace never changes, so each body is fetched exactly once.

export const EFFORT_TARGETS_KM = [1, 5, 10] as const;
export type EffortKey = "1" | "5" | "10";

export interface PrRecord {
  sec: number;
  startedAt: number; // when the run holding the record happened
}
export type PrTable = Partial<Record<EffortKey, PrRecord>>;

/** Best rolling efforts within one run; null where the run is too short
 *  (or predates per-point timing / is a treadmill run). */
export function computeRunEfforts(stats: RunStats): Record<EffortKey, number | null> {
  const out: Record<EffortKey, number | null> = { "1": null, "5": null, "10": null };
  const route = stats.route;
  if (stats.treadmill || !route || route.length < 2) return out;
  if (route.some((p) => typeof p.t !== "number")) return out; // pre-timing runs

  const cum: number[] = [0];
  for (let i = 1; i < route.length; i++) {
    cum.push(
      cum[i - 1] +
        haversineKm(
          { lat: route[i - 1].lat, lon: route[i - 1].lon, accuracy: 0, timestamp: 0, speed: null },
          { lat: route[i].lat, lon: route[i].lon, accuracy: 0, timestamp: 0, speed: null }
        )
    );
  }

  for (const target of EFFORT_TARGETS_KM) {
    if (cum[cum.length - 1] < target) continue;
    let best = Infinity;
    let i = 0;
    for (let j = 1; j < route.length; j++) {
      while (cum[j] - cum[i + 1] >= target) i++;
      if (cum[j] - cum[i] < target) continue;
      // Interpolate the moment the window's start crossed cum[j] - target.
      const need = cum[j] - target;
      const segKm = cum[i + 1] - cum[i];
      const frac = segKm > 0 ? (need - cum[i]) / segKm : 0;
      const tStart = route[i].t! + frac * (route[i + 1].t! - route[i].t!);
      const sec = route[j].t! - tStart;
      if (sec > 0 && sec < best) best = sec;
    }
    if (isFinite(best)) out[String(target) as EffortKey] = Math.round(best);
  }
  return out;
}

const CACHE_KEY = "runbuddy-efforts-v1";

/** Forget every mined effort — the next loadPrTable re-mines from scratch. */
export function clearEffortCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* nothing cached anyway */
  }
}

interface RunListEntry {
  id: string;
  startedAt: number;
  distanceKm: number;
}

/**
 * The account's PR table, from the run list: cached efforts are reused, new
 * runs' bodies are fetched and mined once, deleted runs' entries pruned.
 */
export async function loadPrTable(runs: RunListEntry[]): Promise<PrTable> {
  let cache: Record<string, Record<EffortKey, number | null>> = {};
  try {
    cache = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}");
  } catch {
    cache = {};
  }
  let dirty = false;

  for (const run of runs) {
    if (cache[run.id]) continue;
    if (run.distanceKm < 1) {
      cache[run.id] = { "1": null, "5": null, "10": null }; // treadmill / tiny
      dirty = true;
      continue;
    }
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(run.id)}`);
      if (!res.ok) continue; // retry on a later visit
      const data = (await res.json()) as { stats?: RunStats };
      cache[run.id] = data.stats
        ? computeRunEfforts(data.stats)
        : { "1": null, "5": null, "10": null };
      dirty = true;
    } catch {
      /* offline — retry on a later visit */
    }
  }

  const ids = new Set(runs.map((r) => r.id));
  for (const id of Object.keys(cache)) {
    if (!ids.has(id)) {
      delete cache[id];
      dirty = true;
    }
  }
  if (dirty) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      /* quota — recompute next time */
    }
  }

  const table: PrTable = {};
  for (const run of runs) {
    const eff = cache[run.id];
    if (!eff) continue;
    for (const key of ["1", "5", "10"] as const) {
      const sec = eff[key];
      if (typeof sec === "number" && (!table[key] || sec < table[key]!.sec)) {
        table[key] = { sec, startedAt: run.startedAt };
      }
    }
  }
  return table;
}
