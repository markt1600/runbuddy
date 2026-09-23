import { del, list } from "@vercel/blob";
import { uidHash } from "./auth";
import { blobConfigured } from "./library";
import { getProfile } from "./users";
import { listFriendRequests, removeFriend } from "./friends";
import { revenuecatConfigured } from "./revenuecat";

// Account deletion, the App Store's way: everything the account wrote to
// the store goes, in one call, and the session cookie with it. The list of
// places mirrors what the privacy page says is stored — keep the two in
// step. Best-effort throughout: a blob that refuses to delete is logged in
// the counts, never a reason to leave the rest behind.

export interface DeletionReport {
  runs: number;
  notifications: number;
  cheers: number;
  receipts: number;
  comments: number;
  friendsUpdated: number;
  links: number;
  profile: boolean;
  cardPhoto: boolean;
  presence: boolean;
  subscriber: boolean;
}

/** Delete every blob under a prefix, paging; returns how many went. */
async function delPrefix(prefix: string): Promise<number> {
  let cursor: string | undefined;
  let n = 0;
  do {
    const page = await list({ prefix, cursor });
    const urls = page.blobs.map((b) => b.url);
    if (urls.length > 0) {
      await del(urls);
      n += urls.length;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return n;
}

/** Delete one exact pathname, if it exists. */
async function delOne(pathname: string): Promise<boolean> {
  const page = await list({ prefix: pathname, limit: 1 });
  const hit = page.blobs.find((b) => b.pathname === pathname);
  if (!hit) return false;
  await del(hit.url);
  return true;
}

/**
 * Link records live under the LINKED identity's hash and name the canonical
 * account inside, so finding this account's links means reading them all —
 * a handful of tiny blobs at this scale.
 */
async function delLinksTo(sub: string): Promise<number> {
  let cursor: string | undefined;
  let n = 0;
  do {
    const page = await list({ prefix: "links/", cursor });
    for (const b of page.blobs) {
      try {
        const res = await fetch(`${b.url}?nocache=${Date.now()}`, { cache: "no-store" });
        const link = res.ok ? ((await res.json()) as { sub?: string }) : null;
        if (link?.sub === sub) {
          await del(b.url);
          n++;
        }
      } catch {
        /* unreadable link — leave it */
      }
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return n;
}

/** Forget the customer at RevenueCat too. The Apple subscription itself is
 *  Apple's; a later Restore purchases would simply re-create the record. */
async function delSubscriber(uid: string): Promise<boolean> {
  if (!revenuecatConfigured()) return false;
  try {
    const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(uid)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${process.env.REVENUECAT_SECRET_KEY}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteAccount(sub: string): Promise<DeletionReport> {
  if (!blobConfigured()) throw new Error("no blob store");
  const uid = uidHash(sub);
  const report: DeletionReport = {
    runs: 0,
    notifications: 0,
    cheers: 0,
    receipts: 0,
    comments: 0,
    friendsUpdated: 0,
    links: 0,
    profile: false,
    cardPhoto: false,
    presence: false,
    subscriber: false,
  };

  // Friends first, while the profile still lists them: take this account
  // out of every friend's list and every pending request that named it.
  const profile = await getProfile(uid).catch(() => null);
  const others = new Set<string>(profile?.friends ?? []);
  try {
    for (const r of await listFriendRequests(uid)) others.add(r.uid);
  } catch {
    /* the registry scan failing only leaves a dangling request */
  }
  for (const other of others) {
    if (await removeFriend(other, uid).catch(() => false)) report.friendsUpdated++;
  }

  const [runs, notifications, cheers, receipts, comments] = await Promise.all([
    delPrefix(`runs/${uid}/`),
    delPrefix(`notifications/${uid}/`),
    delPrefix(`shoutouts/${uid}/`),
    delPrefix(`shoutout-receipts/${uid}/`),
    delPrefix(`comments/${uid}/`),
  ]);
  Object.assign(report, { runs, notifications, cheers, receipts, comments });

  report.cardPhoto = await delOne(`cardbg/${uid}.jpg`).catch(() => false);
  report.presence = await delOne(`presence/${uid}.json`).catch(() => false);
  report.links = await delLinksTo(sub).catch(() => 0);
  report.subscriber = await delSubscriber(uid);
  // The profile last: while it exists a crashed deletion is retryable from
  // the same account; once it is gone the sign-in is a fresh account.
  report.profile = await delOne(`users/${uid}.json`).catch(() => false);
  return report;
}
