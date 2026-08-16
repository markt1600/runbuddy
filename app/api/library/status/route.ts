import { NextResponse } from "next/server";
import {
  blobConfigured,
  elevenLabsConfigured,
  listRendered,
  readExtras,
} from "@/lib/server/library";
import { readVoiceSettings } from "@/lib/server/voiceSettings";

export const dynamic = "force-dynamic";

// Reports whether runtime rendering is possible, which phrases already have
// blob-rendered audio, and the AI-generated extra phrases per persona.
export async function GET() {
  try {
    const canRender = blobConfigured() && elevenLabsConfigured();
    const rendered = blobConfigured() ? await listRendered() : {};
    const [ahbeng, coach, voiceSettings] = await Promise.all([
      readExtras("ahbeng"),
      readExtras("coach"),
      readVoiceSettings(),
    ]);
    return NextResponse.json({
      elevenlabs: elevenLabsConfigured(),
      blob: blobConfigured(),
      canRender,
      rendered, // { "<persona>/<id>": url }
      extras: { ahbeng, coach },
      voiceSettings,
    });
  } catch {
    return NextResponse.json({ error: "status unavailable" }, { status: 503 });
  }
}
