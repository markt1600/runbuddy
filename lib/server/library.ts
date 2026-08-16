import { list, put } from "@vercel/blob";
import { PHRASE_LIBRARY } from "../phrases";
import { renderVoiceBuffer } from "./generate";
import type { PersonaId } from "../types";

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

/** Render one library phrase into Blob (idempotent). Returns its public URL. */
export async function renderPhraseToBlob(
  persona: PersonaId,
  phraseId: string
): Promise<{ url: string; existed: boolean }> {
  const phrase = PHRASE_LIBRARY[persona].find((p) => p.id === phraseId);
  if (!phrase) throw new Error("unknown phrase");

  const pathname = `${PREFIX}/${persona}/${phraseId}.mp3`;
  const existing = await list({ prefix: pathname, limit: 1 });
  const hit = existing.blobs.find((b) => b.pathname === pathname);
  if (hit) return { url: hit.url, existed: true };

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
