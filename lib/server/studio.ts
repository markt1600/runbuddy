import { randomBytes } from "node:crypto";
import { del, list, put } from "@vercel/blob";
import type { PersonaId } from "../types";

// The voice studio: professional actors record a persona's whole phrase bank
// (plus long reads for the voice clone) through a tokenized web page. The
// token IS the actor's identity — every take they upload hangs off their
// session. Nothing here touches the live library until the admin promotes.

export type PvcState =
  | "none"
  | "created"
  | "uploaded"
  | "verify"
  | "training"
  | "failed";

export interface StudioSession {
  id: string; // unguessable token, doubles as the recording URL
  label: string; // who this link was made for, e.g. "John Tan — Ah Beng"
  persona: PersonaId;
  createdAt: number;
  license?: {
    typedName: string;
    email: string;
    paynowId: string;
    at: number;
    ip?: string;
    ua?: string;
    version: string;
  };
  /** Items the admin sent back for another take. A take uploaded after the
   *  flag's timestamp counts as the redo and clears it visually. */
  flags?: { itemId: string; note?: string; at: number }[];
  pvc?: {
    voiceId?: string;
    state: PvcState;
    attempts?: number;
    note?: string;
  };
}

export interface StudioTake {
  itemId: string;
  url: string;
  size: number;
  at: string;
}

const sessionPath = (id: string) => `studio/sessions/${id}.json`;
const takesPrefix = (id: string) => `studio/takes/${id}/`;
export const takePath = (sessionId: string, itemId: string) =>
  `${takesPrefix(sessionId)}${itemId}.wav`;

export const SESSION_TOKEN_RE = /^[0-9a-f]{24}$/;
export const ITEM_ID_RE = /^[\w-]{1,60}$/;

export async function createStudioSession(
  label: string,
  persona: PersonaId
): Promise<StudioSession> {
  const session: StudioSession = {
    id: randomBytes(12).toString("hex"),
    label: label.slice(0, 80),
    persona,
    createdAt: Date.now(),
  };
  await writeSession(session);
  return session;
}

export async function writeSession(s: StudioSession): Promise<void> {
  await put(sessionPath(s.id), JSON.stringify(s, null, 1), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
}

export async function getSession(id: string): Promise<StudioSession | null> {
  if (!SESSION_TOKEN_RE.test(id)) return null;
  const pathname = sessionPath(id);
  const page = await list({ prefix: pathname, limit: 1 });
  const hit = page.blobs.find((b) => b.pathname === pathname);
  if (!hit) return null;
  try {
    const res = await fetch(hit.url, { cache: "no-store" });
    return res.ok ? ((await res.json()) as StudioSession) : null;
  } catch {
    return null;
  }
}

export async function listSessions(): Promise<StudioSession[]> {
  const urls: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: "studio/sessions/", cursor });
    for (const b of page.blobs) urls.push(b.url);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  const bodies = await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        return res.ok ? ((await res.json()) as StudioSession) : null;
      } catch {
        return null;
      }
    })
  );
  return bodies
    .filter((s): s is StudioSession => !!s?.id)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveTake(
  sessionId: string,
  itemId: string,
  wav: Buffer
): Promise<void> {
  await put(takePath(sessionId, itemId), wav, {
    access: "public",
    contentType: "audio/wav",
    addRandomSuffix: false,
    allowOverwrite: true, // re-records replace in place
    cacheControlMaxAge: 0,
  });
}

export async function listTakes(sessionId: string): Promise<StudioTake[]> {
  const out: StudioTake[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: takesPrefix(sessionId), cursor });
    for (const b of page.blobs) {
      const m = b.pathname.match(/\/([\w-]+)\.wav$/);
      if (m) {
        out.push({
          itemId: m[1],
          url: b.url,
          size: b.size,
          at: b.uploadedAt.toISOString(),
        });
      }
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

export async function deleteTake(sessionId: string, itemId: string): Promise<void> {
  const pathname = takePath(sessionId, itemId);
  const page = await list({ prefix: pathname, limit: 1 });
  const hit = page.blobs.find((b) => b.pathname === pathname);
  if (hit) await del(hit.url);
}
