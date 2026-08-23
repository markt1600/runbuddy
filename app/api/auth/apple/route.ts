import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, signSession, uidHash, type SessionUser } from "@/lib/server/auth";
import { getProfile, recordUserLogin } from "@/lib/server/users";

export const dynamic = "force-dynamic";

// Sign in with Apple, native flow: the shell runs Apple's own Face ID sheet
// and hands us the resulting identity token (a JWT signed by Apple). No
// client secret, no OAuth dance — verification is checking Apple's signature
// with Apple's published keys, then the aud (our bundle id), issuer and
// expiry. On success the same session cookie the Google flow mints.
//
// Name and email only ride along on the very FIRST authorization, so a
// returning user's name comes from the profile registry, not the token.

const APPLE_ISS = "https://appleid.apple.com";
const BUNDLE_ID = process.env.APPLE_BUNDLE_ID ?? "ai.marktan.runbuddy";

interface AppleJwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
}

// Apple rotates keys rarely; cache for an hour so sign-ins don't each pay a
// round trip to Cupertino.
let jwksCache: { keys: AppleJwk[]; at: number } | null = null;

async function appleKeys(): Promise<AppleJwk[]> {
  if (jwksCache && Date.now() - jwksCache.at < 3_600_000) return jwksCache.keys;
  const res = await fetch("https://appleid.apple.com/auth/keys", { cache: "no-store" });
  if (!res.ok) throw new Error(`jwks ${res.status}`);
  const data = (await res.json()) as { keys?: AppleJwk[] };
  jwksCache = { keys: data.keys ?? [], at: Date.now() };
  return jwksCache.keys;
}

/** Verify the JWT against Apple's keys; the payload, or null when anything fails. */
async function verifyIdentityToken(
  token: string
): Promise<{ sub: string; email?: string } | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString()) as {
      kid?: string;
      alg?: string;
    };
    if (header.alg !== "RS256" || !header.kid) return null;
    const jwk = (await appleKeys()).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = createPublicKey({
      key: { kty: jwk.kty, n: jwk.n, e: jwk.e },
      format: "jwk",
    });
    const ok = cryptoVerify(
      "RSA-SHA256",
      Buffer.from(`${parts[0]}.${parts[1]}`),
      key,
      Buffer.from(parts[2], "base64url")
    );
    if (!ok) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString()) as {
      iss?: string;
      aud?: string;
      exp?: number;
      sub?: string;
      email?: string;
    };
    if (payload.iss !== APPLE_ISS) return null;
    if (payload.aud !== BUNDLE_ID) return null;
    if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
    if (typeof payload.sub !== "string" || !payload.sub) return null;
    return { sub: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

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
  const verified = await verifyIdentityToken(body.identityToken);
  if (!verified) {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  // Apple identities are namespaced so an Apple sub can never collide with a
  // Google one — they are separate accounts with separate runs.
  const sub = `apple:${verified.sub}`;
  const existing = await getProfile(uidHash(sub)).catch(() => null);
  const name =
    body.name?.trim().slice(0, 80) ||
    existing?.name ||
    (verified.email ? verified.email.split("@")[0] : "Runner");
  const user: SessionUser = {
    sub,
    name,
    email: verified.email ?? body.email ?? existing?.email,
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
