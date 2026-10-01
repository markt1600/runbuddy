import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { checkPinHeader } from "@/lib/server/adminAuth";
import { blobConfigured, elevenLabsConfigured } from "@/lib/server/library";
import { ivcAddSamples, ivcCreate, ttsPreview } from "@/lib/server/elevenPvc";
import { readTakesForPersona } from "@/lib/server/studioClone";
import { readVoiceSettings, writeVoiceSettings } from "@/lib/server/voiceSettings";
import { voiceIdFor, voiceIdSource } from "@/lib/server/generate";
import { PERSONAS, PERSONA_LIST } from "@/lib/personas";
import { PHRASE_LIBRARY } from "@/lib/phrases";
import type { PersonaId } from "@/lib/types";

// The studio's Voices tools: build an ElevenLabs instant clone from clips
// uploaded in the browser (MP3-encoded there, batched under the body cap)
// and, optionally, the persona's own long-read takes already in the store;
// preview it; make it the persona's voice (stored with the voice settings,
// ahead of the env variable); or drop that choice again.
//
//   GET                         → each persona's current voice id and where it comes from
//   POST {action:"create"}      → { voiceId }  (persona, name, files[], includeTakes)
//   POST {action:"add"}         → more files onto a voice just created
//   POST {action:"preview"}     → { audioBase64 } — a sample line in the voice
//   POST {action:"use"}         → pin voiceId as the persona's voice
//   POST {action:"clear"}       → back to the env variable / built-in id

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VOICE_ID_RE = /^[A-Za-z0-9]{10,40}$/;

type Incoming = { name: string; mp3Base64: string };

function decodeFiles(files: Incoming[] | undefined, prefix: string) {
  return (files ?? []).slice(0, 10).map((f, i) => ({
    name: `${prefix}-${String(i + 1).padStart(2, "0")}-${(f.name ?? "clip").replace(/[^\w.-]/g, "").slice(0, 60) || "clip"}.mp3`,
    data: Buffer.from(f.mp3Base64, "base64"),
    mime: "audio/mpeg",
  }));
}

function gate(req: NextRequest): NextResponse | null {
  const denied = requireAdmin(req);
  if (denied) return denied;
  if (!checkPinHeader(req)) return NextResponse.json({ error: "bad pin" }, { status: 403 });
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  if (!elevenLabsConfigured()) {
    return NextResponse.json({ error: "ELEVENLABS_API_KEY not configured" }, { status: 503 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const denied = gate(req);
  if (denied) return denied;
  const settings = await readVoiceSettings();
  return NextResponse.json({
    voices: PERSONA_LIST.map((p) => ({
      persona: p.id,
      voiceId: voiceIdFor(p.id, settings),
      source: voiceIdSource(p.id, settings),
    })),
  });
}

export async function POST(req: NextRequest) {
  const denied = gate(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as {
    action?: string;
    persona?: string;
    name?: string;
    voiceId?: string;
    files?: Incoming[];
    includeTakes?: boolean;
  } | null;
  if (!body) return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  const persona = body.persona as PersonaId;
  const personaOk = typeof persona === "string" && persona in PERSONAS;

  try {
    switch (body.action) {
      case "create": {
        if (!personaOk) return NextResponse.json({ error: "bad persona" }, { status: 400 });
        const name = (body.name ?? "").trim().slice(0, 80) || `TekanBuddy ${PERSONAS[persona].shortName}`;
        const uploaded = decodeFiles(body.files, "clip");
        const takes = body.includeTakes ? await readTakesForPersona(persona) : [];
        const files = [...uploaded, ...takes];
        if (files.length === 0) {
          return NextResponse.json(
            { error: "no audio — upload at least one clip or include the recorded takes" },
            { status: 400 }
          );
        }
        const voiceId = await ivcCreate(name, files);
        return NextResponse.json({ voiceId, files: files.length, takes: takes.length });
      }
      case "add": {
        if (!body.voiceId || !VOICE_ID_RE.test(body.voiceId)) {
          return NextResponse.json({ error: "bad voice id" }, { status: 400 });
        }
        const files = decodeFiles(body.files, "clip-more");
        if (files.length === 0) return NextResponse.json({ error: "no files" }, { status: 400 });
        await ivcAddSamples(body.voiceId, (body.name ?? "voice").trim().slice(0, 80) || "voice", files);
        return NextResponse.json({ ok: true, added: files.length });
      }
      case "preview": {
        if (!body.voiceId || !VOICE_ID_RE.test(body.voiceId)) {
          return NextResponse.json({ error: "bad voice id" }, { status: 400 });
        }
        const pool = personaOk ? PHRASE_LIBRARY[persona].filter((p) => p.category === "encourage") : [];
        const text =
          pool[Math.floor(Math.random() * pool.length)]?.text ??
          "Okay lah, one more kilometre. Steady, keep going!";
        const audio = await ttsPreview(body.voiceId, text);
        return NextResponse.json({ text, audioBase64: audio.toString("base64") });
      }
      case "use": {
        if (!personaOk) return NextResponse.json({ error: "bad persona" }, { status: 400 });
        if (!body.voiceId || !VOICE_ID_RE.test(body.voiceId)) {
          return NextResponse.json({ error: "bad voice id" }, { status: 400 });
        }
        const settings = await writeVoiceSettings(persona, { voiceId: body.voiceId });
        return NextResponse.json({ voiceId: voiceIdFor(persona, settings), source: voiceIdSource(persona, settings) });
      }
      case "clear": {
        if (!personaOk) return NextResponse.json({ error: "bad persona" }, { status: 400 });
        const settings = await writeVoiceSettings(persona, { voiceId: null });
        return NextResponse.json({ voiceId: voiceIdFor(persona, settings), source: voiceIdSource(persona, settings) });
      }
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "voice action failed" },
      { status: 502 }
    );
  }
}
