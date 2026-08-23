import { createPublicKey, verify as cryptoVerify } from "node:crypto";

// Verifying an Apple identity token (a JWT the native sheet produced):
// Apple's signature checked against Apple's published keys, then issuer,
// bundle-id audience and expiry. No client secret involved — used by both
// the sign-in route and the account-linking route.

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

/** The verified payload, or null when anything about the token fails. */
export async function verifyAppleIdentityToken(
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
