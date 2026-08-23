import { NextRequest, NextResponse } from "next/server";
import {
  readSession,
  requestOrigin,
  signLinkIntent,
  uidHash,
} from "@/lib/server/auth";
import { verifyAppleIdentityToken } from "@/lib/server/apple";
import { listRunsByHash } from "@/lib/server/runs";
import { createAccountLink } from "@/lib/server/users";

export const dynamic = "force-dynamic";

// Account linking, both directions.
//
// POST: link an APPLE identity onto the signed-in (canonical) account — the
// shell already ran Apple's native sheet, so the identity token arrives
// inline and the link is written right here. An Apple identity that already
// has its own run history is refused: that would be a merge, not a link.
//
// GET: start linking a GOOGLE identity — returns the login URL (with a
// signed link intent) for the shell to open in the browser sheet; the OAuth
// callback finishes the link and deep-links back into the app.

export async function POST(req: NextRequest) {
  const session = readSession(req);
  if (!session) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { identityToken?: string } | null;
  if (!body?.identityToken) {
    return NextResponse.json({ error: "identityToken required" }, { status: 400 });
  }
  const verified = await verifyAppleIdentityToken(body.identityToken);
  if (!verified) return NextResponse.json({ error: "invalid token" }, { status: 401 });

  const linkedSub = `apple:${verified.sub}`;
  if (linkedSub !== session.sub) {
    const runs = await listRunsByHash(uidHash(linkedSub)).catch(() => []);
    if (runs.length > 0) {
      return NextResponse.json(
        { error: "that Apple ID already has its own run history" },
        { status: 409 }
      );
    }
    const err = await createAccountLink(linkedSub, session.sub, "apple").catch(
      () => "link failed"
    );
    if (err) return NextResponse.json({ error: err }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const session = readSession(req);
  if (!session) return NextResponse.json({ error: "sign in first" }, { status: 401 });
  const url =
    `${requestOrigin(req)}/api/auth/login?native=1` +
    `&linkToken=${encodeURIComponent(signLinkIntent(session.sub))}`;
  return NextResponse.json({ url });
}
