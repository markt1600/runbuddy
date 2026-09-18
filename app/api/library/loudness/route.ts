import { NextRequest, NextResponse } from "next/server";
import { blobConfigured, readLoudness, writeLoudness } from "@/lib/server/library";
import { checkPinHeader } from "@/lib/server/adminAuth";
import { PERSONAS } from "@/lib/personas";
import type { PersonaId } from "@/lib/types";

// Admin-only: store what the level check measured. The run screen reads it
// back through /api/library/status and lifts any clip that sits far below its
// trainer's average at play time. `merge` keeps readings for files this pass
// didn't measure (a partial pass, or the re-rendered subset).

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!checkPinHeader(req)) {
    return NextResponse.json({ error: "admin PIN required" }, { status: 401 });
  }
  if (!blobConfigured()) {
    return NextResponse.json({ error: "Vercel Blob not connected" }, { status: 503 });
  }
  let body: { persona?: string; avgDb?: number; files?: Record<string, number>; merge?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const persona = body.persona as PersonaId;
  if (!persona || !(persona in PERSONAS)) {
    return NextResponse.json({ error: "unknown persona" }, { status: 400 });
  }
  const avgDb = Number(body.avgDb);
  if (!isFinite(avgDb)) return NextResponse.json({ error: "avgDb required" }, { status: 400 });
  const files: Record<string, number> = {};
  for (const [id, db] of Object.entries(body.files ?? {})) {
    if (/^[\w-]{1,80}$/.test(id) && typeof db === "number" && isFinite(db)) files[id] = db;
  }
  const prior = body.merge ? await readLoudness(persona) : null;
  const map = {
    avgDb,
    files: { ...(prior?.files ?? {}), ...files },
    measuredAt: Date.now(),
  };
  await writeLoudness(persona, map);
  return NextResponse.json({ ok: true, count: Object.keys(map.files).length });
}
