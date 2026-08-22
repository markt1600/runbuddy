import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  requestOrigin,
  signSession,
  verifyHandoff,
} from "@/lib/server/auth";

// The last hop of the native sign-in: the WebView loads this URL with the
// deep-linked handoff token, and walks away with the ordinary 180-day
// session cookie — from here on the native app is indistinguishable from a
// signed-in browser. Invalid or expired tokens just land on the app root,
// signed out, where the login button still works.
export async function GET(req: NextRequest) {
  const home = NextResponse.redirect(`${requestOrigin(req)}/`);
  const user = verifyHandoff(req.nextUrl.searchParams.get("token") ?? undefined);
  if (user) {
    home.cookies.set(SESSION_COOKIE, signSession(user), {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      maxAge: 180 * 86_400,
      path: "/",
    });
  }
  return home;
}
