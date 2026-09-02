import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { checkPinHeader } from "@/lib/server/adminAuth";
import { blobConfigured } from "@/lib/server/library";
import {
  createEditSession,
  deleteEditSession,
  EDIT_TOKEN_RE,
  listEditSessions,
} from "@/lib/server/phraseEdits";
import { PERSONAS } from "@/lib/personas";
import type { PersonaId } from "@/lib/types";

// Phrase-edit session management for the studio.

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
  const sessions = await listEditSessions();
  return NextResponse.json({
    edits: sessions.map((s) => {
      const resolved = s.resolved ?? {};
      const ids = Object.keys(s.suggestions ?? {});
      return {
        id: s.id,
        label: s.label,
        persona: s.persona,
        createdAt: s.createdAt,
        submittedAt: s.submittedAt ?? 0,
        pending: ids.filter((id) => !resolved[id]).length,
        accepted: Object.values(resolved).filter((v) => v === "accepted").length,
        rejected: Object.values(resolved).filter((v) => v === "rejected").length,
      };
    }),
  });
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
  return NextResponse.json({ session: await createEditSession(label, persona) });
}

export async function DELETE(req: NextRequest) {
  const denied = guard(req);
  if (denied) return denied;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!EDIT_TOKEN_RE.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  await deleteEditSession(id);
  return NextResponse.json({ ok: true });
}
