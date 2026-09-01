import { NextRequest, NextResponse } from "next/server";
import { readSession, uidHash } from "@/lib/server/auth";
import { blobConfigured } from "@/lib/server/library";
import { addComment, isMutual, readComments } from "@/lib/server/friends";
import { notify } from "@/lib/server/notifications";
import { UID_RE } from "@/lib/server/users";

// Comments on a run: readable and writable by the run's owner and their
// MUTUAL friends — the same circle that can see the run at all.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function allowed(selfUid: string, ownerUid: string): Promise<boolean> {
  return selfUid === ownerUid || isMutual(selfUid, ownerUid);
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ uid: string; id: string }> }
) {
  const user = readSession(req);
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const { uid, id } = await ctx.params;
  if (!UID_RE.test(uid)) return NextResponse.json({ error: "bad uid" }, { status: 400 });
  if (!(await allowed(uidHash(user.sub), uid))) {
    return NextResponse.json({ error: "not friends" }, { status: 403 });
  }
  return NextResponse.json({ comments: await readComments(uid, id) });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ uid: string; id: string }> }
) {
  const user = readSession(req);
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const { uid, id } = await ctx.params;
  if (!UID_RE.test(uid)) return NextResponse.json({ error: "bad uid" }, { status: 400 });
  const selfUid = uidHash(user.sub);
  if (!(await allowed(selfUid, uid))) {
    return NextResponse.json({ error: "not friends" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as { text?: string } | null;
  const text = (body?.text ?? "").trim().slice(0, 400);
  if (!text) return NextResponse.json({ error: "empty comment" }, { status: 400 });
  const comments = await addComment(uid, id, {
    uid: selfUid,
    name: user.name,
    text,
    at: Date.now(),
  });
  if (selfUid !== uid) {
    await notify(uid, {
      type: "comment",
      text: `💬 ${user.name} commented on your run: “${text.slice(0, 80)}”`,
      runId: id,
      friendUid: selfUid,
      fromName: user.name,
    });
  }
  return NextResponse.json({ comments });
}
