// Batch-renders the phrase library with ElevenLabs into public/audio/<persona>/,
// writing a manifest.json of rendered phrase ids per persona. Idempotent — only
// renders phrases that don't have an mp3 yet, so each run tops up the library.
//
// Usage:  ELEVENLABS_API_KEY=... npm run generate-library
//
// Voice ids come from lib/personas.ts. The app works without this step (it
// falls back to on-device speech synthesis), but pre-rendered ElevenLabs audio
// is what makes the personas shine.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("ELEVENLABS_API_KEY is required.");
  process.exit(1);
}

// Cheap-and-cheerful extraction of the phrase + voice data from the TS sources,
// so this script needs no build step.
function extractPhrases(source) {
  const phrases = [];
  const re = /\{\s*id:\s*"([^"]+)",\s*category:\s*"([^"]+)",\s*text:\s*"((?:[^"\\]|\\.)*)"\s*\}/g;
  let m;
  while ((m = re.exec(source))) {
    phrases.push({ id: m[1], category: m[2], text: m[3].replace(/\\"/g, '"') });
  }
  return phrases;
}

const phrasesSrc = readFileSync(join(root, "lib/phrases.ts"), "utf8");
const personasSrc = readFileSync(join(root, "lib/personas.ts"), "utf8");

// Voice IDs: ELEVENLABS_VOICE_<PERSONA> env vars win, else lib/personas.ts defaults.
const voiceIds = {};
const voiceSpeeds = {};
for (const m of personasSrc.matchAll(
  /id:\s*"(\w+)",[\s\S]*?elevenLabsVoiceId:\s*"([^"]+)",\s*elevenLabsSpeed:\s*([\d.]+)/g
)) {
  voiceIds[m[1]] = process.env[`ELEVENLABS_VOICE_${m[1].toUpperCase()}`] || m[2];
  voiceSpeeds[m[1]] = Number(m[3]) || 1.0;
}

const sections = phrasesSrc.split(/const (\w+): Phrase\[\] = \[/).slice(1);
const libraries = {};
for (let i = 0; i < sections.length; i += 2) {
  libraries[sections[i]] = extractPhrases(sections[i + 1]);
}

async function render(voiceId, text, speed = 1.0) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_64`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.6, speed },
      }),
    }
  );
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

for (const [personaId, phrases] of Object.entries(libraries)) {
  const voiceId = voiceIds[personaId];
  if (!voiceId) continue;
  const dir = join(root, "public/audio", personaId);
  mkdirSync(dir, { recursive: true });

  let rendered = 0;
  for (const phrase of phrases) {
    const file = join(dir, `${phrase.id}.mp3`);
    if (existsSync(file)) continue;
    process.stdout.write(`[${personaId}] ${phrase.id} … `);
    try {
      writeFileSync(file, await render(voiceId, phrase.text, voiceSpeeds[personaId]));
      rendered++;
      console.log("ok");
    } catch (err) {
      console.log(`FAILED (${err.message})`);
    }
  }

  const ids = readdirSync(dir)
    .filter((f) => f.endsWith(".mp3"))
    .map((f) => f.replace(/\.mp3$/, ""));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(ids, null, 2));
  console.log(`[${personaId}] ${rendered} new, ${ids.length} total in library`);
}
