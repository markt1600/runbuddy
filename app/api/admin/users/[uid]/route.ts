import { NextRequest, NextResponse } from "next/server";
import { blobConfigured } from "@/lib/server/library";
import { enrichedRunsByHash } from "@/lib/server/runs";
import { UID_RE } from "@/lib/server/users";
import { requireAdmin } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest, ctx: { params: Promise<{ uid: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const { uid } = await ctx.params;
  if (!UID_RE.test(uid)) return NextResponse.json({ error: "bad uid" }, { status: 400 });
  return NextResponse.json({ runs: await enrichedRunsByHash(uid) });
}
