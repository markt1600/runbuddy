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
  // Same start time = same run, whatever the rest of the basename says. Any
  // other record for it — an earlier End tap whose stats differed by a few
  // seconds, a pre-conform copy — is superseded by this write. Runs can't
  // share a start millisecond, so the prefix can't catch a neighbour.
  try {
    const page = await list({ prefix: `${userPrefix(sub)}${startedAt}_` });
    const superseded = page.blobs
      .filter((b) => b.pathname !== userPrefix(sub) + basename)
      .map((b) => b.url);
    if (superseded.length > 0) await del(superseded);
  } catch {
    /* best effort — a leftover duplicate is visible and deletable, not lost data */
  }
  return { id: basename };
}

export async function getRun(sub: string, basename: string): Promise<SavedRun | null> {
  return getRunAtPrefix(userPrefix(sub), basename);
}

/** Admin: read one run addressed by the user's uid hash, not a session sub. */
export async function getRunByHash(uid: string, basename: string): Promise<SavedRun | null> {
  return getRunAtPrefix(hashPrefix(uid), basename);
}

async function getRunAtPrefix(prefix: string, basename: string): Promise<SavedRun | null> {
  if (!BASENAME_RE.test(basename)) return null;
  const pathname = prefix + basename;
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

/**
 * Adopt a device's distance (the Watch's, via the Health panel) over the
 * app's. Distance and its derivatives change; splits stay app-measured and
 * the original reading is preserved in stats.confirmed for provenance. The
 * basename encodes distance, so this is a re-save under the new name plus a
 * delete of the old blob.
 */
export async function confirmRunDistance(
  sub: string,
  basename: string,
  distanceKm: number,
  source: string
): Promise<{ id: string; stats: RunStats } | null> {
  const run = await getRun(sub, basename);
  if (!run || run.stats.treadmill) return null;
  const stats = run.stats;
  // A confirmation is a small correction, not a rewrite — a device reading
  // wildly off the app's is a bug or the wrong workout, refuse it.
  if (Math.abs(distanceKm - stats.distanceKm) > Math.max(1, stats.distanceKm * 0.15)) {
    return null;
  }
  stats.confirmed = {
    source: source.slice(0, 60),
    appDistanceKm: stats.distanceKm,
    at: Date.now(),
  };
  stats.distanceKm = distanceKm;
  if (stats.elapsedMs > 0 && distanceKm > 0) {
    stats.avgPaceSecPerKm = stats.elapsedMs / 1000 / distanceKm;
    stats.avgSpeedKmh = distanceKm / (stats.elapsedMs / 3_600_000);
  }
  const saved = await saveRun(sub, run.personaId, stats);
  if ("rejected" in saved) return null;
  if (saved.id !== basename) await deleteRun(sub, basename);
  return { id: saved.id, stats };
}

/**
 * Move every run from one account into another (account merge). Runs are
 * keyed by start time, and two runs cannot start at the same millisecond,
 * so this is collision-free; copy-then-delete per blob means a failure
 * mid-way strands nothing — a retry re-copies whatever remains.
 */
export async function moveRunsBetweenHashes(fromUid: string, toUid: string): Promise<number> {
  const runs = await listRunsByHash(fromUid);
  let moved = 0;
  for (const run of runs) {
    try {
      const res = await fetch(run.url, { cache: "no-store" });
      if (!res.ok) continue;
      const body = await res.text();
      await put(`${PREFIX}/${toUid}/${run.id}`, body, {
        access: "public",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 0,
      });
      await del(run.url);
      moved++;
    } catch {
      /* leave the original where it is; a later retry re-copies it */
    }
  }
  return moved;
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
