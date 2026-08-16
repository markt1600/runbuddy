import { list, put } from "@vercel/blob";
import { PHRASE_LIBRARY } from "../phrases";
import { renderVoiceBuffer } from "./generate";
import type { PersonaId, Phrase } from "../types";

// Runtime voice-library rendering into Vercel Blob. Serverless filesystems are
// ephemeral, so MP3s rendered after deploy live in Blob storage; phrases
// committed to public/audio/ (via `npm run generate-library`) are still served
// statically and take precedence client-side.

export function blobConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

export function elevenLabsConfigured(): boolean {
  return !!process.env.ELEVENLABS_API_KEY;
}

const PREFIX = "audio";

/** All blob-rendered phrases: { "<persona>/<id>": url }. */
export async function listRendered(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!blobConfigured()) return out;
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: `${PREFIX}/`, cursor });
    for (const blob of page.blobs) {
      // pathname: audio/<persona>/<id>.mp3
      const m = blob.pathname.match(/^audio\/(\w+)\/([\w-]+)\.mp3$/);
      if (m) out[`${m[1]}/${m[2]}`] = blob.url;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

// ---- AI-generated "extra" phrases, stored as JSON in Blob ----

const extrasPath = (persona: PersonaId) => `library/${persona}/extras.json`;

export async function readExtras(persona: PersonaId): Promise<Phrase[]> {
  if (!blobConfigured()) return [];
  try {
    const page = await list({ prefix: extrasPath(persona), limit: 1 });
    const hit = page.blobs.find((b) => b.pathname === extrasPath(persona));
    if (!hit) return [];
    const res = await fetch(hit.url, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? (data as Phrase[]) : [];
  } catch {
    return [];
  }
}

export async function appendExtras(persona: PersonaId, phrases: Phrase[]): Promise<Phrase[]> {
  const existing = await readExtras(persona);
  const merged = [...existing, ...phrases];
  await put(extrasPath(persona), JSON.stringify(merged, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
  return merged;
}

async function findPhrase(persona: PersonaId, phraseId: string): Promise<Phrase | undefined> {
  const fromStatic = PHRASE_LIBRARY[persona].find((p) => p.id === phraseId);
  if (fromStatic) return fromStatic;
  return (await readExtras(persona)).find((p) => p.id === phraseId);
}

/**
 * Render one library phrase into Blob. Idempotent unless `force`, which
 * re-renders and overwrites — used after a persona's voice ID changes.
 */
export async function renderPhraseToBlob(
  persona: PersonaId,
  phraseId: string,
  force = false
): Promise<{ url: string; existed: boolean }> {
  const phrase = await findPhrase(persona, phraseId);
  if (!phrase) throw new Error("unknown phrase");

  const pathname = `${PREFIX}/${persona}/${phraseId}.mp3`;
  if (!force) {
    const existing = await list({ prefix: pathname, limit: 1 });
    const hit = existing.blobs.find((b) => b.pathname === pathname);
    if (hit) return { url: hit.url, existed: true };
  }

  const buf = await renderVoiceBuffer(persona, phrase.text);
  if (!buf) throw new Error("elevenlabs render failed");

  const blob = await put(pathname, buf, {
    access: "public",
    contentType: "audio/mpeg",
    addRandomSuffix: false,
    allowOverwrite: true, // benign if two clients race on the same phrase
    cacheControlMaxAge: 31536000,
  });
  return { url: blob.url, existed: false };
}
