import { del, list, put } from "@vercel/blob";
import { PHRASE_LIBRARY } from "../phrases";
import { phraseHash } from "../phraseHash";
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
/** Blob-rendered audio with when each file was actually cut. */
export async function listRendered(): Promise<Record<string, { url: string; at: string }>> {
  const out: Record<string, { url: string; at: string }> = {};
  if (!blobConfigured()) return out;
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: `${PREFIX}/`, cursor });
    for (const blob of page.blobs) {
      // pathname: audio/<persona>/<id>.mp3
      const m = blob.pathname.match(/^audio\/(\w+)\/([\w-]+)\.mp3$/);
      if (m) out[`${m[1]}/${m[2]}`] = { url: blob.url, at: blob.uploadedAt.toISOString() };
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

// ---- render manifest: which text each rendered MP3 was actually cut from ----

// One empty marker blob per render, with the phrase id and the text
// fingerprint encoded in its pathname. Deliberately not a single JSON manifest:
// that needs read-modify-write, and the read goes through the CDN, which serves
// the pre-overwrite copy for a while. A run of renders seconds apart would each
// read a stale map and write back a copy missing its predecessors, so all but
// the last few entries evaporate. Pathname-as-data has no read step to be stale.
const markerPrefix = (persona: PersonaId) => `library/${persona}/rendered/`;
const markerPath = (persona: PersonaId, phraseId: string, hash: string) =>
  `${markerPrefix(persona)}${phraseId}__${hash}`;

/** `{ "<phraseId>": "<textHash>" }` — what one persona's rendered audio says. */
export async function readRenderHashes(persona: PersonaId): Promise<Record<string, string>> {
  if (!blobConfigured()) return {};
  const out: Record<string, string> = {};
  const seenAt: Record<string, number> = {};
  try {
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: markerPrefix(persona), cursor });
      for (const blob of page.blobs) {
        const m = blob.pathname.match(/\/rendered\/(.+)__([0-9a-f]{8})$/);
        if (!m) continue;
        const [, id, hash] = m;
        // Re-rendering the same text overwrites its own marker, so a phrase only
        // collects more than one when its wording actually changed. Newest wins.
        const at = blob.uploadedAt.getTime();
        if (seenAt[id] !== undefined && seenAt[id] >= at) continue;
        seenAt[id] = at;
        out[id] = hash;
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  } catch {
    return {};
  }
  return out;
}

/** Record what a freshly rendered phrase says. Independent per phrase. */
async function recordRenderHash(persona: PersonaId, phraseId: string, hash: string) {
  const fresh = markerPath(persona, phraseId, hash);
  // The hash doubles as the body: the SDK rejects empty bodies outright
  // (`BlobError: body is required`), which a zero-byte marker tripped on
  // every render — after the audio had already been produced and stored, so
  // the whole pass read as "failed" while quietly spending real credits.
  await put(fresh, hash, {
    access: "public",
    contentType: "text/plain",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
  // Sweep this phrase's superseded markers, so the store stays at one marker
  // per phrase and resolution never has to fall back to comparing upload
  // times. Only after the new marker is safely up: losing a cleanup is a few
  // orphaned zero-byte blobs, losing the record would be a phrase whose audio
  // reads as stale forever. The `__` in the prefix keeps li-pu-1 from ever
  // matching li-pu-17's markers.
  try {
    const page = await list({ prefix: `${markerPrefix(persona)}${phraseId}__` });
    const stale = page.blobs.filter((b) => b.pathname !== fresh).map((b) => b.url);
    if (stale.length > 0) await del(stale);
  } catch {
    /* best effort — the newest-wins read still resolves correctly */
  }
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
  // Only after the audio is actually in place — a recorded hash claims the
  // MP3 speaks this text, and a failed put must not leave that claim behind.
  // Best-effort in the other direction too: the render is already paid for
  // and stored, so a bookkeeping hiccup must not make it report as failed.
  // The cost of a lost marker is only that this phrase can't be flagged
  // stale until its next render.
  try {
    await recordRenderHash(persona, phraseId, phraseHash(phrase.text));
  } catch {
    /* provenance is best-effort */
  }
  return { url: blob.url, existed: false };
}
