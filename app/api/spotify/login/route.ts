import { NextRequest, NextResponse } from "next/server";
import { newStateToken, readSession, requestOrigin } from "@/lib/server/auth";
import { spotifyConfigured } from "@/lib/server/spotify";

const SPOTIFY_STATE_COOKIE = "runbuddy-spotify-state";

// Connect Spotify to the signed-in account: read-only scopes, just enough
// for the coach to know what's playing. Kicked off from the account screen.
export async function GET(req: NextRequest) {
  if (!spotifyConfigured()) {
    return NextResponse.json({ error: "Spotify is not configured" }, { status: 503 });
  }
  if (!readSession(req)) {
    return NextResponse.redirect(`${requestOrigin(req)}/`);
  }
  const state = newStateToken();
  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID!,
    response_type: "code",
    redirect_uri: `${requestOrigin(req)}/api/spotify/callback`,
    scope: "user-read-currently-playing user-read-playback-state",
    state,
  });
  const res = NextResponse.redirect(
    `https://accounts.spotify.com/authorize?${params.toString()}`
  );
  res.cookies.set(SPOTIFY_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 600,
    path: "/",
  });
  return res;
}
