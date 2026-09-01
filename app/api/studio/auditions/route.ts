import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { checkPinHeader } from "@/lib/server/adminAuth";
import { blobConfigured } from "@/lib/server/library";
import {
  createAuditionCall,
  deleteAuditionCall,
  listAuditionCalls,
  SESSION_TOKEN_RE,
} from "@/lib/server/studio";
import { PERSONAS } from "@/lib/personas";
import type { PersonaId } from "@/lib/types";

// Audition management for the studio: list every call with its submissions,
// open a new call for a character, close one (deleting its submissions).

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
  return NextResponse.json({ auditions: await listAuditionCalls() });
}

export async function POST(req: NextRequest) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { persona?: string } | null;
  const persona = body?.persona as PersonaId;
  if (!(persona in PERSONAS)) {
    return NextResponse.json({ error: "bad persona" }, { status: 400 });
  }
  return NextResponse.json({ call: await createAuditionCall(persona) });
}

export async function DELETE(req: NextRequest) {
  const denied = guard(req);
  if (denied) return denied;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!SESSION_TOKEN_RE.test(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  await deleteAuditionCall(id);
  return NextResponse.json({ ok: true });
}
