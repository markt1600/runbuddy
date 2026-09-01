import { NextRequest, NextResponse } from "next/server";
import { readSession, uidHash } from "@/lib/server/auth";
import { blobConfigured } from "@/lib/server/library";
import { generateShoutoutLine, renderVoice } from "@/lib/server/generate";
import { deleteShoutout, listShoutouts, type ShoutoutSlot } from "@/lib/server/shoutouts";
import { PERSONAS } from "@/lib/personas";
import type { PersonaId } from "@/lib/types";

// The recipient's side: the run screen calls this at run start (start/middle/
// end slots) and on each presence beat ("now" slot). Trainer-kind messages
// are voiced HERE, in whatever trainer the runner is actually running with —
// embellished through the model when allowed, a fixed template when the
// sender said word for word. Delivered messages are consumed; a message
// whose rendering fails stays queued for the next attempt.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SLOTS: ShoutoutSlot[] = ["now", "start", "middle", "end"];

export async function POST(req: NextRequest) {
  const user = readSession(req);
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const body = (await req.json().catch(() => null)) as {
    persona?: string;
    slots?: string[];
  } | null;
  const persona = (body?.persona ?? "") as PersonaId;
  if (!(persona in PERSONAS)) return NextResponse.json({ error: "bad persona" }, { status: 400 });
  const slots = (body?.slots ?? []).filter((s): s is ShoutoutSlot =>
    SLOTS.includes(s as ShoutoutSlot)
  );
  if (slots.length === 0) return NextResponse.json({ shoutouts: [] });

  const self = uidHash(user.sub);
  const queued = (await listShoutouts(self)).filter((s) => slots.includes(s.slot)).slice(0, 3);

  const delivered: {
    fromName: string;
    kind: "voice" | "trainer";
    slot: ShoutoutSlot;
    text?: string;
    audioBase64: string;
    mime?: string;
    introBase64?: string;
  }[] = [];

  for (const s of queued) {
    try {
      if (s.kind === "trainer" && s.text) {
        const line = s.embellish
          ? await generateShoutoutLine(persona, s.fromName, s.text)
          : `Message from ${s.fromName}. They say: ${s.text}`;
        const audio = await renderVoice(persona, line);
        if (!audio) continue; // voices down — leave it queued
        delivered.push({
          fromName: s.fromName,
          kind: "trainer",
          slot: s.slot,
          text: line,
          audioBase64: audio,
        });
      } else if (s.kind === "voice" && s.audioBase64) {
        // The trainer hands over, then the sender's own recording plays.
        const intro = await renderVoice(
          persona,
          `${s.fromName} sent you a message. Listen up.`
        );
        delivered.push({
          fromName: s.fromName,
          kind: "voice",
          slot: s.slot,
          audioBase64: s.audioBase64,
          mime: s.mime,
          introBase64: intro ?? undefined,
        });
      } else {
        await deleteShoutout(self, s.id); // malformed — drop it
        continue;
      }
      await deleteShoutout(self, s.id);
    } catch {
      /* generation hiccup — stays queued for the next fetch */
    }
  }

  return NextResponse.json({ shoutouts: delivered });
}
