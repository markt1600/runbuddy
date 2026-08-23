import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  readSession,
  requestOrigin,
  signLinkIntent,
  signSession,
  uidHash,
  type SessionUser,
} from "@/lib/server/auth";
import { verifyAppleIdentityToken } from "@/lib/server/apple";
import { getProfile, linkAndMerge } from "@/lib/server/users";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // merging moves run blobs one by one

// Account linking, both directions, with merge-into-main semantics: the
// side with more runs becomes the MAIN account, the other identity's runs
// move into it, and either sign-in opens the main account from then on.
//
// POST: link an APPLE identity — the shell already ran Apple's native
// sheet, so the identity token arrives inline. When the merge decides the
// OTHER side is main (it had the history), the session is re-issued as the
// main account right here; the client reloads either way.
//
// GET: start linking a GOOGLE identity — returns the login URL (with a
// signed link intent) for the shell's browser sheet; the OAuth callback
// finishes the merge and deep-links back into the app.

export async function POST(req: NextRequest) {
  const session = readSession(req);
  if (!session) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { identityToken?: string } | null;
  if (!body?.identityToken) {
    return NextResponse.json({ error: "identityToken required" }, { status: 400 });
  }
  const verified = await verifyAppleIdentityToken(body.identityToken);
  if (!verified) return NextResponse.json({ error: "invalid token" }, { status: 401 });

  const result = await linkAndMerge(session.sub, `apple:${verified.sub}`).catch(() => ({
    error: "link failed — try again",
  }));
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  const res = NextResponse.json({ ok: true });
  if (result.canonicalSub !== session.sub) {
    // The Apple side turned out to be main — re-issue the session as it.
    const profile = await getProfile(uidHash(result.canonicalSub)).catch(() => null);
    const user: SessionUser = {
      sub: result.canonicalSub,
      name: profile?.name ?? session.name,
      email: profile?.email ?? session.email,
      picture: profile?.picture ?? session.picture,
    };
    res.cookies.set(SESSION_COOKIE, signSession(user), {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      maxAge: 180 * 86_400,
      path: "/",
    });
  }
  return res;
}

export async function GET(req: NextRequest) {
  const session = readSession(req);
  if (!session) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const url =
    `${requestOrigin(req)}/api/auth/login?native=1` +
    `&linkToken=${encodeURIComponent(signLinkIntent(session.sub))}`;
  return NextResponse.json({ url });
}
