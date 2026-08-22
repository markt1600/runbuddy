import { NextRequest, NextResponse } from "next/server";
import {
  NATIVE_AUTH_COOKIE,
  STATE_COOKIE,
  authConfigured,
  newStateToken,
  requestOrigin,
} from "@/lib/server/auth";

// Kicks off the Google authorization-code flow. The redirect URI is this
// deployment's /api/auth/callback — add it in the Google Cloud console.
export async function GET(req: NextRequest) {
  if (!authConfigured()) {
    return NextResponse.json({ error: "Google sign-in is not configured" }, { status: 503 });
  }
  const state = newStateToken();
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${requestOrigin(req)}/api/auth/callback`,
    response_type: "code",
    scope: "openid email profile",
    prompt: "select_account",
    state,
  });
  const res = NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  );
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 600,
    path: "/",
  });
  // The native app signs in through the system browser (?native=1); the flag
  // rides a cookie so the callback knows to hand off via deep link instead of
  // setting a cookie the WebView will never see.
  if (req.nextUrl.searchParams.get("native") === "1") {
    res.cookies.set(NATIVE_AUTH_COOKIE, "1", {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      maxAge: 600,
      path: "/",
    });
  }
  return res;
}
