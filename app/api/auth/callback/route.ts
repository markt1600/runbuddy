import { NextRequest, NextResponse } from "next/server";
import {
  NATIVE_AUTH_COOKIE,
  NATIVE_LINK_COOKIE,
  SESSION_COOKIE,
  STATE_COOKIE,
  authConfigured,
  requestOrigin,
  signHandoff,
  signSession,
  uidHash,
  verifyLinkIntent,
} from "@/lib/server/auth";
import { listRunsByHash } from "@/lib/server/runs";
import { createAccountLink, getLinkedCanonicalSub, getProfile, recordUserLogin } from "@/lib/server/users";

// Google redirects back here with a one-time code; trade it for an identity
// and set the session cookie. The id_token arrives directly from Google's
// token endpoint over TLS, so decoding without JWKS verification is sound —
// the claims still get checked.
export async function GET(req: NextRequest) {
  const home = NextResponse.redirect(`${requestOrigin(req)}/`);
  home.cookies.delete(STATE_COOKIE);
  if (!authConfigured()) return home;

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expectedState = req.cookies.get(STATE_COOKIE)?.value;
  if (!code || !state || !expectedState || state !== expectedState) return home;

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${requestOrigin(req)}/api/auth/callback`,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) return home;
    const tokens: { id_token?: string } = await tokenRes.json();
    if (!tokens.id_token) return home;

    const payload = JSON.parse(
      Buffer.from(tokens.id_token.split(".")[1], "base64url").toString()
    );
    const issOk = payload.iss === "https://accounts.google.com" || payload.iss === "accounts.google.com";
    if (!issOk || payload.aud !== process.env.GOOGLE_CLIENT_ID) return home;
    if (typeof payload.sub !== "string" || payload.sub.length === 0) return home;

    let user = {
      sub: payload.sub,
      name: payload.name ?? payload.email ?? "Runner",
      email: payload.email,
      picture: payload.picture,
    };

    // Account linking completion: a signed intent cookie means the runner —
    // already signed in as another (canonical) account in the app — asked
    // for THIS Google identity to be linked onto it. Write the link, then
    // fall through into the normal native handoff signed in as the
    // canonical account. A Google identity that already has runs of its own
    // is refused (that's a merge, not a link) via the deep link's reason.
    const linkIntent = verifyLinkIntent(req.cookies.get(NATIVE_LINK_COOKIE)?.value);
    if (linkIntent) {
      let reason: string | null = null;
      if (linkIntent !== user.sub) {
        const runs = await listRunsByHash(uidHash(user.sub)).catch(() => []);
        reason =
          runs.length > 0
            ? "that Google account already has its own run history"
            : await createAccountLink(user.sub, linkIntent, "google");
      }
      if (reason) {
        const failed = NextResponse.redirect(
          `runbuddy://linked?ok=0&reason=${encodeURIComponent(reason)}`
        );
        failed.cookies.delete(STATE_COOKIE);
        failed.cookies.delete(NATIVE_AUTH_COOKIE);
        failed.cookies.delete(NATIVE_LINK_COOKIE);
        return failed;
      }
      const canonicalProfile = await getProfile(uidHash(linkIntent)).catch(() => null);
      user = {
        sub: linkIntent,
        name: canonicalProfile?.name ?? user.name,
        email: canonicalProfile?.email ?? user.email,
        picture: canonicalProfile?.picture ?? user.picture,
      };
    } else {
      // A LINKED Google identity signs in as its canonical account — both
      // providers land in the same runs and profile, on web and in the app.
      const canonical = await getLinkedCanonicalSub(user.sub).catch(() => null);
      if (canonical) user = { ...user, sub: canonical };
    }

    // Registry for the admin user directory. Awaited: serverless functions
    // can be reclaimed the moment the response returns, so fire-and-forget
    // writes silently vanish. Best-effort — sign-in never fails over it.
    try {
      await recordUserLogin(user);
    } catch {
      /* profile write is not worth blocking a login */
    }

    // Native flow: this response lands in the SYSTEM browser, whose cookies
    // the app's WebView never sees — hand the identity back through the deep
    // link instead, as a 60-second token the WebView trades for its own
    // cookie at /api/auth/native-complete.
    if (req.cookies.get(NATIVE_AUTH_COOKIE)?.value === "1") {
      const native = NextResponse.redirect(
        `runbuddy://auth?token=${encodeURIComponent(signHandoff(user))}`
      );
      native.cookies.delete(STATE_COOKIE);
      native.cookies.delete(NATIVE_AUTH_COOKIE);
      native.cookies.delete(NATIVE_LINK_COOKIE);
      return native;
    }

    home.cookies.set(SESSION_COOKIE, signSession(user), {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      maxAge: 180 * 86_400,
      path: "/",
    });
    return home;
  } catch {
    return home;
  }
}
