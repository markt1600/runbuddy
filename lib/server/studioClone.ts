import { StudioSession, listTakeFiles, writeSession } from "./studio";
import { ivcCreate, voiceDelete } from "./elevenPvc";
import { CLONE_READS, readsFor, TEST_READS } from "../studioReads";
import { PERSONAS } from "../personas";

// Builds an ElevenLabs Instant Voice Clone from a session's long-read takes,
// preferring the browser-encoded MP3 twin of each read (small) and falling
// back to the raw WAV (takes recorded before MP3 twins existed). Runs
// automatically when the actor submits, and again from the studio's retry
// button; each rebuild replaces the previous voice.

// IVC quality saturates after a few minutes of clean audio — ElevenLabs'
// own guidance is ~1–3 minutes — so a handful of reads beats all fifteen,
// and keeps the serverless download+upload well inside its time budget.
// Clone-only sessions upload their whole paragraph set: it was written to be
// exactly the training material, and the MP3 twins keep it small.
const MAX_FILES = 6;
const MAX_FILES_CLONE_ONLY = 12;
const MAX_TOTAL_BYTES = 35_000_000;

export async function instantCloneFromSession(session: StudioSession): Promise<string> {
  const readIds = (
    session.test ? TEST_READS : session.cloneOnly ? CLONE_READS : readsFor(session.persona)
  ).map((r) => r.id);
  const files = await listTakeFiles(session.id);
  const byItem = new Map<string, { url: string; ext: "wav" | "mp3"; size: number }>();
  for (const f of files) {
    const cur = byItem.get(f.itemId);
    if (!cur || (cur.ext === "wav" && f.ext === "mp3")) byItem.set(f.itemId, f);
  }

  const picked: { name: string; data: Buffer; mime: string }[] = [];
  let total = 0;
  for (const id of readIds) {
    const f = byItem.get(id);
    if (!f) continue;
    const cap = session.cloneOnly ? MAX_FILES_CLONE_ONLY : MAX_FILES;
    if (picked.length >= cap || total + f.size > MAX_TOTAL_BYTES) break;
    const res = await fetch(f.url, { cache: "no-store" });
    if (!res.ok) continue;
    picked.push({
      name: `${id}.${f.ext}`,
      data: Buffer.from(await res.arrayBuffer()),
      mime: f.ext === "mp3" ? "audio/mpeg" : "audio/wav",
    });
    total += f.size;
  }
  if (picked.length === 0) {
    throw new Error("no long-read takes found — the clone trains on the reads");
  }

  // A re-clone supersedes the old voice; losing the delete is harmless
  // (an orphan in the ElevenLabs dashboard), so it never blocks the rebuild.
  if (session.pvc?.voiceId) await voiceDelete(session.pvc.voiceId).catch(() => {});

  const voiceId = await ivcCreate(
    session.cloneOnly
      ? `${session.label} (clone)`
      : `RunBuddy ${PERSONAS[session.persona].shortName} — ${session.label}`,
    picked
  );
  session.pvc = { voiceId, state: "ready" };
  await writeSession(session);
  return voiceId;
}
