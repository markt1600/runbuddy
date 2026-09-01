import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { checkPinHeader } from "@/lib/server/adminAuth";
import { blobConfigured, elevenLabsConfigured } from "@/lib/server/library";
import { getSession, writeSession } from "@/lib/server/studio";
import {
  pvcCreate,
  pvcRequestManualVerification,
  pvcStatus,
  pvcTrain,
} from "@/lib/server/elevenPvc";
import { PERSONAS } from "@/lib/personas";

// PVC lifecycle controls for the studio page. One action-dispatch route so
// the ElevenLabs surface stays in one place; every failure returns the raw
// provider message for easy diagnosis on first contact with the real API.

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
    action?: string;
    sessionId?: string;
  } | null;
  const session = body?.sessionId ? await getSession(body.sessionId) : null;
  if (!session) return NextResponse.json({ error: "no session" }, { status: 404 });

  try {
    switch (body?.action) {
      case "create": {
        const voiceId = await pvcCreate(
          `RunBuddy ${PERSONAS[session.persona].shortName} — ${session.label}`
        );
        session.pvc = { voiceId, state: "created", attempts: 0 };
        await writeSession(session);
        return NextResponse.json({ session });
      }
      case "mark-uploaded": {
        if (!session.pvc?.voiceId) throw new Error("create the voice first");
        session.pvc.state = "uploaded";
        await writeSession(session);
        return NextResponse.json({ session });
      }
      case "open-verify": {
        if (!session.pvc?.voiceId) throw new Error("create the voice first");
        // Flips the ACTOR's page into its verification stage.
        session.pvc.state = "verify";
        await writeSession(session);
        return NextResponse.json({ session });
      }
      case "manual-verify": {
        if (!session.pvc?.voiceId) throw new Error("create the voice first");
        await pvcRequestManualVerification(session.pvc.voiceId);
        session.pvc.note = "manual verification requested";
        await writeSession(session);
        return NextResponse.json({ session });
      }
      case "train": {
        if (!session.pvc?.voiceId) throw new Error("create the voice first");
        await pvcTrain(session.pvc.voiceId);
        session.pvc.state = "training";
        await writeSession(session);
        return NextResponse.json({ session });
      }
      case "status": {
        if (!session.pvc?.voiceId) throw new Error("create the voice first");
        const status = await pvcStatus(session.pvc.voiceId);
        return NextResponse.json({ session, status });
      }
      default:
        return NextResponse.json({ error: "bad action" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "pvc action failed" },
      { status: 502 }
    );
  }
}
