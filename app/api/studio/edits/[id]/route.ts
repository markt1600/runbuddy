import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { checkPinHeader } from "@/lib/server/adminAuth";
import {
  blobConfigured,
  deleteRenderedAudio,
  readExtras,
  readOverrides,
  setOverride,
} from "@/lib/server/library";
import {
  getEditSession,
  writeEditSession,
  type PhraseEditSession,
} from "@/lib/server/phraseEdits";
import { PHRASE_LIBRARY } from "@/lib/phrases";

// One edit session, hydrated for review: every pending suggestion beside the
// current live text. Accept writes the persona's override AND deletes the
// phrase's rendered audio (it says the old words now) so "Render missing"
// regenerates it with the corrected text.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function guard(req: NextRequest): NextResponse | null {
  const denied = requireAdmin(req);
  if (denied) return denied;
  if (!checkPinHeader(req)) return NextResponse.json({ error: "bad pin" }, { status: 403 });
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  return null;
}

// Hydrates from the session OBJECT, never a fresh blob read — a verdict
// response built by re-reading the session it just wrote can get the stale
// pre-write copy from the edge and echo "nothing changed" back to the UI.
// overridesPatch covers the just-accepted text the overrides blob may not
// serve yet, for the same reason.
async function hydrate(
  session: PhraseEditSession,
  overridesPatch?: Record<string, string>
) {
  const [extras, overrides] = await Promise.all([
    readExtras(session.persona),
    readOverrides(session.persona),
  ]);
  const effective = { ...overrides, ...(overridesPatch ?? {}) };
  const current = new Map(
    [...PHRASE_LIBRARY[session.persona], ...extras].map((p) => [
      p.id,
      { category: p.category, text: effective[p.id] ?? p.text },
    ])
  );
  const resolved = session.resolved ?? {};
  const items = Object.entries(session.suggestions ?? {})
    .filter(([id]) => current.has(id))
    .map(([id, suggested]) => ({
      id,
      category: current.get(id)!.category,
      original: current.get(id)!.text,
      suggested,
      verdict: resolved[id] ?? null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { session, items };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const session = await getEditSession(id);
  if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(await hydrate(session));
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const session = await getEditSession(id);
  if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as {
    action?: string;
    phraseId?: string;
    text?: string;
    knownResolved?: Record<string, string>;
  } | null;
  const phraseId = body?.phraseId ?? "";
  const suggested = session.suggestions?.[phraseId];
  if (!suggested) return NextResponse.json({ error: "no such suggestion" }, { status: 400 });

  // Anti-lost-update merge: if THIS read got a stale copy missing verdicts
  // written moments ago, the client's view of them fills the holes (the
  // fresher server copy wins any conflict). Without this, rejecting several
  // phrases quickly could silently resurrect the earlier ones.
  if (body?.knownResolved && typeof body.knownResolved === "object") {
    const fill: Record<string, "accepted" | "rejected"> = {};
    for (const [k, v] of Object.entries(body.knownResolved)) {
      if ((v === "accepted" || v === "rejected") && session.suggestions?.[k]) fill[k] = v;
    }
    session.resolved = { ...fill, ...(session.resolved ?? {}) };
  }

  if (body?.action === "amend") {
    // The admin polishes the suggestion (typos etc.) — it stays a PENDING
    // suggestion and still needs an explicit accept to go live.
    const text = (body?.text ?? "").trim().slice(0, 600);
    if (text.length < 2) return NextResponse.json({ error: "text too short" }, { status: 400 });
    session.suggestions = { ...(session.suggestions ?? {}), [phraseId]: text };
    if (session.resolved?.[phraseId]) {
      const resolved = { ...session.resolved };
      delete resolved[phraseId];
      session.resolved = resolved;
    }
    await writeEditSession(session);
    return NextResponse.json(await hydrate(session));
  }

  if (body?.action === "accept") {
    // Order matters: the override must be live before the audio dies, so a
    // concurrent gap-fill render can only ever cut the NEW text.
    await setOverride(session.persona, phraseId, suggested);
    await deleteRenderedAudio(session.persona, phraseId);
    session.resolved = { ...(session.resolved ?? {}), [phraseId]: "accepted" };
  } else if (body?.action === "reject") {
    session.resolved = { ...(session.resolved ?? {}), [phraseId]: "rejected" };
  } else {
    return NextResponse.json({ error: "bad action" }, { status: 400 });
  }
  await writeEditSession(session);
  return NextResponse.json(
    await hydrate(session, body.action === "accept" ? { [phraseId]: suggested } : undefined)
  );
}
