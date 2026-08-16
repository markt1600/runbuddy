import { NextResponse } from "next/server";
import {
  blobConfigured,
  elevenLabsConfigured,
  listRendered,
  readExtras,
} from "@/lib/server/library";
import { readVoiceSettings } from "@/lib/server/voiceSettings";
import { PERSONAS } from "@/lib/personas";
import type { PersonaId } from "@/lib/types";

export const dynamic = "force-dynamic";

// Reports whether runtime rendering is possible, which phrases already have
// blob-rendered audio, and the AI-generated extra phrases per persona.
export async function GET() {
  try {
    const canRender = blobConfigured() && elevenLabsConfigured();
    const rendered = blobConfigured() ? await listRendered() : {};
    const personaIds = Object.keys(PERSONAS) as PersonaId[];
    const [voiceSettings, ...extrasList] = await Promise.all([
      readVoiceSettings(),
      ...personaIds.map((p) => readExtras(p)),
    ]);
    const extras = Object.fromEntries(
      personaIds.map((p, i) => [p, extrasList[i]])
    ) as Record<PersonaId, Awaited<ReturnType<typeof readExtras>>>;
    return NextResponse.json({
      elevenlabs: elevenLabsConfigured(),
      blob: blobConfigured(),
      canRender,
      rendered, // { "<persona>/<id>": url }
      extras,
      voiceSettings,
    });
  } catch {
    return NextResponse.json({ error: "status unavailable" }, { status: 503 });
  }
}
