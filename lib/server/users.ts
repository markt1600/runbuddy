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
