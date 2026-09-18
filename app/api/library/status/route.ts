import { NextResponse } from "next/server";
import {
  blobConfigured,
  elevenLabsConfigured,
  listPromoted,
  listRendered,
  readExtras,
  readOverrides,
  readLoudness,
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
    const renderedFull = blobConfigured() ? await listRendered() : {};
    // Split into the url map the client has always consumed plus a parallel
    // map of when each file was cut, so the admin listing can date the rows.
    const rendered = Object.fromEntries(
      Object.entries(renderedFull).map(([k, v]) => [k, v.url])
    );
    const renderedAt = Object.fromEntries(
      Object.entries(renderedFull).map(([k, v]) => [k, v.at])
    );
    const personaIds = Object.keys(PERSONAS) as PersonaId[];
    const [voiceSettings, extrasList, hashList, promoted, overridesList, loudnessList] = await Promise.all([
      readVoiceSettings(),
      Promise.all(personaIds.map((p) => readExtras(p))),
      Promise.all(personaIds.map((p) => readRenderHashes(p))),
      listPromoted(),
      Promise.all(personaIds.map((p) => readOverrides(p))),
      Promise.all(personaIds.map((p) => readLoudness(p))),
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
      renderedAt, // { "<persona>/<id>": ISO timestamp of the recording }
      renderHashes, // { <persona>: { <id>: textHash } } — what the audio says
      promoted, // [ "<persona>/<id>" ] — audio that is a real actor's take
      // { <persona>: { <id>: text } } — human-corrected phrase wording
      overrides: Object.fromEntries(personaIds.map((p, i) => [p, overridesList[i]])),
      extras,
      voiceSettings,
      // { <persona>: { avgDb, files: { <id>: dBFS } } | null } — per-clip levels
      loudness: Object.fromEntries(personaIds.map((p, i) => [p, loudnessList[i]])),
    });
  } catch {
    return NextResponse.json({ error: "status unavailable" }, { status: 503 });
  }
}
