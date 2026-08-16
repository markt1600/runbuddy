import { list, put } from "@vercel/blob";
import { PERSONAS } from "../personas";
import type { PersonaId } from "../types";

// Per-persona voice settings adjustable from the admin screen, stored in Blob
// so they survive deploys and apply to both re-renders and live phrases.
// Defaults come from lib/personas.ts.

export interface VoiceSettings {
  speed: number; // ElevenLabs voice_settings.speed, valid ~0.7–1.2
}

const PATH = "library/voice-settings.json";

export const SPEED_MIN = 0.7;
export const SPEED_MAX = 1.2;

function defaults(): Record<PersonaId, VoiceSettings> {
  return {
    ahbeng: { speed: PERSONAS.ahbeng.elevenLabsSpeed },
    coach: { speed: PERSONAS.coach.elevenLabsSpeed },
  };
}

export async function readVoiceSettings(): Promise<Record<PersonaId, VoiceSettings>> {
  const base = defaults();
  if (!process.env.BLOB_READ_WRITE_TOKEN) return base;
  try {
    const page = await list({ prefix: PATH, limit: 1 });
    const hit = page.blobs.find((b) => b.pathname === PATH);
    if (!hit) return base;
    const res = await fetch(hit.url, { cache: "no-store" });
    if (!res.ok) return base;
    const stored = await res.json();
    for (const persona of Object.keys(base) as PersonaId[]) {
      const speed = Number(stored?.[persona]?.speed);
      if (isFinite(speed)) {
        base[persona].speed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed));
      }
    }
    return base;
  } catch {
    return base;
  }
}

export async function writeVoiceSpeed(
  persona: PersonaId,
  speed: number
): Promise<Record<PersonaId, VoiceSettings>> {
  const settings = await readVoiceSettings();
  settings[persona].speed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed));
  await put(PATH, JSON.stringify(settings, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
  return settings;
}
