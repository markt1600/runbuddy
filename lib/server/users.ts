import { list, put } from "@vercel/blob";
import { blobConfigured } from "./library";
import { uidHash, type SessionUser } from "./auth";

// Registry of accounts that have signed in, one profile blob per user, keyed
// by the same HMAC'd id the run store uses — which is exactly what lets the
// admin view link a profile to its runs without the raw Google id ever being
// stored. Written on every login (that's also what keeps lastSeen fresh), so
// accounts that signed in before the registry existed appear on their next
// sign-in.

export interface UserProfile {
  uid: string; // the uidHash — doubles as the runs prefix key
  name: string;
  email?: string;
  picture?: string;
  firstSeen: number;
  lastSeen: number;
}

const profilePath = (uid: string) => `users/${uid}.json`;

export const UID_RE = /^[0-9a-f]{24}$/;

async function readProfile(uid: string): Promise<UserProfile | null> {
  const pathname = profilePath(uid);
  const page = await list({ prefix: pathname, limit: 1 });
  const hit = page.blobs.find((b) => b.pathname === pathname);
  if (!hit) return null;
  try {
    const res = await fetch(hit.url, { cache: "no-store" });
    return res.ok ? ((await res.json()) as UserProfile) : null;
  } catch {
    return null;
  }
}

/** Best-effort on every login — a failed write costs a stale lastSeen, no more. */
export async function recordUserLogin(user: SessionUser): Promise<void> {
  if (!blobConfigured()) return;
  const uid = uidHash(user.sub);
  let firstSeen = Date.now();
  try {
    const existing = await readProfile(uid);
    if (existing?.firstSeen) firstSeen = existing.firstSeen;
  } catch {
    /* treat as first sign-in */
  }
  const profile: UserProfile = {
    uid,
    name: user.name,
    email: user.email,
    picture: user.picture,
    firstSeen,
    lastSeen: Date.now(),
  };
  await put(profilePath(uid), JSON.stringify(profile), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
}

export async function listUsers(): Promise<UserProfile[]> {
  const out: UserProfile[] = [];
  let cursor: string | undefined;
  const urls: string[] = [];
  do {
    const page = await list({ prefix: "users/", cursor });
    for (const blob of page.blobs) {
      if (/^users\/[0-9a-f]{24}\.json$/.test(blob.pathname)) urls.push(blob.url);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  const bodies = await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        return res.ok ? ((await res.json()) as UserProfile) : null;
      } catch {
        return null;
      }
    })
  );
  for (const p of bodies) {
    if (p && UID_RE.test(p.uid ?? "")) out.push(p);
  }
  return out.sort((a, b) => b.lastSeen - a.lastSeen);
}
