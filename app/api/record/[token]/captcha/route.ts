import { NextRequest, NextResponse } from "next/server";
import { blobConfigured, elevenLabsConfigured } from "@/lib/server/library";
import { getSession, writeSession } from "@/lib/server/studio";
import { pvcGetCaptcha, pvcVerifyCaptcha } from "@/lib/server/elevenPvc";

// The voice-verification stage, proxied so the actor never needs an
// ElevenLabs account: GET returns the captcha image (the lines to read),
// POST submits their recording. Attempts are precious (~5 total), so the
// page previews before submitting and shows the countdown.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  if (!elevenLabsConfigured()) {
    return NextResponse.json({ error: "voices not configured" }, { status: 503 });
  }
  const { token } = await ctx.params;
  const session = await getSession(token);
  if (!session?.pvc?.voiceId || session.pvc.state !== "verify") {
    return NextResponse.json({ error: "verification not open" }, { status: 403 });
  }
  try {
    const { data, type } = await pvcGetCaptcha(session.pvc.voiceId);
    return new NextResponse(new Uint8Array(data), {
      headers: { "Content-Type": type, "Cache-Control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "captcha unavailable" },
      { status: 502 }
    );
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  if (!elevenLabsConfigured()) {
    return NextResponse.json({ error: "voices not configured" }, { status: 503 });
  }
  const { token } = await ctx.params;
  const session = await getSession(token);
  if (!session?.pvc?.voiceId || session.pvc.state !== "verify") {
    return NextResponse.json({ error: "verification not open" }, { status: 403 });
  }
  const mp3 = Buffer.from(await req.arrayBuffer());
  if (mp3.length < 1000 || mp3.length > 5_000_000) {
    return NextResponse.json({ error: "bad recording size" }, { status: 400 });
  }
  session.pvc.attempts = (session.pvc.attempts ?? 0) + 1;
  try {
    await pvcVerifyCaptcha(session.pvc.voiceId, mp3);
    session.pvc.state = "training";
    session.pvc.note = "verified";
    await writeSession(session);
    return NextResponse.json({ ok: true, verified: true });
  } catch (err) {
    session.pvc.note = err instanceof Error ? err.message : "verification failed";
    await writeSession(session);
    return NextResponse.json(
      { verified: false, attempts: session.pvc.attempts, error: session.pvc.note },
      { status: 200 }
    );
  }
}
