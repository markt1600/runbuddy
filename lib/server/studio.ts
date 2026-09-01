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
  | "ready" // instant clone built — voice_id is usable immediately
  | "failed";

export interface StudioSession {
  id: string; // unguessable token, doubles as the recording URL
  label: string; // who this link was made for, e.g. "John Tan — Ah Beng"
  persona: PersonaId;
  createdAt: number;
  /** Agreed one-time fee in SGD — baked into the licence text they sign. */
  feeSgd?: number;
  /** Hard completion deadline (ms epoch, end of a Singapore day) — also in
   *  the licence, and shown on every actor visit. */
  deadlineAt?: number;
  /** Pipeline dry-run: a tiny built-in item list, and promotion disabled so
   *  no real persona's library can be touched. */
  test?: boolean;
  /** Voice-clone-only: the item list is the CLONE_READS paragraph set — no
   *  phrase bank, no promotion, natural-voice brief. Fee and deadline are
   *  optional for these. */
  cloneOnly?: boolean;
  /** When the actor pressed "finish & submit" — starts the review clock.
   *  Re-submitted after flag redos; newest submission wins. */
  submittedAt?: number;
  license?: {
    typedName: string;
    email: string;
    paynowId: string;
    /** Snapshot of the fee and deadline the signed text contained. */
    feeSgd?: number;
    deadlineAt?: number;
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
export const takeMp3Path = (sessionId: string, itemId: string) =>
  `${takesPrefix(sessionId)}${itemId}.mp3`;

export const SESSION_TOKEN_RE = /^[0-9a-f]{24}$/;
export const ITEM_ID_RE = /^[\w-]{1,60}$/;

export async function createStudioSession(
  label: string,
  persona: PersonaId,
  feeSgd = 0,
  deadlineAt = 0,
  test = false,
  cloneOnly = false
): Promise<StudioSession> {
  const session: StudioSession = {
    id: randomBytes(12).toString("hex"),
    label: label.slice(0, 80),
    persona,
    feeSgd: Math.max(0, Math.min(100_000, feeSgd)),
    deadlineAt: deadlineAt > 0 ? deadlineAt : undefined,
    test: test || undefined,
    cloneOnly: cloneOnly || undefined,
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

// Overwritten blobs can serve the PREVIOUS content from the edge for a short
// window even with cacheControlMaxAge 0 — a fresh query string forces a cache
// miss so reads-after-writes (flag, then reload) see the newest session.
const bust = (url: string) =>
  `${url}${url.includes("?") ? "&" : "?"}nocache=${Date.now()}`;

export async function getSession(id: string): Promise<StudioSession | null> {
  if (!SESSION_TOKEN_RE.test(id)) return null;
  const pathname = sessionPath(id);
  const page = await list({ prefix: pathname, limit: 1 });
  const hit = page.blobs.find((b) => b.pathname === pathname);
  if (!hit) return null;
  try {
    const res = await fetch(bust(hit.url), { cache: "no-store" });
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
        const res = await fetch(bust(url), { cache: "no-store" });
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

/** Browser-encoded MP3 twin of a long-read take — the clone-training copy,
 *  small enough to re-upload to ElevenLabs from a serverless function. */
export async function saveTakeMp3(
  sessionId: string,
  itemId: string,
  mp3: Buffer
): Promise<void> {
  await put(takeMp3Path(sessionId, itemId), mp3, {
    access: "public",
    contentType: "audio/mpeg",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
}

/** Every audio file a session has, wav and mp3 alike, keyed for the clone
 *  builder to pick the best copy of each item. */
export async function listTakeFiles(
  sessionId: string
): Promise<{ itemId: string; ext: "wav" | "mp3"; url: string; size: number }[]> {
  const out: { itemId: string; ext: "wav" | "mp3"; url: string; size: number }[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: takesPrefix(sessionId), cursor });
    for (const b of page.blobs) {
      const m = b.pathname.match(/\/([\w-]+)\.(wav|mp3)$/);
      if (m) out.push({ itemId: m[1], ext: m[2] as "wav" | "mp3", url: b.url, size: b.size });
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
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

// ---- auditions: one public link per character, many one-line submissions ----
// A call is a shareable token; anyone with it can leave a name, an email and
// ONE recorded line. Winners get a full paid session created from the studio.

export interface AuditionCall {
  id: string;
  persona: PersonaId;
  createdAt: number;
}

export interface AuditionSubmission {
  id: string;
  name: string;
  email: string;
  at: number;
}

const auditionPath = (id: string) => `studio/auditions/${id}.json`;
const auditionSubPrefix = (id: string) => `studio/auditions/${id}/`;

export async function createAuditionCall(persona: PersonaId): Promise<AuditionCall> {
  const call: AuditionCall = {
    id: randomBytes(12).toString("hex"),
    persona,
    createdAt: Date.now(),
  };
  await put(auditionPath(call.id), JSON.stringify(call), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
  return call;
}

export async function getAuditionCall(id: string): Promise<AuditionCall | null> {
  if (!SESSION_TOKEN_RE.test(id)) return null;
  const pathname = auditionPath(id);
  const page = await list({ prefix: pathname, limit: 1 });
  const hit = page.blobs.find((b) => b.pathname === pathname);
  if (!hit) return null;
  try {
    const res = await fetch(bust(hit.url), { cache: "no-store" });
    return res.ok ? ((await res.json()) as AuditionCall) : null;
  } catch {
    return null;
  }
}

export async function saveAuditionSubmission(
  callId: string,
  name: string,
  email: string,
  mp3: Buffer
): Promise<AuditionSubmission> {
  const sub: AuditionSubmission = {
    id: randomBytes(8).toString("hex"),
    name: name.slice(0, 80),
    email: email.slice(0, 200),
    at: Date.now(),
  };
  // Audio first: an orphaned MP3 is invisible, a submission row with no
  // audio would be a broken audition.
  await put(`${auditionSubPrefix(callId)}${sub.id}.mp3`, mp3, {
    access: "public",
    contentType: "audio/mpeg",
    addRandomSuffix: false,
    allowOverwrite: false,
    cacheControlMaxAge: 0,
  });
  await put(`${auditionSubPrefix(callId)}${sub.id}.json`, JSON.stringify(sub), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: false,
    cacheControlMaxAge: 0,
  });
  return sub;
}

/** Every call with its submissions (audio URL attached), newest call first. */
export async function listAuditionCalls(): Promise<
  { call: AuditionCall; submissions: (AuditionSubmission & { audioUrl: string | null })[] }[]
> {
  const callUrls: string[] = [];
  const subUrls = new Map<string, string[]>(); // callId → meta urls
  const audioUrls = new Map<string, string>(); // "<callId>/<subId>" → mp3 url
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: "studio/auditions/", cursor });
    for (const b of page.blobs) {
      const call = b.pathname.match(/^studio\/auditions\/([0-9a-f]{24})\.json$/);
      const meta = b.pathname.match(/^studio\/auditions\/([0-9a-f]{24})\/(\w+)\.json$/);
      const audio = b.pathname.match(/^studio\/auditions\/([0-9a-f]{24})\/(\w+)\.mp3$/);
      if (call) callUrls.push(b.url);
      else if (meta) subUrls.set(meta[1], [...(subUrls.get(meta[1]) ?? []), b.url]);
      else if (audio) audioUrls.set(`${audio[1]}/${audio[2]}`, b.url);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  const readJson = async <T>(url: string): Promise<T | null> => {
    try {
      const res = await fetch(bust(url), { cache: "no-store" });
      return res.ok ? ((await res.json()) as T) : null;
    } catch {
      return null;
    }
  };
  const calls = (await Promise.all(callUrls.map((u) => readJson<AuditionCall>(u)))).filter(
    (c): c is AuditionCall => !!c?.id
  );
  const out = await Promise.all(
    calls.map(async (call) => {
      const subs = (
        await Promise.all(
          (subUrls.get(call.id) ?? []).map((u) => readJson<AuditionSubmission>(u))
        )
      )
        .filter((s): s is AuditionSubmission => !!s?.id)
        .map((s) => ({ ...s, audioUrl: audioUrls.get(`${call.id}/${s.id}`) ?? null }))
        .sort((a, b) => b.at - a.at);
      return { call, submissions: subs };
    })
  );
  return out.sort((a, b) => b.call.createdAt - a.call.createdAt);
}

/** Close a call: the link dies and every submission (audio + meta) goes too. */
export async function deleteAuditionCall(id: string): Promise<void> {
  if (!SESSION_TOKEN_RE.test(id)) return;
  const doomed: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: auditionSubPrefix(id), cursor });
    for (const b of page.blobs) doomed.push(b.url);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  const callPage = await list({ prefix: auditionPath(id), limit: 1 });
  const hit = callPage.blobs.find((b) => b.pathname === auditionPath(id));
  if (hit) doomed.push(hit.url);
  if (doomed.length > 0) await del(doomed);
}

/** Withdraw an invitation: the session record and every uploaded take. */
export async function deleteSession(id: string): Promise<void> {
  if (!SESSION_TOKEN_RE.test(id)) return;
  const doomed: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: takesPrefix(id), cursor });
    for (const b of page.blobs) doomed.push(b.url);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  const sessionPage = await list({ prefix: sessionPath(id), limit: 1 });
  const hit = sessionPage.blobs.find((b) => b.pathname === sessionPath(id));
  if (hit) doomed.push(hit.url);
  if (doomed.length > 0) await del(doomed);
}

export async function deleteTake(sessionId: string, itemId: string): Promise<void> {
  for (const pathname of [takePath(sessionId, itemId), takeMp3Path(sessionId, itemId)]) {
    const page = await list({ prefix: pathname, limit: 2 });
    const hit = page.blobs.find((b) => b.pathname === pathname);
    if (hit) await del(hit.url);
  }
}
