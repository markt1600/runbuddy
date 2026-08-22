import { NextRequest, NextResponse } from "next/server";
import { readSession, requestOrigin, signSpotifyConnect } from "@/lib/server/auth";
import { SPOTIFY_SCOPES, spotifyConfigured } from "@/lib/server/spotify";

export const dynamic = "force-dynamic";

// The shell's Connect Spotify: the OAuth must run in the system browser
// sheet, whose cookie jar has neither our session nor a state cookie — so
// the signed-in WEBVIEW asks here for a ready-made authorize URL whose state
// parameter carries the signed identity, then opens it in the sheet. The
// callback recognises that state and finishes with a runbuddy:// deep link
// instead of a web redirect.
export async function GET(req: NextRequest) {
  if (!spotifyConfigured()) {
    return NextResponse.json({ error: "Spotify is not configured" }, { status: 503 });
  }
  const session = readSession(req);
  if (!session) {
    return NextResponse.json({ error: "sign in first" }, { status: 401 });
  }
  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID!,
    response_type: "code",
    redirect_uri: `${requestOrigin(req)}/api/spotify/callback`,
    scope: SPOTIFY_SCOPES,
    state: signSpotifyConnect(session.sub),
  });
  return NextResponse.json({
    url: `https://accounts.spotify.com/authorize?${params.toString()}`,
  });
}
