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
