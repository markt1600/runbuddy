import { del, list, put } from "@vercel/blob";
import { UID_RE } from "./users";

// Shoutouts: one-way messages from a friend, delivered by voice during the
// recipient's run — right now if they're mid-run, or at the start, middle or
// end of their next one. Either the sender's own recording, or words spoken
// by whatever trainer the recipient is running with. No thread, no reply —
// a delivery, like the affirmation calls.

export type ShoutoutSlot = "now" | "start" | "middle" | "end";

export interface Shoutout {
  id: string;
  fromUid: string;
  fromName: string;
  kind: "voice" | "trainer";
  /** trainer kind: the words. */
  text?: string;
  /** trainer kind: may the trainer embellish, or word for word? */
  embellish?: boolean;
  /** voice kind: the sender's recording. */
  audioBase64?: string;
  mime?: string;
  slot: ShoutoutSlot;
  createdAt: number;
}

const dirPrefix = (toUid: string) => `shoutouts/${toUid}/`;
const itemPath = (toUid: string, id: string) => `${dirPrefix(toUid)}${id}.json`;

export async function createShoutout(toUid: string, s: Shoutout): Promise<void> {
  if (!UID_RE.test(toUid)) throw new Error("bad uid");
  await put(itemPath(toUid, s.id), JSON.stringify(s), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
}

export async function listShoutouts(toUid: string): Promise<Shoutout[]> {
  const out: Shoutout[] = [];
  let cursor: string | undefined;
  const urls: string[] = [];
  do {
    const page = await list({ prefix: dirPrefix(toUid), cursor });
    for (const blob of page.blobs) urls.push(blob.url);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  const bodies = await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        return res.ok ? ((await res.json()) as Shoutout) : null;
      } catch {
        return null;
      }
    })
  );
  for (const s of bodies) if (s?.id) out.push(s);
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

export async function deleteShoutout(toUid: string, id: string): Promise<void> {
  const pathname = itemPath(toUid, id);
  const page = await list({ prefix: pathname, limit: 1 });
  const hit = page.blobs.find((b) => b.pathname === pathname);
  if (hit) await del(hit.url);
}

// ---- Played receipts ----
// A delivered message is consumed from the queue, but "delivered to the
// phone" is not "heard": the start/middle/end slots play minutes later, and
// a run can end first. So delivery parks a receipt under the RECIPIENT, and
// the run screen reports the moment the message actually starts playing.
// The sender learns about it then, in their What's-new strip. Keeping the
// receipt on the recipient's side means only the recipient's own report can
// complete it, and the sender's identity comes from our record, never from
// the request.

export interface ShoutoutReceipt {
  id: string;
  fromUid: string;
  fromName: string;
  kind: "voice" | "trainer";
  /** trainer kind: the sender's own words (not the trainer's rendering). */
  text?: string;
  embellish?: boolean;
  /** Which trainer voiced it (trainer kind) or introduced it (voice kind). */
  persona: string;
  slot: ShoutoutSlot;
  deliveredAt: number;
}

const receiptPrefix = (toUid: string) => `shoutout-receipts/${toUid}/`;
const receiptPath = (toUid: string, id: string) => `${receiptPrefix(toUid)}${id}.json`;
const RECEIPT_TTL_MS = 2 * 86_400_000;

export async function putReceipt(toUid: string, r: ShoutoutReceipt): Promise<void> {
  if (!UID_RE.test(toUid)) return;
  await put(receiptPath(toUid, r.id), JSON.stringify(r), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
}

/** Reads and removes one receipt. Sweeps expired siblings while it's there. */
export async function takeReceipt(toUid: string, id: string): Promise<ShoutoutReceipt | null> {
  if (!UID_RE.test(toUid) || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  const page = await list({ prefix: receiptPrefix(toUid) });
  const want = receiptPath(toUid, id);
  let found: ShoutoutReceipt | null = null;
  const stale: string[] = [];
  for (const b of page.blobs) {
    if (b.pathname === want) {
      try {
        const res = await fetch(`${b.url}?nocache=${Date.now()}`, { cache: "no-store" });
        if (res.ok) found = (await res.json()) as ShoutoutReceipt;
      } catch {
        /* treat as missing */
      }
      stale.push(b.url);
    } else if (Date.now() - b.uploadedAt.getTime() > RECEIPT_TTL_MS) {
      stale.push(b.url);
    }
  }
  if (stale.length > 0) await del(stale).catch(() => {});
  return found?.id ? found : null;
}
