import { NextRequest, NextResponse } from "next/server";
import { newStateToken, readSession, requestOrigin } from "@/lib/server/auth";
import { spotifyConfigured } from "@/lib/server/spotify";

const SPOTIFY_STATE_COOKIE = "runbuddy-spotify-state";

// Connect Spotify to the signed-in account: what's-playing reads for the
// coach, plus playback control for the run screen's transport buttons.
// Kicked off from the account screen. Accounts connected before the control
// scope existed keep working read-only; the run screen notices the 403 and
// offers the reconnect.
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
    scope: "user-read-currently-playing user-read-playback-state user-modify-playback-state",
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
