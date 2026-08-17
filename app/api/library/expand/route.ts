import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { appendExtras, blobConfigured, readExtras } from "@/lib/server/library";
import { checkPinHeader } from "@/lib/server/adminAuth";
import { PERSONAS } from "@/lib/personas";
import { PHRASE_LIBRARY } from "@/lib/phrases";
import { CATEGORY_BRIEF, EXPANDABLE_CATEGORIES } from "@/lib/phraseCategories";
import type { PersonaId, Phrase, PhraseCategory } from "@/lib/types";

export const maxDuration = 60;

// Generates brand-new library phrases for a persona (text only — the client
// renders audio for them afterwards via /api/library/render) and appends them
// to the persona's extras.json in Blob. Pass a category to top up just that
// bank; omit it for a spread across everything that can be expanded.

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
  let body: { persona?: string; count?: number; category?: string };
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

  const only = body.category as PhraseCategory | undefined;
  if (only && !EXPANDABLE_CATEGORIES.includes(only)) {
    return NextResponse.json({ error: `${only} is a fixed set` }, { status: 400 });
  }

  // Show the model what already exists so it doesn't rewrite it. Scoped to the
  // category being topped up, which is both a sharper steer and a much better
  // use of the sample than 40 lines of unrelated material.
  const existing = [...PHRASE_LIBRARY[persona], ...(await readExtras(persona))];
  const pool = only ? existing.filter((ph) => ph.category === only) : existing;
  const sample = pool
    .slice(-40)
    .map((ph) => (only ? `- ${ph.text}` : `- (${ph.category}) ${ph.text}`))
    .join("\n");

  const brief = only
    ? `Write ${count} new phrases for the "${only}" category only. That category is: ` +
      `${CATEGORY_BRIEF[only]}.\n\nRespond with ONLY a JSON array, no other text: ` +
      `[{"text": "..."}] — exactly ${count} items.`
    : "Categories and their meanings:\n" +
      EXPANDABLE_CATEGORIES.map((c) => `- ${c}: ${CATEGORY_BRIEF[c]}`).join("\n") +
      "\n\nRespond with ONLY a JSON array, no other text: " +
      `[{"category": "...", "text": "..."}] — exactly ${count} items, spread across the ` +
      "categories.";

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 3000,
      system:
        `${p.stylePrompt}\n\n` +
        "You are expanding this persona's running-coach phrase library. Each phrase is one " +
        "spoken line of at most 40 words, no stage directions, no quotes, no emoji. Every " +
        "line must be clearly different in idea and wording from the ones you are shown.\n\n" +
        brief,
      messages: [
        {
          role: "user",
          content: sample
            ? `Phrases already in this bank — do not repeat these ideas:\n${sample}\n\nGenerate ${count} new ones.`
            : `Generate ${count} new phrases.`,
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
        category:
          only ??
          (EXPANDABLE_CATEGORIES.includes(item.category as PhraseCategory)
            ? (item.category as PhraseCategory)
            : "encourage"),
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
