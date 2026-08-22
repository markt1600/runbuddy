import { NextRequest, NextResponse } from "next/server";
import { readSession, requestOrigin, uidHash, verifySpotifyConnect } from "@/lib/server/auth";
import { exchangeCode, spotifyConfigured } from "@/lib/server/spotify";
import { setProfileSpotify } from "@/lib/server/users";

const SPOTIFY_STATE_COOKIE = "runbuddy-spotify-state";

// Spotify redirects back with a code; trade it for tokens, seal them into
// the profile. Two return paths, told apart by the state parameter:
//
// Web: state matches the cookie set by /api/spotify/login, identity comes
// from the session cookie, and every outcome lands back on the app.
//
// Native: the flow ran in the system browser sheet (no session, no state
// cookie there), so the state IS a signed identity minted by
// /api/spotify/native-start — and the way back into the app is the
// runbuddy:// deep link, which closes the sheet instead of stranding the
// runner on the website in Safari.
export async function GET(req: NextRequest) {
  const home = NextResponse.redirect(`${requestOrigin(req)}/`);
  home.cookies.delete(SPOTIFY_STATE_COOKIE);
  if (!spotifyConfigured()) return home;

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");

  const nativeSub = verifySpotifyConnect(state ?? undefined);
  if (nativeSub) {
    let ok = false;
    if (code) {
      try {
        const sealed = await exchangeCode(code, `${requestOrigin(req)}/api/spotify/callback`);
        if (sealed) {
          await setProfileSpotify(uidHash(nativeSub), sealed);
          ok = true;
        }
      } catch {
        /* connection just doesn't happen */
      }
    }
    return NextResponse.redirect(`runbuddy://spotify?ok=${ok ? "1" : "0"}`);
  }

  const session = readSession(req);
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
