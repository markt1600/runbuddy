import { NextRequest, NextResponse } from "next/server";
import { readSession, uidHash } from "@/lib/server/auth";
import { nowPlayingFor } from "@/lib/server/spotify";

export const dynamic = "force-dynamic";

// What the signed-in runner is listening to right now — polled by the run
// screen so the coach can react to the music. {connected:false} covers every
// can't-answer case; the client stops polling on it.
export async function GET(req: NextRequest) {
  const session = readSession(req);
  if (!session) return NextResponse.json({ connected: false });
  try {
    return NextResponse.json(await nowPlayingFor(uidHash(session.sub)));
  } catch {
    return NextResponse.json({ connected: false });
  }
}
