import { NextRequest, NextResponse } from "next/server";
import { readSession, uidHash } from "@/lib/server/auth";
import { blobConfigured } from "@/lib/server/library";
import { friendFeed } from "@/lib/server/friends";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Recent runs from every MUTUAL friend, newest first. */
export async function GET(req: NextRequest) {
  const user = readSession(req);
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  return NextResponse.json({ items: await friendFeed(uidHash(user.sub)) });
}
