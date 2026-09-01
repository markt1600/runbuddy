import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { checkPinHeader } from "@/lib/server/adminAuth";
import { blobConfigured, promoteAudio } from "@/lib/server/library";
import { getSession } from "@/lib/server/studio";

// Promote approved actor takes into the live library. The studio page sends
// them in batches, already transcoded to MP3 (WAV takes would be a 10x pack
// download for every phone). Same pathnames + markers as a render, so the
// ?v= versioning re-downloads exactly the phrases that changed.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  if (!checkPinHeader(req)) return NextResponse.json({ error: "bad pin" }, { status: 403 });
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });

  const body = (await req.json().catch(() => null)) as {
    sessionId?: string;
    items?: { phraseId: string; mp3Base64: string }[];
  } | null;
  const session = body?.sessionId ? await getSession(body.sessionId) : null;
  if (!session) return NextResponse.json({ error: "no session" }, { status: 404 });
  if (session.test) {
    return NextResponse.json(
      { error: "test session — nothing promotes into a real library" },
      { status: 400 }
    );
  }
  const items = (body?.items ?? []).slice(0, 25);

  const done: string[] = [];
  const failed: { phraseId: string; error: string }[] = [];
  for (const item of items) {
    try {
      const mp3 = Buffer.from(item.mp3Base64, "base64");
      if (mp3.length < 500 || mp3.length > 4_000_000) throw new Error("bad size");
      await promoteAudio(session.persona, item.phraseId, mp3);
      done.push(item.phraseId);
    } catch (err) {
      failed.push({
        phraseId: item.phraseId,
        error: err instanceof Error ? err.message : "failed",
      });
    }
  }
  return NextResponse.json({ done, failed });
}
