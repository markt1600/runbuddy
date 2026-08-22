import { NextRequest, NextResponse } from "next/server";
import { readSession, requestOrigin, uidHash } from "@/lib/server/auth";
import { exchangeCode, spotifyConfigured } from "@/lib/server/spotify";
import { setProfileSpotify } from "@/lib/server/users";

const SPOTIFY_STATE_COOKIE = "runbuddy-spotify-state";

// Spotify redirects back with a code; trade it for tokens, seal them into
// the profile. Every failure lands back on the app — the account screen
// simply still shows "Connect Spotify".
export async function GET(req: NextRequest) {
  const home = NextResponse.redirect(`${requestOrigin(req)}/`);
  home.cookies.delete(SPOTIFY_STATE_COOKIE);
  if (!spotifyConfigured()) return home;

  const session = readSession(req);
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expected = req.cookies.get(SPOTIFY_STATE_COOKIE)?.value;
  if (!session || !code || !state || !expected || state !== expected) return home;

  try {
    const sealed = await exchangeCode(code, `${requestOrigin(req)}/api/spotify/callback`);
    if (sealed) await setProfileSpotify(uidHash(session.sub), sealed);
  } catch {
    /* connection just doesn't happen */
  }
  return home;
}
