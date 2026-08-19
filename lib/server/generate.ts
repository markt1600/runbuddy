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
  lastKmPaceMinPerKm?: string; // split for the kilometre just finished
  speedKmh?: number;
  locality?: string; // where the runner is, e.g. "Bishan"
  weather?: string; // e.g. "partly cloudy, 29°C (feels like 33°C)"
  targetKm?: number;
  progressPercent?: number;
  remainingKm?: number;
  pausedSeconds?: number; // how long they've been standing still
  // Treadmill (time-target) runs
  treadmill?: boolean;
  targetMinutes?: number;
  remainingMinutes?: number;
  // Signed-in runner's account profile — self-reported on the account screen
  runnerName?: string;
  runnerAge?: number;
  runnerHeightCm?: number;
  runnerWeightKg?: number;
}

/**
 * Who the runner is, when they're signed in and told us. Kept separate from
 * the live stats so the prompt can frame it as seasoning, not data to recite.
 */
function runnerLines(context: PhraseContext): string {
  const bits = [
    context.runnerName ? `their name is ${context.runnerName}` : null,
    context.runnerAge !== undefined ? `they are ${context.runnerAge} years old` : null,
    context.runnerHeightCm !== undefined ? `${context.runnerHeightCm} cm tall` : null,
    context.runnerWeightKg !== undefined ? `${context.runnerWeightKg} kg` : null,
  ].filter(Boolean);
  if (bits.length === 0) return "";
  return (
    `\n\nAbout the runner: ${bits.join(", ")}. Use this for the occasional personal ` +
    "touch — address them by name sometimes, or let their age or build colour a remark " +
    "in your persona's style. Never recite these numbers back as a list, and never " +
    "mention their weight in a way that would sting outside your persona's usual teasing."
  );
}

function contextLines(context: PhraseContext): string {
  if (context.treadmill) {
    const lines = [
      "The runner is on a TREADMILL indoors — there is no GPS, so you do not know " +
        "their distance, pace, speed or location. Never mention any of those.",
      context.targetMinutes ? `Goal: ${context.targetMinutes} minutes` : null,
      context.elapsedMin !== undefined ? `Elapsed: ${context.elapsedMin} minutes` : null,
      context.progressPercent !== undefined
        ? `They have completed ${context.progressPercent}% of the time`
        : null,
      context.remainingMinutes !== undefined
        ? `Remaining: ${context.remainingMinutes} minutes`
        : null,
      context.pausedSeconds !== undefined
        ? `They have been stopped, not moving, for ${context.pausedSeconds} seconds`
        : null,
      context.localTime ? `Local time: ${context.localTime}` : null,
    ].filter(Boolean);
    return `\n\nLive run stats:\n${lines.join("\n")}${runnerLines(context)}`;
  }
  const lines = [
    context.locality ? `Location: running through ${context.locality}` : null,
    context.weather ? `Weather right now: ${context.weather}` : null,
    context.distanceKm !== undefined ? `Distance covered: ${context.distanceKm} km` : null,
    context.kmMarker ? `Just completed kilometre number ${context.kmMarker}` : null,
    context.elapsedMin !== undefined ? `Elapsed: ${context.elapsedMin} minutes` : null,
    context.paceMinPerKm ? `Current pace: ${context.paceMinPerKm} min/km` : null,
    context.avgPaceMinPerKm ? `Average pace: ${context.avgPaceMinPerKm} min/km` : null,
    context.lastKmPaceMinPerKm
      ? `Pace for the kilometre they just finished: ${context.lastKmPaceMinPerKm} min/km`
      : null,
    context.speedKmh !== undefined ? `Current speed: ${context.speedKmh} km/h` : null,
    context.pausedSeconds !== undefined
      ? `They have been stopped, not moving, for ${context.pausedSeconds} seconds`
      : null,
    context.localTime ? `Local time: ${context.localTime}` : null,
  ].filter(Boolean);
  const stats = lines.length ? `\n\nLive run stats:\n${lines.join("\n")}` : "";
  return `${stats}${runnerLines(context)}`;
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
