import { del, list, put } from "@vercel/blob";
import { blobConfigured } from "./library";
import { uidHash, type SessionUser } from "./auth";
import { listRunsByHash, moveRunsBetweenHashes } from "./runs";

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
  // Self-reported, editable on the account screen. Stored canonically metric
  // whatever units the user types in — the display unit is just a preference.
  age?: number;
  heightCm?: number;
  weightKg?: number;
  gender?: "female" | "male";
  units?: "metric" | "imperial";
  /**
   * Where "home" is, city level — travel mode fires when a run's GPS says
   * somewhere else. Manually set on the account screen, or auto-filled from
   * the first saved run's city when empty (and never auto-overwritten after).
   */
  homeCity?: string;
  /** Providers linked ONTO this canonical account (e.g. ["apple"]). */
  linked?: string[];
  /**
   * uid hashes this user has added as friends. Friendship is only ACTIVE
   * when mutual — both lists contain each other — so nobody's runs (with
   * their GPS routes) are visible to someone they never added back.
   */
  friends?: string[];
  /** Spotify OAuth tokens, AES-sealed (lib/server/spotify.ts) — never plaintext. */
  spotify?: string;
}

/** The subset of the profile the account screen may edit. */
export interface ProfileEdits {
  age?: number | null;
  heightCm?: number | null;
  weightKg?: number | null;
  gender?: "female" | "male" | null;
  units?: "metric" | "imperial";
  homeCity?: string | null;
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

async function writeProfile(profile: UserProfile): Promise<void> {
  await put(profilePath(profile.uid), JSON.stringify(profile), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
}

/** Best-effort on every login — a failed write costs a stale lastSeen, no more. */
export async function recordUserLogin(user: SessionUser): Promise<void> {
  if (!blobConfigured()) return;
  const uid = uidHash(user.sub);
  let existing: UserProfile | null = null;
  try {
    existing = await readProfile(uid);
  } catch {
    /* treat as first sign-in */
  }
  // Spread the existing body first: a login must never wipe the fields the
  // user typed in on the account screen (age, height, weight, unit choice).
  await writeProfile({
    ...existing,
    uid,
    name: user.name,
    email: user.email,
    picture: user.picture,
    firstSeen: existing?.firstSeen ?? Date.now(),
    lastSeen: Date.now(),
  });
}

export async function getProfile(uid: string): Promise<UserProfile | null> {
  if (!blobConfigured()) return null;
  return readProfile(uid);
}

/** Replace this user's friends list (deduped, capped, self excluded). */
export async function setFriends(uid: string, friends: string[]): Promise<boolean> {
  if (!blobConfigured()) return false;
  const existing = await readProfile(uid);
  if (!existing) return false;
  const clean = [...new Set(friends)]
    .filter((f) => UID_RE.test(f) && f !== uid)
    .slice(0, 200);
  await writeProfile({ ...existing, friends: clean });
  return true;
}

/**
 * Apply account-screen edits. `null` clears a field (the user emptied the
 * box); `undefined` leaves it alone. Returns the stored profile, or null when
 * there's nothing to hang the edits on (never signed in, or no blob store).
 */
export async function updateProfile(
  uid: string,
  edits: ProfileEdits
): Promise<UserProfile | null> {
  if (!blobConfigured()) return null;
  const existing = await readProfile(uid);
  if (!existing) return null;
  const next: UserProfile = { ...existing };
  for (const key of ["age", "heightCm", "weightKg"] as const) {
    const v = edits[key];
    if (v === null) delete next[key];
    else if (typeof v === "number") next[key] = v;
  }
  if (edits.gender === null) delete next.gender;
  else if (edits.gender) next.gender = edits.gender;
  if (edits.units) next.units = edits.units;
  if (edits.homeCity === null) delete next.homeCity;
  else if (typeof edits.homeCity === "string") next.homeCity = edits.homeCity;
  await writeProfile(next);
  return next;
}

/**
 * Auto-fill from a saved run's city, only while the field is empty — a manual
 * value (or an earlier auto-fill) is never overwritten, so travel mode still
 * fires on every later run away from home.
 */
export async function setProfileHomeCityIfUnset(uid: string, city: string): Promise<void> {
  if (!blobConfigured()) return;
  const existing = await readProfile(uid);
  if (!existing || existing.homeCity) return;
  await writeProfile({ ...existing, homeCity: city });
}

// ---- Account linking ----
// One small blob per LINKED identity, keyed by that identity's uid hash,
// containing the canonical account's sub: every sign-in path looks its
// provider identity up here first and, when a link exists, proceeds as the
// canonical account — so Google and Apple land in the same runs and profile.
// The raw canonical sub in the body is the same sensitivity class as the
// email the profile blob already stores; pathnames stay underivable.

interface AccountLink {
  sub: string; // the canonical account
  provider: string; // what kind of identity was linked ("google" | "apple")
  linkedAt: number;
}

const linkPath = (uid: string) => `links/${uid}.json`;

/** The canonical sub this provider identity is linked to, or null. */
export async function getLinkedCanonicalSub(linkedSub: string): Promise<string | null> {
  if (!blobConfigured()) return null;
  const pathname = linkPath(uidHash(linkedSub));
  try {
    const page = await list({ prefix: pathname, limit: 1 });
    const hit = page.blobs.find((b) => b.pathname === pathname);
    if (!hit) return null;
    const res = await fetch(hit.url, { cache: "no-store" });
    if (!res.ok) return null;
    const link = (await res.json()) as AccountLink;
    return typeof link.sub === "string" && link.sub ? link.sub : null;
  } catch {
    return null;
  }
}

/**
 * Link a provider identity onto a canonical account. Returns an error string
 * for the user, or null on success (idempotent when already linked here).
 */
export async function createAccountLink(
  linkedSub: string,
  canonicalSub: string,
  provider: string
): Promise<string | null> {
  if (!blobConfigured()) return "no storage connected";
  if (linkedSub === canonicalSub) return "that is already this account";
  const existing = await getLinkedCanonicalSub(linkedSub);
  if (existing === canonicalSub) return null; // already linked here — done
  if (existing) return "that identity is already linked to a different account";

  const link: AccountLink = { sub: canonicalSub, provider, linkedAt: Date.now() };
  await put(linkPath(uidHash(linkedSub)), JSON.stringify(link), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
  // Remember on the canonical profile, for the account screen's display.
  const profile = await readProfile(uidHash(canonicalSub)).catch(() => null);
  if (profile) {
    const linked = Array.from(new Set([...(profile.linked ?? []), provider]));
    await writeProfile({ ...profile, linked }).catch(() => {});
  }
  return null;
}

/**
 * Fold the other account's profile gaps into the main one — main's values
 * always win, empties fill from the absorbed side (including the sealed
 * Spotify connection) — then delete the orphaned profile blob so the admin
 * directory doesn't show a ghost.
 */
async function absorbProfile(mainUid: string, otherUid: string): Promise<void> {
  const [main, other] = await Promise.all([readProfile(mainUid), readProfile(otherUid)]);
  if (main && other) {
    const next: UserProfile = { ...main };
    if (next.age === undefined) next.age = other.age;
    if (next.heightCm === undefined) next.heightCm = other.heightCm;
    if (next.weightKg === undefined) next.weightKg = other.weightKg;
    if (next.gender === undefined) next.gender = other.gender;
    if (next.units === undefined) next.units = other.units;
    if (next.homeCity === undefined) next.homeCity = other.homeCity;
    if (next.spotify === undefined) next.spotify = other.spotify;
    await writeProfile(next);
  }
  if (other) {
    try {
      const pathname = profilePath(otherUid);
      const page = await list({ prefix: pathname, limit: 1 });
      const hit = page.blobs.find((b) => b.pathname === pathname);
      if (hit) await del(hit.url);
    } catch {
      /* a stale ghost in the admin list, nothing worse */
    }
  }
}

/**
 * Link two identities into ONE account, the way a runner thinks about it:
 * whichever side has more runs is the MAIN account, the other identity's
 * runs are moved into it, and from then on either sign-in opens the main
 * account. Ties (usually 0–0) keep the currently signed-in side as main.
 * Returns the canonical sub, or an error message for the user.
 */
export async function linkAndMerge(
  sessionSub: string,
  otherSub: string
): Promise<{ canonicalSub: string } | { error: string }> {
  if (!blobConfigured()) return { error: "no storage connected" };
  if (sessionSub === otherSub) return { canonicalSub: sessionSub };
  const existing = await getLinkedCanonicalSub(otherSub);
  if (existing === sessionSub) return { canonicalSub: sessionSub }; // already done
  if (existing) return { error: "that identity is already linked to a different account" };

  const [runsSession, runsOther] = await Promise.all([
    listRunsByHash(uidHash(sessionSub)).catch(() => []),
    listRunsByHash(uidHash(otherSub)).catch(() => []),
  ]);
  const main = runsOther.length > runsSession.length ? otherSub : sessionSub;
  const other = main === sessionSub ? otherSub : sessionSub;

  // Order matters for crash-safety: runs first (restartable), then profile,
  // then the link record — logins only start resolving to main once
  // everything they should find there has arrived.
  await moveRunsBetweenHashes(uidHash(other), uidHash(main));
  await absorbProfile(uidHash(main), uidHash(other)).catch(() => {});
  const err = await createAccountLink(
    other,
    main,
    other.startsWith("apple:") ? "apple" : "google"
  );
  if (err) return { error: err };
  return { canonicalSub: main };
}

/** Store (or clear) the sealed Spotify tokens on a profile. */
export async function setProfileSpotify(uid: string, sealed: string | null): Promise<void> {
  if (!blobConfigured()) return;
  const existing = await readProfile(uid);
  if (!existing) return;
  const next: UserProfile = { ...existing };
  if (sealed === null) delete next.spotify;
  else next.spotify = sealed;
  await writeProfile(next);
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
