import { list, put } from "@vercel/blob";
import { getProfile, listUsers, setFriends, UID_RE, type UserProfile } from "./users";
import { listRunsByHash, type RunSummary } from "./runs";
import { notify } from "./notifications";

// Friends: each profile stores who THEY added; runs (and comments) only
// flow between MUTUAL pairs. Comments live in their own blobs per run, so
// a comment never touches the run record itself.

export interface FriendEntry {
  uid: string;
  name: string;
  city?: string;
  /** True when they've added this user back — the feed only shows mutuals. */
  mutual: boolean;
}

export interface FeedItem extends RunSummary {
  friendUid: string;
  friendName: string;
}

export interface RunComment {
  uid: string;
  name: string;
  text: string;
  at: number;
}

const hasFriend = (p: UserProfile | null, uid: string) =>
  (p?.friends ?? []).includes(uid);

export async function isMutual(aUid: string, bUid: string): Promise<boolean> {
  if (aUid === bUid) return false;
  const [a, b] = await Promise.all([getProfile(aUid), getProfile(bUid)]);
  return hasFriend(a, bUid) && hasFriend(b, aUid);
}

/** This user's friend list, resolved to names/cities with mutuality flags. */
export async function listFriends(uid: string): Promise<FriendEntry[]> {
  const me = await getProfile(uid);
  const ids = me?.friends ?? [];
  const profiles = await Promise.all(ids.map((f) => getProfile(f)));
  const out: FriendEntry[] = [];
  for (let i = 0; i < ids.length; i++) {
    const p = profiles[i];
    if (!p) continue; // deleted account — leave it invisible
    out.push({
      uid: ids[i],
      name: p.name,
      city: p.homeCity,
      mutual: hasFriend(p, uid),
    });
  }
  return out.sort((a, b) => Number(b.mutual) - Number(a.mutual) || a.name.localeCompare(b.name));
}

export async function addFriend(uid: string, friendUid: string): Promise<boolean> {
  if (!UID_RE.test(friendUid) || friendUid === uid) return false;
  const [me, them] = await Promise.all([getProfile(uid), getProfile(friendUid)]);
  if (!me || !them) return false;
  const already = (me.friends ?? []).includes(friendUid);
  const ok = await setFriends(uid, [...(me.friends ?? []), friendUid]);
  if (ok && !already) {
    if (hasFriend(them, uid)) {
      // The add completed a mutual pair — tell both sides it's on.
      await Promise.all([
        notify(uid, {
          type: "friend",
          text: `✓ You and ${them.name} are now friends — their runs are in your feed`,
          friendUid,
          fromName: them.name,
        }),
        notify(friendUid, {
          type: "friend",
          text: `✓ ${me.name} added you back — you're now friends`,
          friendUid: uid,
          fromName: me.name,
        }),
      ]);
    } else {
      // A one-way add is effectively a friend request.
      await notify(friendUid, {
        type: "friend",
        text: `👥 ${me.name} added you as a friend — add them back to share runs`,
        friendUid: uid,
        fromName: me.name,
      });
    }
  }
  return ok;
}

export async function removeFriend(uid: string, friendUid: string): Promise<boolean> {
  const me = await getProfile(uid);
  if (!me) return false;
  return setFriends(uid, (me.friends ?? []).filter((f) => f !== friendUid));
}

/**
 * Name search over the user registry — "SINGAP" finds Singapore-style, a
 * few letters of a name finds the person. City is shown so two Sarahs are
 * tellable apart. Cheap at this scale; cap keeps the response tiny.
 */
export async function searchUsers(
  q: string,
  selfUid: string
): Promise<{ uid: string; name: string; city?: string }[]> {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  const users = await listUsers();
  return users
    .filter((u) => u.uid !== selfUid && u.name.toLowerCase().includes(needle))
    .slice(0, 8)
    .map((u) => ({ uid: u.uid, name: u.name, city: u.homeCity }));
}

/** The feed: every mutual friend's recent runs, newest first. */
export async function friendFeed(uid: string, cap = 30): Promise<FeedItem[]> {
  const friends = (await listFriends(uid)).filter((f) => f.mutual);
  const perFriend = await Promise.all(
    friends.map(async (f) => {
      const runs = await listRunsByHash(f.uid);
      return runs.slice(0, 10).map((r) => ({
        id: r.id,
        startedAt: r.startedAt,
        distanceKm: r.distanceKm,
        movingSec: r.movingSec,
        wallSec: r.wallSec,
        personaId: r.personaId,
        friendUid: f.uid,
        friendName: f.name,
      }));
    })
  );
  return perFriend
    .flat()
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, cap);
}

// ---- comments ----

const commentsPath = (ownerUid: string, runId: string) =>
  `comments/${ownerUid}/${runId}.json`;

export async function readComments(ownerUid: string, runId: string): Promise<RunComment[]> {
  const pathname = commentsPath(ownerUid, runId);
  const page = await list({ prefix: pathname, limit: 1 });
  const hit = page.blobs.find((b) => b.pathname === pathname);
  if (!hit) return [];
  try {
    const res = await fetch(hit.url, { cache: "no-store" });
    return res.ok ? ((await res.json()) as RunComment[]) : [];
  } catch {
    return [];
  }
}

export async function addComment(
  ownerUid: string,
  runId: string,
  comment: RunComment
): Promise<RunComment[]> {
  const existing = await readComments(ownerUid, runId);
  const next = [...existing, comment].slice(-200);
  await put(commentsPath(ownerUid, runId), JSON.stringify(next), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
  return next;
}
