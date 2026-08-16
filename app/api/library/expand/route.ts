import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { appendExtras, blobConfigured, readExtras } from "@/lib/server/library";
import { checkPinHeader } from "@/lib/server/adminAuth";
import { PERSONAS } from "@/lib/personas";
import { PHRASE_LIBRARY } from "@/lib/phrases";
import type { PersonaId, Phrase, PhraseCategory } from "@/lib/types";

export const maxDuration = 60;

// Generates a batch of brand-new library phrases for a persona (text only —
// the client renders audio for them afterwards via /api/library/render) and
// appends them to the persona's extras.json in Blob.

const EXPANDABLE: PhraseCategory[] = [
  "encourage",
  "anecdote",
  "pace_up",
  "pace_down",
  "milestone",
  "chat",
  "progress",
];

export async function POST(req: NextRequest) {
  if (!checkPinHeader(req)) {
    return NextResponse.json({ error: "admin PIN required" }, { status: 401 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 503 });
  }
  if (!blobConfigured()) {
    return NextResponse.json({ error: "Vercel Blob not connected" }, { status: 503 });
  }
  let body: { persona?: string; count?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const persona = body.persona as PersonaId;
  if (!persona || !(persona in PERSONAS)) {
    return NextResponse.json({ error: "unknown persona" }, { status: 400 });
  }
  const count = Math.min(Math.max(body.count ?? 10, 1), 15);
  const p = PERSONAS[persona];

  // Show the model a sample of what exists so new phrases don't repeat it.
  const existing = [...PHRASE_LIBRARY[persona], ...(await readExtras(persona))];
  const sample = existing
    .slice(-40)
    .map((ph) => `- (${ph.category}) ${ph.text}`)
    .join("\n");

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 3000,
      system:
        `${p.stylePrompt}\n\n` +
        "You are expanding this persona's running-coach phrase library. Each phrase is one " +
        "spoken line of at most 40 words, no stage directions, no quotes, no emoji. " +
        `Categories and their meanings: encourage (periodic motivation), anecdote (facts, ` +
        `stories, nuggets), pace_up (runner slowed down — push them), pace_down (runner sped ` +
        `up — react), milestone (a kilometre was just completed), chat (reply to a runner ` +
        `talking to you mid-run).\n\n` +
        "Respond with ONLY a JSON array, no other text: " +
        `[{"category": "...", "text": "..."}] — exactly ${count} items, spread across the ` +
        "categories, all clearly different from the existing phrases you are shown.",
      messages: [
        {
          role: "user",
          content: `Existing phrases (do not repeat these ideas):\n${sample}\n\nGenerate ${count} new phrases.`,
        },
      ],
    });
    if (response.stop_reason === "refusal") {
      return NextResponse.json({ error: "generation declined" }, { status: 502 });
    }
    const raw = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join(" ");
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("no JSON in response");
    const parsed: { category?: string; text?: string }[] = JSON.parse(jsonMatch[0]);

    const stamp = Date.now().toString(36);
    const phrases: Phrase[] = parsed
      .filter((item) => typeof item.text === "string" && item.text.trim().length > 0)
      .slice(0, count)
      .map((item, i) => ({
        id: `xg-${stamp}-${i}`,
        category: EXPANDABLE.includes(item.category as PhraseCategory)
          ? (item.category as PhraseCategory)
          : "encourage",
        text: item.text!.trim(),
      }));
    if (phrases.length === 0) throw new Error("no valid phrases");

    await appendExtras(persona, phrases);
    return NextResponse.json({ phrases });
  } catch (err) {
    const message = err instanceof Error ? err.message : "expand failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
