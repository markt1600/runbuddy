import { NextRequest, NextResponse } from "next/server";
import { generateLine, renderVoice } from "@/lib/server/generate";
import { PERSONAS } from "@/lib/personas";
import type { PersonaId, PhraseCategory } from "@/lib/types";

export const maxDuration = 30;

const INSTRUCTIONS: Partial<Record<PhraseCategory, string>> = {
  intro:
    "The runner just pressed start and is standing at the start line. Deliver an opening " +
    "pep talk of about 10 seconds — 30 to 45 words. Greet them, work in the time of day, " +
    "weather or location if provided, set the tone for the run, and launch them into it. " +
    "Make it feel different every time.",
  anecdote:
    "Share one surprising, true-flavoured fact, anecdote or nugget of wisdom about running, " +
    "fitness, food or life — delivered fully in your persona.",
  encourage: "Give the runner one line of motivation in your persona.",
  milestone:
    "The runner just completed another kilometre and you already announced the number and " +
    "average pace. Add ONE line of improvised colour commentary on top — react to their pace, " +
    "the weather, where they are, or the time of day. Don't repeat the kilometre count.",
  summary:
    "The runner just FINISHED their run — this is your closing comment on the whole thing. " +
    "React to their actual numbers (distance, time, pace or speed) in your persona: proud, " +
    "backhanded, whatever fits. Send them off wanting to come back tomorrow.",
};

export async function POST(req: NextRequest) {
  let body: { persona?: string; category?: string; context?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const persona = body.persona as PersonaId;
  if (!persona || !(persona in PERSONAS)) {
    return NextResponse.json({ error: "unknown persona" }, { status: 400 });
  }
  const category = (body.category ?? "anecdote") as PhraseCategory;
  const instruction = INSTRUCTIONS[category] ?? INSTRUCTIONS.anecdote!;

  try {
    const text = await generateLine(persona, instruction, body.context ?? {});
    const audioBase64 = await renderVoice(persona, text);
    return NextResponse.json(audioBase64 ? { text, audioBase64 } : { text });
  } catch {
    return NextResponse.json({ error: "generation unavailable" }, { status: 503 });
  }
}
