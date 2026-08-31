import { NextRequest, NextResponse } from "next/server";
import { readSession, uidHash } from "@/lib/server/auth";
import { blobConfigured } from "@/lib/server/library";
import { isMutual } from "@/lib/server/friends";
import { getRunByHash } from "@/lib/server/runs";
import { UID_RE } from "@/lib/server/users";

// A friend's full run payload — same shape as the runner's own detail —
// gated on MUTUAL friendship. Read-only by construction: no PUT, no DELETE.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ uid: string; id: string }> }
) {
  const user = readSession(req);
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const { uid, id } = await ctx.params;
  if (!UID_RE.test(uid)) return NextResponse.json({ error: "bad uid" }, { status: 400 });
  if (!(await isMutual(uidHash(user.sub), uid))) {
    return NextResponse.json({ error: "not friends" }, { status: 403 });
  }
  const run = await getRunByHash(uid, id);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(run);
}
