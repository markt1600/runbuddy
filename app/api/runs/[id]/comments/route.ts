import { NextRequest, NextResponse } from "next/server";
import { readSession, uidHash } from "@/lib/server/auth";
import { blobConfigured } from "@/lib/server/library";
import { addComment, readComments } from "@/lib/server/friends";

// The owner's view of the comments friends left on their run — plus the
// ability to reply on their own thread.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = readSession(req);
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const { id } = await ctx.params;
  return NextResponse.json({ comments: await readComments(uidHash(user.sub), id) });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = readSession(req);
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { text?: string } | null;
  const text = (body?.text ?? "").trim().slice(0, 400);
  if (!text) return NextResponse.json({ error: "empty comment" }, { status: 400 });
  const self = uidHash(user.sub);
  const comments = await addComment(self, id, {
    uid: self,
    name: user.name,
    text,
    at: Date.now(),
  });
  return NextResponse.json({ comments });
}
