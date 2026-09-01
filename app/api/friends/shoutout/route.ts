import { NextRequest, NextResponse } from "next/server";
import { readSession, uidHash } from "@/lib/server/auth";
import { blobConfigured } from "@/lib/server/library";
import { isMutual } from "@/lib/server/friends";
import { isRunning } from "@/lib/server/presence";
import { createShoutout, type ShoutoutSlot } from "@/lib/server/shoutouts";
import { UID_RE } from "@/lib/server/users";

// Send a shoutout to a mutual friend. "now" needs them to actually be
// mid-run; the next-run slots queue until their next run picks them up.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SLOTS: ShoutoutSlot[] = ["now", "start", "middle", "end"];

export async function POST(req: NextRequest) {
  const user = readSession(req);
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const body = (await req.json().catch(() => null)) as {
    toUid?: string;
    slot?: string;
    kind?: string;
    text?: string;
    embellish?: boolean;
    audioBase64?: string;
    mime?: string;
  } | null;

  const toUid = body?.toUid ?? "";
  if (!UID_RE.test(toUid)) return NextResponse.json({ error: "bad uid" }, { status: 400 });
  const slot = body?.slot as ShoutoutSlot;
  if (!SLOTS.includes(slot)) return NextResponse.json({ error: "bad slot" }, { status: 400 });

  const selfUid = uidHash(user.sub);
  if (!(await isMutual(selfUid, toUid))) {
    return NextResponse.json({ error: "not friends" }, { status: 403 });
  }

  if (body?.kind === "trainer") {
    const text = (body.text ?? "").trim().slice(0, 280);
    if (!text) return NextResponse.json({ error: "empty message" }, { status: 400 });
    if (slot === "now" && !(await isRunning(toUid))) {
      return NextResponse.json({ error: "not running" }, { status: 409 });
    }
    await createShoutout(toUid, {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      fromUid: selfUid,
      fromName: user.name,
      kind: "trainer",
      text,
      embellish: body.embellish === true,
      slot,
      createdAt: Date.now(),
    });
    return NextResponse.json({ ok: true });
  }

  if (body?.kind === "voice") {
    const audio = body.audioBase64 ?? "";
    // ~20s of AAC lands well under this; the cap is against abuse, not use.
    if (audio.length < 100 || audio.length > 1_400_000) {
      return NextResponse.json({ error: "bad audio size" }, { status: 400 });
    }
    if (slot === "now" && !(await isRunning(toUid))) {
      return NextResponse.json({ error: "not running" }, { status: 409 });
    }
    await createShoutout(toUid, {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      fromUid: selfUid,
      fromName: user.name,
      kind: "voice",
      audioBase64: audio,
      mime: typeof body.mime === "string" ? body.mime.slice(0, 40) : undefined,
      slot,
      createdAt: Date.now(),
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "bad kind" }, { status: 400 });
}
