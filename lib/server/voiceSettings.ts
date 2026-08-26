import { list, put } from "@vercel/blob";
import { PERSONAS } from "../personas";
import type { PersonaId } from "../types";

// Per-persona voice settings adjustable from the admin screen, stored in Blob
// so they survive deploys and apply to both re-renders and live phrases.
// Defaults come from lib/personas.ts.

export interface VoiceSettings {
  speed: number; // ElevenLabs voice_settings.speed, valid ~0.7–1.2
  /**
   * Playback level for this persona, 0.4–2. Applied at play time, so it needs
   * no re-render. Below 1 attenuates; above 1 the native player amplifies the
   * decoded samples (some ElevenLabs voices render noticeably quieter than
   * others — Cassie vs Ah Beng). Web audio elements can't go above 1, so the
   * browser fallback clamps there.
   */
  volume: number;
}

const PATH = "library/voice-settings.json";

export const SPEED_MIN = 0.7;
export const SPEED_MAX = 1.2;
export const VOLUME_MIN = 0.4;
export const VOLUME_MAX = 2;

function defaults(): Record<PersonaId, VoiceSettings> {
  const out = {} as Record<PersonaId, VoiceSettings>;
  for (const persona of Object.keys(PERSONAS) as PersonaId[]) {
    out[persona] = {
      speed: PERSONAS[persona].elevenLabsSpeed,
      volume: PERSONAS[persona].playbackVolume,
    };
  }
  return out;
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
      const volume = Number(stored?.[persona]?.volume);
      if (isFinite(volume)) {
        base[persona].volume = Math.min(VOLUME_MAX, Math.max(VOLUME_MIN, volume));
      }
    }
    return base;
  } catch {
    return base;
  }
}

export async function writeVoiceSettings(
  persona: PersonaId,
  patch: { speed?: number; volume?: number }
): Promise<Record<PersonaId, VoiceSettings>> {
  const settings = await readVoiceSettings();
  if (patch.speed !== undefined) {
    settings[persona].speed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, patch.speed));
  }
  if (patch.volume !== undefined) {
    settings[persona].volume = Math.min(VOLUME_MAX, Math.max(VOLUME_MIN, patch.volume));
  }
  await put(PATH, JSON.stringify(settings, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
  return settings;
}
