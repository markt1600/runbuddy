import { list, put } from "@vercel/blob";
import { UID_RE } from "./users";

// Live-run presence: the run screen heartbeats every ~75s while a signed-in
// run is in progress. A friend counts as "running" while their last beat is
// fresher than the threshold — generous enough to survive a missed poll in a
// dead zone, tight enough that ended runs clear quickly.

const PRESENCE_FRESH_MS = 3 * 60_000;

const presencePath = (uid: string) => `presence/${uid}.json`;

export async function setPresence(uid: string): Promise<void> {
  await put(presencePath(uid), JSON.stringify({ at: Date.now() }), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
}

export async function isRunning(uid: string): Promise<boolean> {
  const map = await runningMap([uid]);
  return map[uid] === true;
}

/** Which of these users are mid-run right now. */
export async function runningMap(uids: string[]): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  await Promise.all(
    uids.filter((u) => UID_RE.test(u)).map(async (uid) => {
      try {
        const pathname = presencePath(uid);
        const page = await list({ prefix: pathname, limit: 1 });
        const hit = page.blobs.find((b) => b.pathname === pathname);
        if (!hit) return;
        const res = await fetch(hit.url, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { at?: number };
        out[uid] = Date.now() - (data.at ?? 0) < PRESENCE_FRESH_MS;
      } catch {
        /* unreadable = not running */
      }
    })
  );
  return out;
}
