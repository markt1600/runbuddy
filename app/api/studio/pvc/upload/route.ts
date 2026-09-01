import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { checkPinHeader } from "@/lib/server/adminAuth";
import { blobConfigured, elevenLabsConfigured } from "@/lib/server/library";
import { getSession } from "@/lib/server/studio";
import { pvcUploadSamples } from "@/lib/server/elevenPvc";

// One batch of clone-training samples, MP3-encoded by the studio page and
// forwarded to ElevenLabs. The page loops batches sized under the body cap.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  if (!checkPinHeader(req)) return NextResponse.json({ error: "bad pin" }, { status: 403 });
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  if (!elevenLabsConfigured()) {
    return NextResponse.json({ error: "ELEVENLABS_API_KEY not configured" }, { status: 503 });
  }

  const body = (await req.json().catch(() => null)) as {
    sessionId?: string;
    files?: { name: string; mp3Base64: string }[];
  } | null;
  const session = body?.sessionId ? await getSession(body.sessionId) : null;
  if (!session) return NextResponse.json({ error: "no session" }, { status: 404 });
  if (!session.pvc?.voiceId) {
    return NextResponse.json({ error: "create the voice first" }, { status: 400 });
  }
  const files = (body?.files ?? []).slice(0, 10).map((f) => ({
    name: f.name.replace(/[^\w.-]/g, "").slice(0, 80) || "sample.mp3",
    data: Buffer.from(f.mp3Base64, "base64"),
  }));
  if (files.length === 0) return NextResponse.json({ error: "no files" }, { status: 400 });

  try {
    await pvcUploadSamples(session.pvc.voiceId, files);
    return NextResponse.json({ ok: true, uploaded: files.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "upload failed" },
      { status: 502 }
    );
  }
}
