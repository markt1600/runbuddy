import { NextRequest, NextResponse } from "next/server";
import { blobConfigured } from "@/lib/server/library";
import { getSession, ITEM_ID_RE, saveTake } from "@/lib/server/studio";

// One take, uploaded as raw WAV. Overwrites are the re-record path.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ token: string; itemId: string }> }
) {
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const { token, itemId } = await ctx.params;
  if (!ITEM_ID_RE.test(itemId)) return NextResponse.json({ error: "bad item" }, { status: 400 });
  const session = await getSession(token);
  if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!session.license) return NextResponse.json({ error: "license first" }, { status: 403 });

  const buf = Buffer.from(await req.arrayBuffer());
  // A 90s mono 44.1kHz/16-bit read is ~8MB; anything past 40MB is a mistake.
  if (buf.length < 1000 || buf.length > 40_000_000) {
    return NextResponse.json({ error: "bad audio size" }, { status: 400 });
  }
  await saveTake(token, itemId, buf);
  return NextResponse.json({ ok: true });
}
