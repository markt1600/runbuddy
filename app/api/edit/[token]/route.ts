import { NextRequest, NextResponse } from "next/server";
import { blobConfigured, readExtras, readOverrides } from "@/lib/server/library";
import { getEditSession, writeEditSession } from "@/lib/server/phraseEdits";
import { PHRASE_LIBRARY } from "@/lib/phrases";
import { PERSONAS } from "@/lib/personas";
import { STUDIO_BRIEFS } from "@/lib/studioReads";

// The phrase editor's API. Token is the gate, same as the booth. GET hands
// over every phrase (with accepted corrections already applied — the editor
// always corrects the CURRENT text); PUT stores the full suggestion map.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function currentPhrases(persona: keyof typeof PHRASE_LIBRARY) {
  const [extras, overrides] = await Promise.all([
    readExtras(persona),
    readOverrides(persona),
  ]);
  return [...PHRASE_LIBRARY[persona], ...extras].map((p) => ({
    id: p.id,
    category: p.category,
    text: overrides[p.id] ?? p.text,
  }));
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const { token } = await ctx.params;
  const session = await getEditSession(token);
  if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    personaName: PERSONAS[session.persona].name,
    label: session.label,
    // Only the 🔞 characters get the "add more vulgarity" nudge — Christine
    // and Cassie are clean by design.
    vulgar: ["ahbeng", "posbeng", "ahlian", "loanshark"].includes(session.persona),
    // The actor brief minus its "Delivery:" paragraph — that's direction for
    // speaking the lines, and this job is only editing them.
    brief: STUDIO_BRIEFS[session.persona]
      .split("\n\n")
      .filter((p) => !p.startsWith("Delivery:"))
      .join("\n\n"),
    phrases: await currentPhrases(session.persona),
    suggestions: session.suggestions ?? {},
    resolved: session.resolved ?? {},
    cursor: session.cursor ?? 0,
    submittedAt: session.submittedAt ?? 0,
  });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const { token } = await ctx.params;
  const session = await getEditSession(token);
  if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as {
    suggestions?: Record<string, string>;
    cursor?: number;
  } | null;
  if (!body?.suggestions || typeof body.suggestions !== "object") {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  const known = new Map((await currentPhrases(session.persona)).map((p) => [p.id, p.text]));
  const next: Record<string, string> = {};
  for (const [id, raw] of Object.entries(body.suggestions)) {
    if (!known.has(id) || typeof raw !== "string") continue;
    const text = raw.trim().slice(0, 600);
    // Only real changes count as suggestions.
    if (text.length < 2 || text === known.get(id)) continue;
    next[id] = text;
  }
  // A re-edit reopens a resolved phrase — it's a fresh suggestion now.
  const resolved = { ...(session.resolved ?? {}) };
  for (const id of Object.keys(next)) {
    if (resolved[id] && session.suggestions?.[id] !== next[id]) delete resolved[id];
  }
  session.suggestions = next;
  session.resolved = resolved;
  if (typeof body.cursor === "number" && isFinite(body.cursor)) {
    session.cursor = Math.max(0, Math.min(known.size - 1, Math.round(body.cursor)));
  }
  await writeEditSession(session);
  return NextResponse.json({ ok: true, changed: Object.keys(next).length });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const { token } = await ctx.params;
  const session = await getEditSession(token);
  if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  if (body?.action !== "submit") {
    return NextResponse.json({ error: "bad action" }, { status: 400 });
  }
  session.submittedAt = Date.now();
  await writeEditSession(session);
  return NextResponse.json({ ok: true, submittedAt: session.submittedAt });
}
