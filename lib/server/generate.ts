import Anthropic from "@anthropic-ai/sdk";
import { PERSONAS } from "../personas";
import type { PersonaId } from "../types";

// Server-side helpers: write a line in-persona with Claude, voice it with ElevenLabs.
// Both degrade gracefully — the client falls back to its local library / on-device TTS.

export interface PhraseContext {
  distanceKm?: number;
  elapsedMin?: number;
  localTime?: string;
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
  const ctx = [
    context.distanceKm !== undefined ? `${context.distanceKm} km covered so far` : null,
    context.elapsedMin !== undefined ? `${context.elapsedMin} minutes elapsed` : null,
    context.localTime ? `local time ${context.localTime}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 300,
    output_config: { effort: "low" },
    system:
      `${p.stylePrompt}\n\n` +
      "You speak to a runner mid-run through their earphones. Respond with ONE spoken line " +
      "of at most 40 words. No stage directions, no quotes, no emoji — just the words to be " +
      "spoken aloud.",
    messages: [
      {
        role: "user",
        content: `${instruction}${ctx ? ` Run context: ${ctx}.` : ""}`,
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

export async function renderVoice(persona: PersonaId, text: string): Promise<string | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return null;
  const voiceId = PERSONAS[persona].elevenLabsVoiceId;
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_64`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.6 },
      }),
    }
  );
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString("base64");
}
