import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { checkPinHeader } from "@/lib/server/adminAuth";
import {
  blobConfigured,
  deleteRenderedAudio,
  readExtras,
  readOverrides,
  removeOverride,
} from "@/lib/server/library";
import { PHRASE_LIBRARY } from "@/lib/phrases";
import { PERSONAS } from "@/lib/personas";
import type { PersonaId } from "@/lib/types";

// The safety net over accepted phrase corrections: list every override that
// is currently live (with the shipped wording beside it), and revert one —
// which restores the original text and deletes the phrase's audio, since
// that audio was cut from the corrected words.

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
  const personaIds = Object.keys(PERSONAS) as PersonaId[];
  const rows: {
    persona: PersonaId;
    id: string;
    category: string;
    shipped: string;
    corrected: string;
  }[] = [];
  await Promise.all(
    personaIds.map(async (persona) => {
      const overrides = await readOverrides(persona);
      if (Object.keys(overrides).length === 0) return;
      const extras = await readExtras(persona);
      const base = new Map(
        [...PHRASE_LIBRARY[persona], ...extras].map((p) => [
          p.id,
          { category: p.category, text: p.text },
        ])
      );
      for (const [id, corrected] of Object.entries(overrides)) {
        const orig = base.get(id);
        if (orig) {
          rows.push({ persona, id, category: orig.category, shipped: orig.text, corrected });
        }
      }
    })
  );
  rows.sort((a, b) => a.persona.localeCompare(b.persona) || a.id.localeCompare(b.id));
  return NextResponse.json({ overrides: rows });
}

export async function DELETE(req: NextRequest) {
  const denied = guard(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const persona = url.searchParams.get("persona") as PersonaId;
  const id = url.searchParams.get("id") ?? "";
  if (!(persona in PERSONAS) || !/^[\w-]{1,60}$/.test(id)) {
    return NextResponse.json({ error: "bad target" }, { status: 400 });
  }
  // Text back first, then kill the audio that speaks the corrected words —
  // same ordering discipline as accept, so a racing render cuts shipped text.
  await removeOverride(persona, id);
  await deleteRenderedAudio(persona, id);
  return NextResponse.json({ ok: true });
}
