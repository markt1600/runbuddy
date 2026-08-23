import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

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

// ---- Native sign-in handoff ----
// Google refuses OAuth inside WKWebViews, so the native app signs in through
// the SYSTEM browser. That browser's cookies never reach the WebView, so the
// callback hands the identity back through a deep link as a short-lived
// single-purpose token, which /api/auth/native-complete (loaded BY the
// WebView) exchanges for the normal session cookie. 60 seconds of validity —
// it lives exactly as long as the redirect hop it rides.

export const NATIVE_AUTH_COOKIE = "runbuddy-native-auth";

export function signHandoff(user: SessionUser): string {
  const payload = b64url(
    Buffer.from(JSON.stringify({ ...user, exp: Date.now() + 60_000 }))
  );
  return `h1.${payload}.${hmac(`h1.${payload}`)}`;
}

export function verifyHandoff(token: string | undefined): SessionUser | null {
  if (!token || !secret()) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "h1") return null;
  const expected = Buffer.from(hmac(`h1.${parts[1]}`));
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

export function newStateToken(): string {
  return b64url(randomBytes(24));
}

// ---- Account linking ----
// Linking Google onto an Apple-canonical account runs the Google OAuth in
// the system browser sheet, which has no session cookie — so the WebView
// first mints this signed intent ("the signed-in account <sub> wants the
// NEXT Google identity linked to it") and the login route carries it to the
// callback in a cookie. Ten minutes, single purpose.

export const NATIVE_LINK_COOKIE = "runbuddy-native-link";

export function signLinkIntent(sub: string): string {
  const payload = b64url(
    Buffer.from(JSON.stringify({ sub, n: b64url(randomBytes(12)), exp: Date.now() + 600_000 }))
  );
  return `l1.${payload}.${hmac(`l1.${payload}`)}`;
}

/** The canonical sub that asked for the link, or null. */
export function verifyLinkIntent(token: string | undefined): string | null {
  if (!token || !secret()) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "l1") return null;
  const expected = Buffer.from(hmac(`l1.${parts[1]}`));
  const got = Buffer.from(parts[2]);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const data = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (typeof data.sub !== "string" || typeof data.exp !== "number") return null;
    if (data.exp < Date.now()) return null;
    return data.sub;
  } catch {
    return null;
  }
}

// ---- Native Spotify connect ----
// In the shell, the Spotify OAuth runs in the system browser sheet, whose
// cookie jar never holds the app's session — so the OAuth state parameter
// carries the signed identity itself, minted for the signed-in WebView user
// just before the sheet opens. Signed + nonced it still serves its CSRF
// purpose. Ten minutes of validity: the flow includes a human reading
// Spotify's consent page (and possibly logging in).

export function signSpotifyConnect(sub: string): string {
  const payload = b64url(
    Buffer.from(
      JSON.stringify({ sub, n: b64url(randomBytes(12)), exp: Date.now() + 600_000 })
    )
  );
  return `s1.${payload}.${hmac(`s1.${payload}`)}`;
}

/** The connecting user's sub, or null for anything but a fresh signed state. */
export function verifySpotifyConnect(state: string | undefined): string | null {
  if (!state || !secret()) return null;
  const parts = state.split(".");
  if (parts.length !== 3 || parts[0] !== "s1") return null;
  const expected = Buffer.from(hmac(`s1.${parts[1]}`));
  const got = Buffer.from(parts[2]);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const data = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (typeof data.sub !== "string" || typeof data.exp !== "number") return null;
    if (data.exp < Date.now()) return null;
    return data.sub;
  } catch {
    return null;
  }
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

// ---- Admin visibility gate ----

/**
 * ADMIN_EMAIL (comma-separated allowed) hides the admin entry point from
 * everyone else. The gate only arms when sign-in is configured — with no way
 * to BE the admin, hiding admin would just lock the owner out. It gates
 * visibility; the ADMIN_PIN on credit-spending endpoints stays as the second
 * layer, because a hidden link is not security.
 */
export function adminGateActive(): boolean {
  return authConfigured() && !!process.env.ADMIN_EMAIL;
}

export function isAdminEmail(email: string | undefined): boolean {
  if (!email || !process.env.ADMIN_EMAIL) return false;
  const normalized = email.trim().toLowerCase();
  return process.env.ADMIN_EMAIL.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalized);
}

/**
 * Guard for admin-only APIs (the user directory exposes other people's names
 * and emails). Demands the strongest check the app has: a signed-in session
 * matching ADMIN_EMAIL. Deliberately no PIN fallback — a PIN can be typed by
 * anyone who learns it; an email gate cannot. Returns the denial response, or
 * null when the caller is the admin.
 */
export function requireAdmin(req: NextRequest): NextResponse | null {
  if (!adminGateActive()) {
    return NextResponse.json(
      { error: "Set ADMIN_EMAIL (with Google sign-in configured) to enable the user directory" },
      { status: 503 }
    );
  }
  const session = readSession(req);
  if (!session || !isAdminEmail(session.email)) {
    return NextResponse.json({ error: "admin account required" }, { status: 403 });
  }
  return null;
}
