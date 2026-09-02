import { NextRequest, NextResponse } from "next/server";
import {
  blobConfigured,
  elevenLabsConfigured,
  readExtras,
  readOverrides,
} from "@/lib/server/library";
import { getSession, listTakes, writeSession } from "@/lib/server/studio";
import { instantCloneFromSession } from "@/lib/server/studioClone";
import { CLONE_READS, readsFor, TEST_PHRASES, TEST_READS } from "@/lib/studioReads";
import { licenseTextFor, LICENSE_VERSION } from "@/lib/studioLicense";
import { PHRASE_LIBRARY } from "@/lib/phrases";
import { PERSONAS } from "@/lib/personas";

// The actor's session, seen through their token. The token IS the auth —
// unguessable, single-purpose, and everything it can touch is namespaced
// under its own session.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const { token } = await ctx.params;
  const session = await getSession(token);
  if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [takes, extras, overrides] = await Promise.all([
    listTakes(token),
    readExtras(session.persona),
    readOverrides(session.persona),
  ]);
  const recorded = new Set(takes.map((t) => t.itemId));
  const takeUrls = Object.fromEntries(takes.map((t) => [t.itemId, t.url]));
  const takeAt = new Map(takes.map((t) => [t.itemId, new Date(t.at).getTime()]));
  // A flag is open until a take LANDS after it — re-recording clears it.
  const openFlags = (session.flags ?? [])
    .filter((f) => (takeAt.get(f.itemId) ?? 0) < f.at)
    .map((f) => ({ itemId: f.itemId, note: f.note ?? null }));

  const items = session.cloneOnly
    ? CLONE_READS.map((r) => ({
        id: r.id,
        kind: "read" as const,
        title: r.title,
        text: r.text,
      }))
    : session.test
    ? [
        ...TEST_PHRASES.map((p) => ({ id: p.id, kind: "phrase" as const, text: p.text })),
        ...TEST_READS.map((r) => ({
          id: r.id,
          kind: "read" as const,
          title: r.title,
          text: r.text,
        })),
      ]
    : [
        // Accepted studio corrections apply here too — the actor must record
        // the words the app will actually speak.
        ...[...PHRASE_LIBRARY[session.persona], ...extras].map((p) => ({
          id: p.id,
          kind: "phrase" as const,
          text: overrides[p.id] ?? p.text,
        })),
        ...readsFor(session.persona).map((r) => ({
          id: r.id,
          kind: "read" as const,
          title: r.title,
          text: r.text,
        })),
      ];

  return NextResponse.json({
    persona: session.persona,
    personaName: PERSONAS[session.persona].name,
    label: session.label,
    licensed: !!session.license,
    licenseText: licenseTextFor(session.feeSgd ?? 0, session.deadlineAt),
    licenseVersion: LICENSE_VERSION,
    feeSgd: session.feeSgd ?? 0,
    deadlineAt: session.deadlineAt ?? 0,
    // Rough session length for the actor: short phrases run ~35s each with
    // navigation and the odd re-take; long reads ~4 minutes.
    estimateHours: (() => {
      const phrases = items.filter((i) => i.kind === "phrase").length;
      const reads = items.filter((i) => i.kind === "read").length;
      const h = (phrases * 35 + reads * 240) / 3600;
      return {
        low: Math.max(0.5, Math.round(h * 2) / 2),
        high: Math.max(1, Math.round(h * 1.35 * 2) / 2),
      };
    })(),
    items,
    recorded: [...recorded],
    takeUrls,
    openFlags,
    pvcState: session.pvc?.state ?? "none",
    pvcAttempts: session.pvc?.attempts ?? 0,
    submittedAt: session.submittedAt ?? 0,
    cloneOnly: !!session.cloneOnly,
  });
}

/** Sign the license (typed full name + the exact text version they saw),
 *  or — with action "submit" — hand the finished work in for review. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const { token } = await ctx.params;
  const session = await getSession(token);
  if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as {
    action?: string;
    typedName?: string;
    email?: string;
    paynowId?: string;
  } | null;

  if (body?.action === "submit") {
    if (!session.license) return NextResponse.json({ error: "license first" }, { status: 403 });
    // Only a genuinely complete set can be handed in.
    const takes = await listTakes(token);
    const recordedIds = new Set(takes.map((t) => t.itemId));
    const itemCount = session.cloneOnly
      ? CLONE_READS.length
      : session.test
      ? TEST_PHRASES.length + TEST_READS.length
      : PHRASE_LIBRARY[session.persona].length +
        (await readExtras(session.persona)).length +
        readsFor(session.persona).length;
    if (recordedIds.size < itemCount) {
      return NextResponse.json(
        { error: `not complete: ${recordedIds.size}/${itemCount} recorded` },
        { status: 400 }
      );
    }
    session.submittedAt = Date.now();
    await writeSession(session);
    // First submission is also the clone trigger: build the Instant Voice
    // Clone from the long-read takes right now, so the admin opens the studio
    // to a voice that already exists. Re-submits (after flag redos) do NOT
    // auto-rebuild — the existing voice_id may already be live in an env var,
    // and rebuilding replaces it; the admin's ⚡ button is the deliberate path.
    // A clone failure never fails the submission — the studio shows the error.
    let clone: "ready" | "failed" | "skipped" = "skipped";
    if (elevenLabsConfigured() && !session.pvc?.voiceId) {
      try {
        await instantCloneFromSession(session);
        clone = "ready";
      } catch (err) {
        clone = "failed";
        session.pvc = {
          ...(session.pvc ?? { state: "failed" as const }),
          state: "failed",
          note: err instanceof Error ? err.message : "clone failed",
        };
        await writeSession(session).catch(() => {});
      }
    }
    return NextResponse.json({ ok: true, submittedAt: session.submittedAt, clone });
  }
  const typedName = (body?.typedName ?? "").trim();
  const email = (body?.email ?? "").trim();
  const paynowId = (body?.paynowId ?? "").trim();
  if (typedName.length < 3 || typedName.length > 120) {
    return NextResponse.json({ error: "type your full legal name" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    return NextResponse.json({ error: "valid email required" }, { status: 400 });
  }
  // No fee, no payment details — a zero-fee clone session signs with just
  // name and email.
  if ((session.feeSgd ?? 0) > 0 && (paynowId.length < 4 || paynowId.length > 60)) {
    return NextResponse.json({ error: "PayNow ID required" }, { status: 400 });
  }
  if (!session.license) {
    session.license = {
      typedName,
      email,
      paynowId,
      feeSgd: session.feeSgd ?? 0,
      deadlineAt: session.deadlineAt,
      at: Date.now(),
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
      ua: req.headers.get("user-agent") ?? undefined,
      version: LICENSE_VERSION,
    };
    await writeSession(session);
  }
  return NextResponse.json({ ok: true });
}
