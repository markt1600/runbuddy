import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { checkPinHeader } from "@/lib/server/adminAuth";
import {
  blobConfigured,
  listRendered,
  readExtras,
  readOverrides,
} from "@/lib/server/library";
import {
  deleteSession,
  getSession,
  ITEM_ID_RE,
  listTakes,
  writeSession,
} from "@/lib/server/studio";
import { CLONE_READS, readsFor, TEST_PHRASES, TEST_READS } from "@/lib/studioReads";
import { PHRASE_LIBRARY } from "@/lib/phrases";

// One session, fully hydrated for the review screen: every recordable item
// with the actor's take (if any) and the current live library audio beside it.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  if (!checkPinHeader(req)) return NextResponse.json({ error: "bad pin" }, { status: 403 });
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });

  const { id } = await ctx.params;
  const session = await getSession(id);
  if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [takes, rendered, extras, overrides] = await Promise.all([
    listTakes(id),
    listRendered(),
    readExtras(session.persona),
    readOverrides(session.persona),
  ]);
  const takeMap = new Map(takes.map((t) => [t.itemId, t]));

  if (session.cloneOnly) {
    const items = CLONE_READS.map((r) => ({
      id: r.id,
      kind: "read" as const,
      text: r.text,
      title: r.title,
      takeUrl: takeMap.get(r.id)?.url ?? null,
      takeAt: takeMap.get(r.id)?.at ?? null,
      libUrl: null,
    }));
    return NextResponse.json({ session, items });
  }

  if (session.test) {
    const items = [
      ...TEST_PHRASES.map((p) => ({
        id: p.id,
        kind: "phrase" as const,
        text: p.text,
        takeUrl: takeMap.get(p.id)?.url ?? null,
        takeAt: takeMap.get(p.id)?.at ?? null,
        libUrl: null,
      })),
      ...TEST_READS.map((r) => ({
        id: r.id,
        kind: "read" as const,
        text: r.text,
        title: r.title,
        takeUrl: takeMap.get(r.id)?.url ?? null,
        takeAt: takeMap.get(r.id)?.at ?? null,
        libUrl: null,
      })),
    ];
    return NextResponse.json({ session, items });
  }

  // Same corrected text the booth showed — takes are reviewed against the
  // words the actor was actually asked to read.
  const phraseItems = [...PHRASE_LIBRARY[session.persona], ...extras].map((p) => ({
    id: p.id,
    kind: "phrase" as const,
    text: overrides[p.id] ?? p.text,
    takeUrl: takeMap.get(p.id)?.url ?? null,
    takeAt: takeMap.get(p.id)?.at ?? null,
    libUrl: rendered[`${session.persona}/${p.id}`]?.url ?? null,
  }));
  const readItems = readsFor(session.persona).map((r) => ({
    id: r.id,
    kind: "read" as const,
    text: r.text,
    title: r.title,
    takeUrl: takeMap.get(r.id)?.url ?? null,
    takeAt: takeMap.get(r.id)?.at ?? null,
    libUrl: null,
  }));

  return NextResponse.json({ session, items: [...phraseItems, ...readItems] });
}

/** Withdraw the invitation: the link dies and every take goes with it. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  if (!checkPinHeader(req)) return NextResponse.json({ error: "bad pin" }, { status: 403 });
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const { id } = await ctx.params;
  await deleteSession(id);
  return NextResponse.json({ ok: true });
}

/** Flag / unflag an item for re-record. The actor's page (same link) shows
 *  flagged items as "re-record requested" until a newer take lands. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  if (!checkPinHeader(req)) return NextResponse.json({ error: "bad pin" }, { status: 403 });
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });

  const { id } = await ctx.params;
  const session = await getSession(id);
  if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as {
    action?: string;
    itemId?: string;
    note?: string;
  } | null;
  // Fee updates ride the same route (no itemId involved); the amount only
  // matters until signing, since the signed licence snapshots its contents.
  if (body?.action === "fee") {
    const fee = Number((body as { feeSgd?: number }).feeSgd);
    if (!isFinite(fee) || fee <= 0) {
      return NextResponse.json({ error: "bad fee" }, { status: 400 });
    }
    session.feeSgd = Math.max(0, Math.min(100_000, fee));
    await writeSession(session);
    return NextResponse.json({ session });
  }
  if (body?.action === "deadline") {
    const at = Number((body as { deadlineAt?: number }).deadlineAt);
    if (!isFinite(at) || at <= Date.now()) {
      return NextResponse.json({ error: "bad deadline" }, { status: 400 });
    }
    session.deadlineAt = at;
    await writeSession(session);
    return NextResponse.json({ session });
  }

  const itemId = body?.itemId ?? "";
  if (!ITEM_ID_RE.test(itemId)) return NextResponse.json({ error: "bad item" }, { status: 400 });

  const flags = (session.flags ?? []).filter((f) => f.itemId !== itemId);
  if (body?.action === "flag") {
    flags.push({ itemId, note: body?.note?.slice(0, 200) || undefined, at: Date.now() });
  } else if (body?.action !== "unflag") {
    return NextResponse.json({ error: "bad action" }, { status: 400 });
  }
  session.flags = flags;
  await writeSession(session);
  return NextResponse.json({ session });
}
