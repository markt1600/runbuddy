import { NextRequest, NextResponse } from "next/server";
import { generateLine, renderVoice } from "@/lib/server/generate";
import { PERSONAS } from "@/lib/personas";
import type { PersonaId } from "@/lib/types";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  let body: { persona?: string; message?: string; context?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const persona = body.persona as PersonaId;
  if (!persona || !(persona in PERSONAS)) {
    return NextResponse.json({ error: "unknown persona" }, { status: 400 });
  }
  const message = (body.message ?? "").trim().slice(0, 500);
  if (!message) {
    return NextResponse.json({ error: "empty message" }, { status: 400 });
  }

  try {
    const text = await generateLine(
      persona,
      `Mid-run, the runner just said to you: "${message}". Reply to them in your persona.`,
      body.context ?? {}
    );
    const audioBase64 = await renderVoice(persona, text);
    return NextResponse.json(audioBase64 ? { text, audioBase64 } : { text });
  } catch {
    return NextResponse.json({ error: "generation unavailable" }, { status: 503 });
  }
}
