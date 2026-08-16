import { NextRequest, NextResponse } from "next/server";
import { blobConfigured, elevenLabsConfigured, renderPhraseToBlob } from "@/lib/server/library";
import { PERSONAS } from "@/lib/personas";
import type { PersonaId } from "@/lib/types";

export const maxDuration = 30;

// Renders a single library phrase into Vercel Blob. The client drives the
// full-library generation by calling this once per missing phrase, which keeps
// each invocation comfortably inside serverless limits and gives the UI
// natural per-phrase progress.
export async function POST(req: NextRequest) {
  if (!blobConfigured() || !elevenLabsConfigured()) {
    return NextResponse.json({ error: "rendering not configured" }, { status: 503 });
  }
  let body: { persona?: string; id?: string; force?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const persona = body.persona as PersonaId;
  if (!persona || !(persona in PERSONAS) || typeof body.id !== "string") {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  try {
    const { url, existed } = await renderPhraseToBlob(persona, body.id, body.force === true);
    return NextResponse.json({ id: body.id, persona, url, existed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "render failed";
    const status = message === "unknown phrase" ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
