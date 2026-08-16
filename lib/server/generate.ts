import Anthropic from "@anthropic-ai/sdk";
import { PERSONAS } from "../personas";
import { readVoiceSettings } from "./voiceSettings";
import type { PersonaId } from "../types";

// Server-side helpers: write a line in-persona with Claude (Sonnet 5), voice it
// with ElevenLabs. Both degrade gracefully — the client falls back to its local
// library / on-device TTS.

export interface PhraseContext {
  distanceKm?: number;
  elapsedMin?: number;
  localTime?: string;
  kmMarker?: number; // whole kilometres completed
  paceMinPerKm?: string; // current pace, e.g. "6:24"
  avgPaceMinPerKm?: string;
  speedKmh?: number;
  locality?: string; // where the runner is, e.g. "Bishan"
  weather?: string; // e.g. "partly cloudy, 29°C (feels like 33°C)"
}

function contextLines(context: PhraseContext): string {
  const lines = [
    context.locality ? `Location: running through ${context.locality}` : null,
    context.weather ? `Weather right now: ${context.weather}` : null,
    context.distanceKm !== undefined ? `Distance covered: ${context.distanceKm} km` : null,
    context.kmMarker ? `Just completed kilometre number ${context.kmMarker}` : null,
    context.elapsedMin !== undefined ? `Elapsed: ${context.elapsedMin} minutes` : null,
    context.paceMinPerKm ? `Current pace: ${context.paceMinPerKm} min/km` : null,
    context.avgPaceMinPerKm ? `Average pace: ${context.avgPaceMinPerKm} min/km` : null,
    context.speedKmh !== undefined ? `Current speed: ${context.speedKmh} km/h` : null,
    context.localTime ? `Local time: ${context.localTime}` : null,
  ].filter(Boolean);
  return lines.length ? `\n\nLive run stats:\n${lines.join("\n")}` : "";
}

export async function generateLine(
  persona: PersonaId,
  instruction: string,
  context: PhraseContext
): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }
  const client = new Anthropic();
  const p = PERSONAS[persona];

  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 300,
    output_config: { effort: "low" },
    system:
      `${p.stylePrompt}\n\n` +
      "You speak to a runner mid-run through their earphones. You are given live run stats — " +
      "weave the most interesting one or two of them naturally into what you say (the weather, " +
      "where they are, their pace or speed, which kilometre they just hit) so it feels like you " +
      "are really there watching them. Don't recite all the stats. Respond with ONE spoken line " +
      "of at most 45 words. No stage directions, no quotes, no emoji — just the words to be " +
      "spoken aloud.",
    messages: [
      {
        role: "user",
        content: `${instruction}${contextLines(context)}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("generation declined");
  }
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join(" ")
    .trim();
  if (!text) throw new Error("empty generation");
  return text;
}

/** Voice ID resolution: env var first, then the default in lib/personas.ts. */
export function voiceIdFor(persona: PersonaId): string {
  const envName = `ELEVENLABS_VOICE_${persona.toUpperCase()}`;
  return process.env[envName] || PERSONAS[persona].elevenLabsVoiceId;
}

export async function renderVoiceBuffer(
  persona: PersonaId,
  text: string
): Promise<Buffer | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return null;
  const voiceId = voiceIdFor(persona);
  const settings = await readVoiceSettings();
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_64`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.8,
          style: 0.6,
          speed: settings[persona].speed,
        },
      }),
    }
  );
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

export async function renderVoice(persona: PersonaId, text: string): Promise<string | null> {
  const buf = await renderVoiceBuffer(persona, text);
  return buf ? buf.toString("base64") : null;
}
