import { NextRequest, NextResponse } from "next/server";
import { SPEED_MAX, SPEED_MIN, writeVoiceSpeed } from "@/lib/server/voiceSettings";
import { blobConfigured } from "@/lib/server/library";
import { checkPinHeader } from "@/lib/server/adminAuth";
import { PERSONAS } from "@/lib/personas";
import type { PersonaId } from "@/lib/types";

// Admin-only: adjust a persona's voice speed. Applies to all future renders
// (re-render existing audio from the admin screen to hear it everywhere).
export async function POST(req: NextRequest) {
  if (!checkPinHeader(req)) {
    return NextResponse.json({ error: "admin PIN required" }, { status: 401 });
  }
  if (!blobConfigured()) {
    return NextResponse.json({ error: "Vercel Blob not connected" }, { status: 503 });
  }
  let body: { persona?: string; speed?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const persona = body.persona as PersonaId;
  const speed = Number(body.speed);
  if (!persona || !(persona in PERSONAS) || !isFinite(speed)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (speed < SPEED_MIN || speed > SPEED_MAX) {
    return NextResponse.json(
      { error: `speed must be between ${SPEED_MIN} and ${SPEED_MAX}` },
      { status: 400 }
    );
  }
  try {
    const settings = await writeVoiceSpeed(persona, speed);
    return NextResponse.json({ settings });
  } catch {
    return NextResponse.json({ error: "save failed" }, { status: 502 });
  }
}
