import { NextRequest, NextResponse } from "next/server";
import { generateCameo, generateDuo, renderVoice, type DuoKind } from "@/lib/server/generate";
import { PERSONAS } from "@/lib/personas";
import type { PersonaId } from "@/lib/types";

// The mid-run cameo: a second trainer barges in and argues with the first,
// grounded in the live stats. Written fresh every run and voiced line by line
// in each speaker's own ElevenLabs voice — this is the one feature that is
// never served from the library, so without both API keys it quietly doesn't
// exist (the client skips on any non-200).

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: {
    persona?: string;
    cameo?: string;
    mode?: string;
    context?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const persona = body.persona as PersonaId;
  const cameo = body.cameo as PersonaId;
  if (!(persona in PERSONAS) || !(cameo in PERSONAS) || persona === cameo) {
    return NextResponse.json({ error: "bad persona pair" }, { status: 400 });
  }
  // Duo mode's set pieces ride the same route and rendering: a "duet" (the
  // pair discuss the runner) or an "argument" (a 10–12 line blow-up).
  const mode: DuoKind | "cameo" =
    body.mode === "duet" || body.mode === "argument" || body.mode === "banter"
      ? body.mode
      : "cameo";

  try {
    const script =
      mode === "cameo"
        ? await generateCameo(persona, cameo, body.context ?? {})
        : await generateDuo(persona, cameo, mode, body.context ?? {});
    // Two different voices is the entire joke — all lines render or none play.
    const audio = await Promise.all(script.map((l) => renderVoice(l.persona, l.text)));
    if (audio.some((a) => a === null)) {
      return NextResponse.json({ error: "voices unavailable" }, { status: 503 });
    }
    return NextResponse.json({
      lines: script.map((l, i) => ({ ...l, audioBase64: audio[i] })),
    });
  } catch {
    return NextResponse.json({ error: "generation unavailable" }, { status: 503 });
  }
}
