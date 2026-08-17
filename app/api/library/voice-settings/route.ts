import { NextRequest, NextResponse } from "next/server";
import {
  SPEED_MAX,
  SPEED_MIN,
  VOLUME_MAX,
  VOLUME_MIN,
  writeVoiceSettings,
} from "@/lib/server/voiceSettings";
import { blobConfigured } from "@/lib/server/library";
import { checkPinHeader } from "@/lib/server/adminAuth";
import { PERSONAS } from "@/lib/personas";
import type { PersonaId } from "@/lib/types";

// Admin-only: adjust a persona's voice speed or playback level. Speed applies
// to future renders (re-render existing audio to hear it everywhere); volume
// is applied at play time and takes effect on the next run with no re-render.
export async function POST(req: NextRequest) {
  if (!checkPinHeader(req)) {
    return NextResponse.json({ error: "admin PIN required" }, { status: 401 });
  }
  if (!blobConfigured()) {
    return NextResponse.json({ error: "Vercel Blob not connected" }, { status: 503 });
  }
  let body: { persona?: string; speed?: number; volume?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const persona = body.persona as PersonaId;
  if (!persona || !(persona in PERSONAS)) {
    return NextResponse.json({ error: "unknown persona" }, { status: 400 });
  }

  const patch: { speed?: number; volume?: number } = {};
  if (body.speed !== undefined) {
    const speed = Number(body.speed);
    if (!isFinite(speed) || speed < SPEED_MIN || speed > SPEED_MAX) {
      return NextResponse.json(
        { error: `speed must be between ${SPEED_MIN} and ${SPEED_MAX}` },
        { status: 400 }
      );
    }
    patch.speed = speed;
  }
  if (body.volume !== undefined) {
    const volume = Number(body.volume);
    if (!isFinite(volume) || volume < VOLUME_MIN || volume > VOLUME_MAX) {
      return NextResponse.json(
        { error: `volume must be between ${VOLUME_MIN} and ${VOLUME_MAX}` },
        { status: 400 }
      );
    }
    patch.volume = volume;
  }
  if (patch.speed === undefined && patch.volume === undefined) {
    return NextResponse.json({ error: "nothing to change" }, { status: 400 });
  }

  try {
    const settings = await writeVoiceSettings(persona, patch);
    return NextResponse.json({ settings });
  } catch {
    return NextResponse.json({ error: "save failed" }, { status: 502 });
  }
}
