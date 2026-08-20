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
  pace_up:
    "The runner is going SLOWER than they should — behind their target pace if the stats " +
    "give one, otherwise noticeably off their own average for this run. Call it out and " +
    "get them moving again, fully in your persona. One line. Don't quote numbers at them " +
    "— they can see those.",
  pace_down:
    "The runner's pace is GOOD — on or ahead of their target pace if the stats give one, " +
    "otherwise faster than their own average for this run. React to that in your persona " +
    "and get them to hold it. One line. Don't quote numbers at them.",
  milestone:
    "The runner just completed another kilometre. You have already announced the number and " +
    "the split for that kilometre out loud. Add ONE line of improvised colour commentary on " +
    "top — react to how that kilometre went, the weather, where they are, or the time of day. " +
    "Do not repeat the kilometre count or restate the pace as a figure.",
  progress:
    "The runner is chasing a target distance and just crossed a checkpoint on the way there. " +
    "The stats tell you what percent they've done and how far is left. React to exactly where " +
    "they are in the effort — early going, halfway, or the final push — in your persona. " +
    "Mention the distance remaining naturally. Do not repeat the percentage as a bare number.",
  target_hit:
    "The runner just REACHED the target distance they set out to do. React to that in your " +
    "persona — this is the moment they earned.",
  loitering:
    "The run is PAUSED because the runner stopped moving, and they have now been standing " +
    "still for a long time — the stats tell you exactly how long. You have already needled " +
    "them about it several times and they still haven't moved, so this line escalates: go " +
    "further than you would have a minute ago, fully in your persona. Do not mention their " +
    "pace or speed — they aren't moving. One line.",
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
