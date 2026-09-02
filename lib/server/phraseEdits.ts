import { randomBytes } from "node:crypto";
import { del, list, put } from "@vercel/blob";
import type { PersonaId } from "../types";

// Phrase-editing sessions: a tokenized link where a human corrects the
// AI-generated Singlish, one text box per phrase. No licence, no audio —
// suggestions accumulate in the session and the admin accepts or rejects
// each one; accepted text lands in the persona's overrides and the stale
// audio is deleted for regeneration.

export interface PhraseEditSession {
  id: string; // unguessable token, doubles as the editing URL
  label: string; // who this link was made for
  persona: PersonaId;
  createdAt: number;
  /** phraseId → the editor's corrected text. */
  suggestions: Record<string, string>;
  /** phraseId → verdict; a re-edit after a verdict clears it (new suggestion). */
  resolved?: Record<string, "accepted" | "rejected">;
  submittedAt?: number;
}

const editPath = (id: string) => `studio/edits/${id}.json`;
export const EDIT_TOKEN_RE = /^[0-9a-f]{24}$/;

const bust = (url: string) =>
  `${url}${url.includes("?") ? "&" : "?"}nocache=${Date.now()}`;

export async function createEditSession(
  label: string,
  persona: PersonaId
): Promise<PhraseEditSession> {
  const session: PhraseEditSession = {
    id: randomBytes(12).toString("hex"),
    label: label.slice(0, 80),
    persona,
    createdAt: Date.now(),
    suggestions: {},
  };
  await writeEditSession(session);
  return session;
}

export async function writeEditSession(s: PhraseEditSession): Promise<void> {
  await put(editPath(s.id), JSON.stringify(s, null, 1), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
}

export async function getEditSession(id: string): Promise<PhraseEditSession | null> {
  if (!EDIT_TOKEN_RE.test(id)) return null;
  const pathname = editPath(id);
  const page = await list({ prefix: pathname, limit: 1 });
  const hit = page.blobs.find((b) => b.pathname === pathname);
  if (!hit) return null;
  try {
    const res = await fetch(bust(hit.url), { cache: "no-store" });
    return res.ok ? ((await res.json()) as PhraseEditSession) : null;
  } catch {
    return null;
  }
}

export async function listEditSessions(): Promise<PhraseEditSession[]> {
  const urls: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: "studio/edits/", cursor });
    for (const b of page.blobs) {
      if (/^studio\/edits\/[0-9a-f]{24}\.json$/.test(b.pathname)) urls.push(b.url);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  const bodies = await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(bust(url), { cache: "no-store" });
        return res.ok ? ((await res.json()) as PhraseEditSession) : null;
      } catch {
        return null;
      }
    })
  );
  return bodies
    .filter((s): s is PhraseEditSession => !!s?.id)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteEditSession(id: string): Promise<void> {
  if (!EDIT_TOKEN_RE.test(id)) return;
  const pathname = editPath(id);
  const page = await list({ prefix: pathname, limit: 1 });
  const hit = page.blobs.find((b) => b.pathname === pathname);
  if (hit) await del(hit.url);
}
