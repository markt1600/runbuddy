import { del, list, put } from "@vercel/blob";
import { UID_RE } from "./users";

// In-app alerts, fan-out on write: the endpoint where something happens
// (a friend add completing, a run saved, a comment, a shoutout) writes a
// small blob into each affected user's notifications folder. The client
// polls cheaply; read-state is one timestamp on the profile.

export type NotificationType = "friend" | "run" | "comment" | "shoutout";

export interface AppNotification {
  id: string;
  type: NotificationType;
  /** Ready-to-display line, emoji included. */
  text: string;
  at: number;
  /** Deep-link targets, by type: run/comment → runId; run/friend → friendUid. */
  runId?: string;
  friendUid?: string;
  fromName?: string;
}

const KEEP = 40;

const dirPrefix = (uid: string) => `notifications/${uid}/`;

export async function notify(
  uid: string,
  n: Omit<AppNotification, "id" | "at">
): Promise<void> {
  if (!UID_RE.test(uid)) return;
  const at = Date.now();
  const id = `${at}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    await put(dirPrefix(uid) + `${id}.json`, JSON.stringify({ ...n, id, at }), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 0,
    });
  } catch {
    /* an alert is never worth failing the action that caused it */
  }
}

/** Newest first. Reading also prunes: anything beyond the cap is deleted. */
export async function listNotifications(uid: string): Promise<AppNotification[]> {
  const blobs: { url: string; pathname: string }[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: dirPrefix(uid), cursor });
    for (const b of page.blobs) blobs.push({ url: b.url, pathname: b.pathname });
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  // The id starts with the timestamp, so the pathname sorts chronologically.
  blobs.sort((a, b) => (a.pathname < b.pathname ? 1 : -1));
  const keep = blobs.slice(0, KEEP);
  const prune = blobs.slice(KEEP);
  if (prune.length > 0) {
    void Promise.all(prune.map((b) => del(b.url).catch(() => {})));
  }
  const bodies = await Promise.all(
    keep.map(async (b) => {
      try {
        const res = await fetch(b.url, { cache: "no-store" });
        return res.ok ? ((await res.json()) as AppNotification) : null;
      } catch {
        return null;
      }
    })
  );
  return bodies.filter((n): n is AppNotification => n !== null && !!n.id);
}
