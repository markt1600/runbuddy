import { NextRequest, NextResponse } from "next/server";
import { readSession, uidHash } from "@/lib/server/auth";
import { blobConfigured } from "@/lib/server/library";
import { searchUsers } from "@/lib/server/friends";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Find people by name — city shown so two Sarahs are tellable apart. */
export async function GET(req: NextRequest) {
  const user = readSession(req);
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const q = req.nextUrl.searchParams.get("q") ?? "";
  return NextResponse.json({ results: await searchUsers(q, uidHash(user.sub)) });
}
