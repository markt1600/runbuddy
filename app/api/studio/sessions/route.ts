import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { checkPinHeader } from "@/lib/server/adminAuth";
import { blobConfigured } from "@/lib/server/library";
import { createStudioSession, listSessions, listTakes } from "@/lib/server/studio";
import { readExtras } from "@/lib/server/library";
import { readsFor, TEST_PHRASES, TEST_READS } from "@/lib/studioReads";
import { PHRASE_LIBRARY } from "@/lib/phrases";
import { PERSONAS } from "@/lib/personas";
import type { PersonaId } from "@/lib/types";

// Studio sessions: one per actor+persona. Double-gated — the Google session
// must be the admin account AND carry the admin PIN header.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function guard(req: NextRequest): NextResponse | null {
  const denied = requireAdmin(req);
  if (denied) return denied;
  if (!checkPinHeader(req)) return NextResponse.json({ error: "bad pin" }, { status: 403 });
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  return null;
}

export async function GET(req: NextRequest) {
  const denied = guard(req);
  if (denied) return denied;
  const sessions = await listSessions();
  const withCounts = await Promise.all(
    sessions.map(async (s) => {
      const [takes, extras] = await Promise.all([listTakes(s.id), readExtras(s.persona)]);
      return {
        ...s,
        takeCount: takes.length,
        itemTotal: s.test
          ? TEST_PHRASES.length + TEST_READS.length
          : PHRASE_LIBRARY[s.persona].length + extras.length + readsFor(s.persona).length,
      };
    })
  );
  return NextResponse.json({ sessions: withCounts });
}

export async function POST(req: NextRequest) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as {
    label?: string;
    persona?: string;
    feeSgd?: number;
    deadlineAt?: number;
    test?: boolean;
  } | null;
  const persona = body?.persona as PersonaId;
  const label = (body?.label ?? "").trim();
  const feeSgd = Number(body?.feeSgd);
  const deadlineAt = Number(body?.deadlineAt);
  if (!(persona in PERSONAS) || !label || !isFinite(feeSgd) || feeSgd <= 0) {
    return NextResponse.json(
      { error: "need label, persona and a fee amount" },
      { status: 400 }
    );
  }
  if (!isFinite(deadlineAt) || deadlineAt <= Date.now()) {
    return NextResponse.json({ error: "need a future deadline" }, { status: 400 });
  }
  const session = await createStudioSession(
    label,
    persona,
    feeSgd,
    deadlineAt,
    body?.test === true
  );
  return NextResponse.json({ session });
}
