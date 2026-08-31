import { NextRequest, NextResponse } from "next/server";
import { blobConfigured } from "@/lib/server/library";
import { getRunByHash } from "@/lib/server/runs";
import { UID_RE } from "@/lib/server/users";
import { requireAdmin } from "@/lib/server/auth";

// Admin: one user's full run payload — the same shape the runner's own
// detail page loads, so the admin view IS the runner's view. Read-only:
// conform and delete stay owner-only.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ uid: string; id: string }> }
) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const { uid, id } = await ctx.params;
  if (!UID_RE.test(uid)) return NextResponse.json({ error: "bad uid" }, { status: 400 });
  const run = await getRunByHash(uid, id);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(run);
}
