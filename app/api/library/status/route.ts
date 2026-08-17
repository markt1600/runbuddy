import { NextResponse } from "next/server";
import {
  blobConfigured,
  elevenLabsConfigured,
  listRendered,
  readExtras,
  readRenderHashes,
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
    const [voiceSettings, extrasList, hashList] = await Promise.all([
      readVoiceSettings(),
      Promise.all(personaIds.map((p) => readExtras(p))),
      Promise.all(personaIds.map((p) => readRenderHashes(p))),
    ]);
    const extras = Object.fromEntries(
      personaIds.map((p, i) => [p, extrasList[i]])
    ) as Record<PersonaId, Awaited<ReturnType<typeof readExtras>>>;
    const renderHashes = Object.fromEntries(
      personaIds.map((p, i) => [p, hashList[i]])
    ) as Record<PersonaId, Record<string, string>>;
    return NextResponse.json({
      elevenlabs: elevenLabsConfigured(),
      blob: blobConfigured(),
      canRender,
      rendered, // { "<persona>/<id>": url }
      renderHashes, // { <persona>: { <id>: textHash } } — what the audio says
      extras,
      voiceSettings,
    });
  } catch {
    return NextResponse.json({ error: "status unavailable" }, { status: 503 });
  }
}
