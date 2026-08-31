import { NextRequest, NextResponse } from "next/server";
import { readSession, uidHash } from "@/lib/server/auth";
import { blobConfigured } from "@/lib/server/library";
import {
  deleteCardBgImage,
  readCardBgImage,
  saveCardBgImage,
} from "@/lib/server/users";

// The run-card background photo, published so FRIENDS' feeds can draw this
// user's cards the way the user sees them. The device keeps its own local
// copy for offline rendering; this is the shared one.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Existence check — the account screen uses it to sync up a photo that was
 *  chosen before server-side backgrounds existed. */
export async function GET(req: NextRequest) {
  const user = readSession(req);
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const bytes = await readCardBgImage(uidHash(user.sub));
  return NextResponse.json({ exists: bytes !== null });
}

export async function PUT(req: NextRequest) {
  const user = readSession(req);
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const body = (await req.json().catch(() => null)) as { dataUrl?: string } | null;
  const m = body?.dataUrl?.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return NextResponse.json({ error: "expected a JPEG data URL" }, { status: 400 });
  const bytes = Buffer.from(m[1], "base64");
  if (bytes.length === 0 || bytes.length > 2_500_000) {
    return NextResponse.json({ error: "bad image size" }, { status: 400 });
  }
  await saveCardBgImage(uidHash(user.sub), bytes);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = readSession(req);
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  await deleteCardBgImage(uidHash(user.sub));
  return NextResponse.json({ ok: true });
}
