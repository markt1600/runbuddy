import { NextRequest, NextResponse } from "next/server";
import { readSession, uidHash } from "@/lib/server/auth";
import { blobConfigured } from "@/lib/server/library";
import { setPresence } from "@/lib/server/presence";

// The run screen's heartbeat: marks this user as mid-run so friends see
// "Running" and can aim a shoutout at right now. Fired every ~75s during a
// signed-in run; staleness is how a run "ends" as far as presence goes.

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST(req: NextRequest) {
  const user = readSession(req);
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  await setPresence(uidHash(user.sub));
  return NextResponse.json({ ok: true });
}
