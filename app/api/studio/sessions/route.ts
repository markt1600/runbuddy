import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { checkPinHeader } from "@/lib/server/adminAuth";
import { blobConfigured } from "@/lib/server/library";
import { createStudioSession, listSessions, listTakes } from "@/lib/server/studio";
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
    sessions.map(async (s) => ({ ...s, takeCount: (await listTakes(s.id)).length }))
  );
  return NextResponse.json({ sessions: withCounts });
}

export async function POST(req: NextRequest) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as {
    label?: string;
    persona?: string;
  } | null;
  const persona = body?.persona as PersonaId;
  const label = (body?.label ?? "").trim();
  if (!(persona in PERSONAS) || !label) {
    return NextResponse.json({ error: "need label and persona" }, { status: 400 });
  }
  const session = await createStudioSession(label, persona);
  return NextResponse.json({ session });
}
