import { PHRASE_LIBRARY } from "./phrases";
import type { PersonaId } from "./types";

// Client-side registry of which library phrases have real rendered audio and
// where it lives — committed static files (public/audio/...) or runtime-rendered
// Vercel Blob URLs. The coach reads it live, so phrases become "pre-rendered"
// the moment the generator finishes them mid-session.

const urls = new Map<string, string>(); // "<persona>/<id>" → url

export function getPhraseUrl(persona: PersonaId, id: string): string | undefined {
  return urls.get(`${persona}/${id}`);
}

export function renderedCount(persona: PersonaId): number {
  return PHRASE_LIBRARY[persona].filter((p) => urls.has(`${persona}/${p.id}`)).length;
}

export interface GenerationProgress {
  state: "idle" | "checking" | "generating" | "done" | "unavailable" | "error";
  done: number; // phrases with audio (all personas)
  total: number; // all library phrases
  current?: string; // persona name being rendered
  message?: string;
}

let started = false;

/**
 * Ensure the whole library has rendered audio. Loads static manifests and the
 * blob status, then renders whatever is missing one phrase at a time through
 * the server (which holds the ElevenLabs key). Safe to call once per app load;
 * progress is reported via the callback.
 */
export async function ensureVoiceLibrary(
  onProgress: (p: GenerationProgress) => void
): Promise<void> {
  if (started) return;
  started = true;

  const allPhrases = (Object.keys(PHRASE_LIBRARY) as PersonaId[]).flatMap((persona) =>
    PHRASE_LIBRARY[persona].map((p) => ({ persona, id: p.id }))
  );
  const total = allPhrases.length;
  const report = (state: GenerationProgress["state"], extra: Partial<GenerationProgress> = {}) =>
    onProgress({ state, done: countKnown(), total, ...extra });

  const countKnown = () =>
    allPhrases.filter(({ persona, id }) => urls.has(`${persona}/${id}`)).length;

  report("checking");

  // 1. Static manifests (phrases committed via `npm run generate-library`)
  for (const persona of Object.keys(PHRASE_LIBRARY) as PersonaId[]) {
    try {
      const res = await fetch(`/audio/${persona}/manifest.json`);
      if (res.ok) {
        const ids: string[] = await res.json();
        ids.forEach((id) => urls.set(`${persona}/${id}`, `/audio/${persona}/${id}.mp3`));
      }
    } catch {
      /* no static library — fine */
    }
  }

  // 2. Blob-rendered phrases + server capability
  let canRender = false;
  try {
    const res = await fetch("/api/library/status");
    if (res.ok) {
      const data: { canRender: boolean; rendered: Record<string, string> } = await res.json();
      canRender = data.canRender;
      for (const [key, url] of Object.entries(data.rendered)) {
        if (!urls.has(key)) urls.set(key, url);
      }
    }
  } catch {
    /* offline or route missing */
  }

  const missing = allPhrases.filter(({ persona, id }) => !urls.has(`${persona}/${id}`));
  if (missing.length === 0) {
    report("done");
    return;
  }
  if (!canRender) {
    report("unavailable");
    return;
  }

  // 3. Render the gaps, one phrase at a time, sequentially (ElevenLabs
  // concurrency limits are low, and this gives clean per-phrase progress).
  let consecutiveFailures = 0;
  report("generating", { current: missing[0].persona });
  for (const { persona, id } of missing) {
    try {
      const res = await fetch("/api/library/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona, id }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data: { url: string } = await res.json();
      urls.set(`${persona}/${id}`, data.url);
      consecutiveFailures = 0;
      report("generating", { current: persona });
    } catch {
      consecutiveFailures++;
      if (consecutiveFailures >= 3) {
        report("error", {
          message: "Voice rendering stopped — check ElevenLabs credits. Will retry next launch.",
        });
        return;
      }
    }
  }
  report("done");
}
