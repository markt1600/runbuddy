import { NextRequest, NextResponse } from "next/server";
import { readSession, uidHash } from "@/lib/server/auth";
import { controlFor, type SpotifyControlAction } from "@/lib/server/spotify";

export const dynamic = "force-dynamic";

const ACTIONS: SpotifyControlAction[] = ["play", "pause", "next", "previous"];

// The run screen's transport buttons: drive the runner's own Spotify app
// through the Web API, so the phone can stay in Run Buddy (or in a sleeve).
export async function POST(req: NextRequest) {
  const session = readSession(req);
  if (!session) return NextResponse.json({ ok: false, reason: "notConnected" });
  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  const action = ACTIONS.find((a) => a === body?.action);
  if (!action) {
    return NextResponse.json({ ok: false, reason: "error" }, { status: 400 });
  }
  try {
    return NextResponse.json(await controlFor(uidHash(session.sub), action));
  } catch {
    return NextResponse.json({ ok: false, reason: "error" });
  }
}
