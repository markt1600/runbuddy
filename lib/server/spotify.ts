import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getProfile, setProfileSpotify } from "./users";

// Spotify connection: OAuth tokens live encrypted inside the user's profile
// blob. The blob store serves public-but-unguessable URLs — fine for names
// and run stats, not for a refresh token — so tokens are sealed with
// AES-256-GCM under a key derived from AUTH_SECRET before they ever leave
// the function.

export function spotifyConfigured(): boolean {
  return !!(
    process.env.SPOTIFY_CLIENT_ID &&
    process.env.SPOTIFY_CLIENT_SECRET &&
    process.env.AUTH_SECRET
  );
}

interface SpotifyTokens {
  refreshToken: string;
  accessToken: string;
  expiresAt: number; // ms epoch
}

const key = () =>
  createHash("sha256").update(`spotify:${process.env.AUTH_SECRET ?? ""}`).digest();

export function sealTokens(tokens: SpotifyTokens): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(tokens), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64url");
}

export function openTokens(sealed: string): SpotifyTokens | null {
  try {
    const raw = Buffer.from(sealed, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const dec = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
    return JSON.parse(dec.toString("utf8")) as SpotifyTokens;
  } catch {
    return null; // wrong AUTH_SECRET, corrupted blob — treat as not connected
  }
}

const basicAuth = () =>
  Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString("base64");

/** Exchange the OAuth code for tokens. Returns the sealed blob to store. */
export async function exchangeCode(code: string, redirectUri: string): Promise<string | null> {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) return null;
  const data: { access_token?: string; refresh_token?: string; expires_in?: number } =
    await res.json();
  if (!data.access_token || !data.refresh_token) return null;
  return sealTokens({
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000,
  });
}

export interface NowPlaying {
  connected: boolean;
  playing?: boolean;
  track?: string;
  artist?: string;
}

/**
 * The user's current Spotify track. Refreshes the access token when stale
 * (and re-seals the profile, best-effort) — Spotify access tokens live an
 * hour, runs regularly outlast that.
 */
export async function nowPlayingFor(uid: string): Promise<NowPlaying> {
  if (!spotifyConfigured()) return { connected: false };
  const profile = await getProfile(uid).catch(() => null);
  const sealed = profile?.spotify;
  if (!sealed) return { connected: false };
  let tokens = openTokens(sealed);
  if (!tokens) return { connected: false };

  if (Date.now() >= tokens.expiresAt) {
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth()}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
      }),
    });
    if (!res.ok) {
      // Revoked at Spotify's end — clear so the account screen offers
      // reconnect instead of silently failing forever.
      if (res.status === 400 || res.status === 401) {
        await setProfileSpotify(uid, null).catch(() => {});
      }
      return { connected: false };
    }
    const data: { access_token?: string; refresh_token?: string; expires_in?: number } =
      await res.json();
    if (!data.access_token) return { connected: false };
    tokens = {
      refreshToken: data.refresh_token ?? tokens.refreshToken,
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000,
    };
    await setProfileSpotify(uid, sealTokens(tokens)).catch(() => {});
  }

  const res = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });
  if (res.status === 204) return { connected: true, playing: false };
  if (!res.ok) return { connected: true, playing: false };
  const data = (await res.json()) as {
    is_playing?: boolean;
    item?: { name?: string; artists?: { name: string }[] } | null;
  };
  if (!data.item?.name) return { connected: true, playing: false };
  return {
    connected: true,
    playing: data.is_playing !== false,
    track: data.item.name,
    artist: data.item.artists?.map((a) => a.name).join(", ") || undefined,
  };
}
