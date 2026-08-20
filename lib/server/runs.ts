import { del, list, put } from "@vercel/blob";
import { blobConfigured } from "./library";
import { uidHash } from "./auth";
import type { PersonaId, RunStats } from "../types";

// Run history, one JSON blob per run under a per-user prefix. The summary a
// history card needs — when, how far, how long, which trainer — is encoded in
// the pathname, so listing a user's runs never fetches a single file body.
// (Same pathname-as-data scheme as the render markers, and for the same
// reason: no read-modify-write index to go stale behind a CDN.)
//
// runs/<uidHash>/<startMs>_<distanceM>_<movingSec>_<wallSec>_<personaId>.json

const PREFIX = "runs";

// Anything shorter was a pocket-start or a test tap, not a run. Treadmill
// runs have no distance by design, so they gate on time alone.
export const MIN_DISTANCE_KM = 0.05;
export const MIN_ELAPSED_MS = 60_000;

const BASENAME_RE = /^(\d{10,17})_(\d{1,9})_(\d{1,7})_(\d{1,7})_([a-z]+)\.json$/;

export interface RunSummary {
  id: string; // pathname basename — the detail/delete key
  startedAt: number;
  distanceKm: number;
  movingSec: number;
  wallSec: number;
  personaId: string;
}

export function runsConfigured(): boolean {
  return blobConfigured();
}

const hashPrefix = (uid: string) => `${PREFIX}/${uid}/`;
const userPrefix = (sub: string) => hashPrefix(uidHash(sub));

export function parseBasename(basename: string): RunSummary | null {
  const m = basename.match(BASENAME_RE);
  if (!m) return null;
  return {
    id: basename,
    startedAt: Number(m[1]),
    distanceKm: Number(m[2]) / 1000,
    movingSec: Number(m[3]),
    wallSec: Number(m[4]),
    personaId: m[5],
  };
}

export async function listRunsByHash(
  uid: string
): Promise<(RunSummary & { url: string })[]> {
  const out: (RunSummary & { url: string })[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: hashPrefix(uid), cursor });
    for (const blob of page.blobs) {
      const parsed = parseBasename(blob.pathname.split("/").pop() ?? "");
      if (parsed) out.push({ ...parsed, url: blob.url });
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

export async function listRuns(sub: string): Promise<RunSummary[]> {
  return (await listRunsByHash(uidHash(sub))).map(({ url: _url, ...summary }) => summary);
}

/**
 * Admin view: summaries plus what each run was configured as — trainer comes
 * free from the pathname, but the time / distance targets live in the body,
 * so this fetches them (capped, parallel).
 */
export interface EnrichedRun extends RunSummary {
  treadmill?: boolean;
  targetMinutes?: number;
  targetKm?: number;
  targetPaceSec?: number;
}

export async function enrichedRunsByHash(uid: string, cap = 100): Promise<EnrichedRun[]> {
  const runs = (await listRunsByHash(uid)).slice(0, cap);
  return Promise.all(
    runs.map(async ({ url, ...summary }) => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return summary;
        const body = (await res.json()) as SavedRun;
        return {
          ...summary,
          treadmill: body.stats?.treadmill,
          targetMinutes: body.stats?.targetMinutes,
          targetKm: body.stats?.targetKm,
          targetPaceSec: body.stats?.targetPaceSec,
        };
      } catch {
        return summary;
      }
    })
  );
}

export interface SavedRun {
  personaId: PersonaId;
  savedAt: number;
  stats: RunStats;
}

export async function saveRun(
  sub: string,
  personaId: PersonaId,
  stats: RunStats
): Promise<{ id: string } | { rejected: string }> {
  const startedAt = stats.startedAt ?? Date.now() - stats.elapsedMs;
  if (stats.elapsedMs < MIN_ELAPSED_MS) return { rejected: "too short" };
  if (!stats.treadmill && stats.distanceKm < MIN_DISTANCE_KM) {
    return { rejected: "no distance" }; // a pocket-start, not a run
  }
  const distanceM = Math.round(stats.distanceKm * 1000);
  const movingSec = Math.round(stats.elapsedMs / 1000);
  const wallSec = Math.round((stats.wallElapsedMs ?? stats.elapsedMs) / 1000);
  const basename = `${startedAt}_${distanceM}_${movingSec}_${wallSec}_${personaId}.json`;
  if (!BASENAME_RE.test(basename)) return { rejected: "bad fields" };

  const body: SavedRun = { personaId, savedAt: Date.now(), stats };
  await put(userPrefix(sub) + basename, JSON.stringify(body), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true, // re-saving the same run is idempotent
    cacheControlMaxAge: 0,
  });
  return { id: basename };
}

export async function getRun(sub: string, basename: string): Promise<SavedRun | null> {
  if (!BASENAME_RE.test(basename)) return null;
  const pathname = userPrefix(sub) + basename;
  const page = await list({ prefix: pathname, limit: 1 });
  const hit = page.blobs.find((b) => b.pathname === pathname);
  if (!hit) return null;
  const res = await fetch(hit.url, { cache: "no-store" });
  if (!res.ok) return null;
  try {
    return (await res.json()) as SavedRun;
  } catch {
    return null;
  }
}

/** Ownership is structural: the pathname is rebuilt from the session's own
 *  uid hash, so a user can only ever delete inside their own prefix. */
export async function deleteRun(sub: string, basename: string): Promise<boolean> {
  if (!BASENAME_RE.test(basename)) return false;
  const pathname = userPrefix(sub) + basename;
  const page = await list({ prefix: pathname, limit: 1 });
  const hit = page.blobs.find((b) => b.pathname === pathname);
  if (!hit) return false;
  await del(hit.url);
  return true;
}
