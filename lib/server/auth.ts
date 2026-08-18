import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

// Google sign-in via the classic server-side authorization-code flow, with a
// self-signed session cookie. No auth library: the flow is three fetches and
// an HMAC, and the app's other integrations already follow this shape —
// unconfigured means the feature quietly doesn't exist, never a broken button.

export interface SessionUser {
  sub: string; // Google's stable account id — the only key runs are stored under
  name: string;
  email?: string;
  picture?: string;
}

export const SESSION_COOKIE = "runbuddy-session";
export const STATE_COOKIE = "runbuddy-oauth-state";
const SESSION_DAYS = 180;

export function authConfigured(): boolean {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.AUTH_SECRET
  );
}

const b64url = (buf: Buffer) => buf.toString("base64url");
const secret = () => process.env.AUTH_SECRET ?? "";

function hmac(data: string): string {
  return b64url(createHmac("sha256", secret()).update(data).digest());
}

/** v1.<payload>.<mac> — payload is base64url JSON of the user plus expiry. */
export function signSession(user: SessionUser): string {
  const payload = b64url(
    Buffer.from(
      JSON.stringify({ ...user, exp: Date.now() + SESSION_DAYS * 86_400_000 })
    )
  );
  return `v1.${payload}.${hmac(`v1.${payload}`)}`;
}

export function verifySession(token: string | undefined): SessionUser | null {
  if (!token || !secret()) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const expected = Buffer.from(hmac(`v1.${parts[1]}`));
  const got = Buffer.from(parts[2]);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const data = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (typeof data.sub !== "string" || typeof data.exp !== "number") return null;
    if (data.exp < Date.now()) return null;
    return { sub: data.sub, name: data.name ?? "", email: data.email, picture: data.picture };
  } catch {
    return null;
  }
}

export function readSession(req: NextRequest): SessionUser | null {
  return verifySession(req.cookies.get(SESSION_COOKIE)?.value);
}

export function newStateToken(): string {
  return b64url(randomBytes(24));
}

/** The deployment's own origin, trusting Vercel's forwarding headers. */
export function requestOrigin(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

/**
 * Prefix runs are stored under. An HMAC rather than the raw Google id: the
 * blob store serves public URLs, so pathnames must not be derivable from
 * anything a stranger could know.
 */
export function uidHash(sub: string): string {
  return createHmac("sha256", secret()).update(`uid:${sub}`).digest("hex").slice(0, 24);
}
