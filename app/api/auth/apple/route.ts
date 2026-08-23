import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, signSession, uidHash, type SessionUser } from "@/lib/server/auth";
import { verifyAppleIdentityToken } from "@/lib/server/apple";
import { getLinkedCanonicalSub, getProfile, recordUserLogin } from "@/lib/server/users";

export const dynamic = "force-dynamic";

// Sign in with Apple, native flow: the shell runs Apple's own Face ID sheet
// and hands us the resulting identity token. Verification (Apple's keys,
// audience, expiry) lives in lib/server/apple.ts; on success the same
// session cookie the Google flow mints.
//
// Name and email only ride along on the very FIRST authorization, so a
// returning user's name comes from the profile registry, not the token.
export async function POST(req: NextRequest) {
  if (!process.env.AUTH_SECRET) {
    return NextResponse.json({ error: "auth not configured" }, { status: 503 });
  }
  const body = (await req.json().catch(() => null)) as {
    identityToken?: string;
    name?: string;
    email?: string;
  } | null;
  if (!body?.identityToken) {
    return NextResponse.json({ error: "identityToken required" }, { status: 400 });
  }
  const verified = await verifyAppleIdentityToken(body.identityToken);
  if (!verified) {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  // Apple identities are namespaced so an Apple sub can never collide with a
  // Google one. A LINKED Apple identity resolves to its canonical account —
  // both buttons land in the same runs and profile.
  let sub = `apple:${verified.sub}`;
  const canonical = await getLinkedCanonicalSub(sub).catch(() => null);
  if (canonical) sub = canonical;

  const existing = await getProfile(uidHash(sub)).catch(() => null);
  const name =
    existing?.name ||
    body.name?.trim().slice(0, 80) ||
    (verified.email ? verified.email.split("@")[0] : "Runner");
  const user: SessionUser = {
    sub,
    name,
    email: existing?.email ?? verified.email ?? body.email,
    picture: existing?.picture,
  };
  await recordUserLogin(user).catch(() => {});

  const res = NextResponse.json({ ok: true, name: user.name });
  res.cookies.set(SESSION_COOKIE, signSession(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 180 * 86_400,
    path: "/",
  });
  return res;
}
