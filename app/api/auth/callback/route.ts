import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  STATE_COOKIE,
  authConfigured,
  requestOrigin,
  signSession,
} from "@/lib/server/auth";
import { recordUserLogin } from "@/lib/server/users";

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

    const user = {
      sub: payload.sub,
      name: payload.name ?? payload.email ?? "Runner",
      email: payload.email,
      picture: payload.picture,
    };
    home.cookies.set(SESSION_COOKIE, signSession(user), {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      maxAge: 180 * 86_400,
      path: "/",
    });
    // Registry for the admin user directory. Awaited: serverless functions
    // can be reclaimed the moment the response returns, so fire-and-forget
    // writes silently vanish. Best-effort — sign-in never fails over it.
    try {
      await recordUserLogin(user);
    } catch {
      /* profile write is not worth blocking a login */
    }
    return home;
  } catch {
    return home;
  }
}
