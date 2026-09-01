import { NextRequest, NextResponse } from "next/server";
import { readSession, uidHash } from "@/lib/server/auth";
import { blobConfigured } from "@/lib/server/library";
import { listNotifications } from "@/lib/server/notifications";
import { getProfile, setNotificationsRead } from "@/lib/server/users";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** The alert inbox, newest first, with where read-state currently stands. */
export async function GET(req: NextRequest) {
  const user = readSession(req);
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const self = uidHash(user.sub);
  const [items, profile] = await Promise.all([listNotifications(self), getProfile(self)]);
  return NextResponse.json({ items, readAt: profile?.notificationsReadAt ?? 0 });
}

/** Mark everything read — fired when the Friends screen opens. */
export async function POST(req: NextRequest) {
  const user = readSession(req);
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  await setNotificationsRead(uidHash(user.sub));
  return NextResponse.json({ ok: true });
}
