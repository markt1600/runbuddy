import { NextRequest, NextResponse } from "next/server";
import { readSession, uidHash } from "@/lib/server/auth";
import { blobConfigured } from "@/lib/server/library";
import { addFriend, listFriends, removeFriend } from "@/lib/server/friends";
import { runningMap } from "@/lib/server/presence";
import { UID_RE } from "@/lib/server/users";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** My friends, with mutuality — plus my own uid, so the client can address
 *  comment routes for runs it owns. */
export async function GET(req: NextRequest) {
  const user = readSession(req);
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const self = uidHash(user.sub);
  const friends = await listFriends(self);
  // Live presence, mutual friends only — "Running" right in the list.
  const running = await runningMap(friends.filter((f) => f.mutual).map((f) => f.uid));
  return NextResponse.json({
    self,
    friends: friends.map((f) => ({ ...f, running: running[f.uid] === true })),
  });
}

export async function POST(req: NextRequest) {
  const user = readSession(req);
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const body = (await req.json().catch(() => null)) as { uid?: string } | null;
  const target = body?.uid ?? "";
  if (!UID_RE.test(target)) return NextResponse.json({ error: "bad uid" }, { status: 400 });
  const ok = await addFriend(uidHash(user.sub), target);
  return ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "cannot add" }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const user = readSession(req);
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const target = req.nextUrl.searchParams.get("uid") ?? "";
  if (!UID_RE.test(target)) return NextResponse.json({ error: "bad uid" }, { status: 400 });
  const ok = await removeFriend(uidHash(user.sub), target);
  return ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "cannot remove" }, { status: 400 });
}
