import { PHRASE_LIBRARY } from "./phrases";
import { PERSONAS } from "./personas";
import { phraseHash } from "./phraseHash";
import type { Persona, Phrase, PersonaId, PhraseCategory } from "./types";

// Client-side registry of the full phrase library — static phrases shipped in
// the bundle plus AI-generated "extra" phrases stored server-side — and which
// of them have real rendered audio (committed static MP3s or Vercel Blob URLs).
// The coach reads it live, so phrases become available the moment they render.

const urls = new Map<string, string>(); // "<persona>/<id>" → audio url
const renderedAt = new Map<string, string>(); // "<persona>/<id>" → ISO recording time
const promoted = new Set<string>(); // "<persona>/<id>" — a real actor's take, not TTS
const PERSONA_IDS = Object.keys(PERSONAS) as PersonaId[];

const extras = Object.fromEntries(PERSONA_IDS.map((p) => [p, [] as Phrase[]])) as Record<
  PersonaId,
  Phrase[]
>;
let flags = { blob: false, elevenlabs: false, canRender: false, statusReached: false };
const voiceSpeeds = Object.fromEntries(
  PERSONA_IDS.map((p) => [p, PERSONAS[p].elevenLabsSpeed])
) as Record<PersonaId, number>;
const voiceVolumes = Object.fromEntries(
  PERSONA_IDS.map((p) => [p, PERSONAS[p].playbackVolume])
) as Record<PersonaId, number>;
const renderHashes = Object.fromEntries(
  PERSONA_IDS.map((p) => [p, {} as Record<string, string>])
) as Record<PersonaId, Record<string, string>>;
// Human-corrected wording (accepted studio edits) — applied to every phrase
// text this module hands out, so the coach and admin speak the fixed words.
const textOverrides = Object.fromEntries(
  PERSONA_IDS.map((p) => [p, {} as Record<string, string>])
) as Record<PersonaId, Record<string, string>>;
let stateLoaded = false;

const key = (persona: PersonaId, id: string) => `${persona}/${id}`;

// ---- Admin PIN (kept for the session; sent on credit-spending calls) ----

const PIN_KEY = "runbuddy-admin-pin";

export function storeAdminPin(pin: string) {
  try {
    sessionStorage.setItem(PIN_KEY, pin);
  } catch {
    /* private mode */
  }
}

export function adminPinHeaders(): Record<string, string> {
  try {
    const pin = sessionStorage.getItem(PIN_KEY);
    return pin ? { "x-admin-pin": pin } : {};
  } catch {
    return {};
  }
}

export function getPhraseUrl(persona: PersonaId, id: string): string | undefined {
  return urls.get(key(persona, id));
}

/**
 * Every rendered audio URL this persona could play — what the shell's
 * offline cache warms at run start, so a dead zone only silences the
 * improvised lines while the whole pre-rendered library keeps talking.
 */
export function renderedUrlsFor(persona: PersonaId): string[] {
  const prefix = `${persona}/`;
  const out: string[] = [];
  for (const [k, url] of urls) {
    if (k.startsWith(prefix)) out.push(url);
  }
  return out;
}

/** When this phrase's audio was recorded, if we know. */
export function getPhraseRenderedAt(persona: PersonaId, id: string): Date | null {
  const iso = renderedAt.get(key(persona, id));
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d.getTime()) ? d : null;
}

export function allPhrasesFor(persona: PersonaId, category?: PhraseCategory): Phrase[] {
  const o = textOverrides[persona];
  const merged = [...PHRASE_LIBRARY[persona], ...extras[persona]].map((p) =>
    o[p.id] ? { ...p, text: o[p.id] } : p
  );
  return category ? merged.filter((p) => p.category === category) : merged;
}

export function renderedCount(persona: PersonaId): number {
  return allPhrasesFor(persona).filter((p) => urls.has(key(persona, p.id))).length;
}

export function libraryFlags() {
  return { ...flags };
}

export interface GenerationProgress {
  state: "idle" | "checking" | "generating" | "done" | "unavailable" | "error";
  done: number; // phrases with audio (all personas)
  total: number; // all library phrases (static + extras)
  message?: string;
}

function allPhrasesAllPersonas(only?: PersonaId): { persona: PersonaId; id: string }[] {
  const ids = only ? [only] : PERSONA_IDS;
  return ids.flatMap((persona) =>
    allPhrasesFor(persona).map((p) => ({ persona, id: p.id }))
  );
}

function countKnown(only?: PersonaId): number {
  return allPhrasesAllPersonas(only).filter(({ persona, id }) => urls.has(key(persona, id)))
    .length;
}

function unavailableReason(): string {
  if (!flags.statusReached) return "Couldn't reach the server to check the voice library.";
  if (!flags.elevenlabs && !flags.blob)
    return "Set ELEVENLABS_API_KEY and connect a Vercel Blob store to enable voice rendering.";
  if (!flags.elevenlabs) return "ELEVENLABS_API_KEY is not set on the server.";
  if (!flags.blob)
    return "No Vercel Blob store connected — in Vercel: Storage → Create Database → Blob, then redeploy.";
  return "Voice rendering is not available.";
}

/** Load static manifests + server status (flags, blob URLs, extra phrases). */
export async function loadLibraryState(force = false): Promise<void> {
  if (stateLoaded && !force) return;
  stateLoaded = true;

  for (const persona of Object.keys(PHRASE_LIBRARY) as PersonaId[]) {
    try {
      const res = await fetch(`/audio/${persona}/manifest.json`);
      if (res.ok) {
        const ids: string[] = await res.json();
        ids.forEach((id) => urls.set(key(persona, id), `/audio/${persona}/${id}.mp3`));
      }
    } catch {
      /* no static library — fine */
    }
  }

  try {
    const res = await fetch("/api/library/status");
    if (res.ok) {
      const data: {
        blob: boolean;
        elevenlabs: boolean;
        canRender: boolean;
        rendered: Record<string, string>;
        renderedAt?: Record<string, string>;
        renderHashes?: Record<string, Record<string, string>>;
        promoted?: string[];
        overrides?: Record<string, Record<string, string>>;
        extras: Record<string, Phrase[]>;
        voiceSettings?: Record<PersonaId, { speed: number; volume: number }>;
      } = await res.json();
      flags = { ...data, statusReached: true };
      for (const [k, url] of Object.entries(data.rendered)) {
        if (urls.has(k)) continue;
        // Version the URL with its render moment. Audio blobs overwrite in
        // place at a stable pathname with a year of CDN cache, so a
        // re-render is otherwise invisible to BOTH the shell's on-disk
        // voice cache (keyed by URL hash) and any CDN copy — the old
        // recording would play forever. A changed ?v= makes it a new URL
        // everywhere at once.
        const at = data.renderedAt?.[k];
        const stamp = at ? Date.parse(at) : NaN;
        urls.set(k, isFinite(stamp) ? `${url}?v=${Math.floor(stamp / 1000)}` : url);
      }
      for (const [k, at] of Object.entries(data.renderedAt ?? {})) {
        renderedAt.set(k, at);
      }
      promoted.clear();
      for (const k of data.promoted ?? []) promoted.add(k);
      for (const persona of Object.keys(extras) as PersonaId[]) {
        extras[persona] = data.extras?.[persona] ?? [];
        renderHashes[persona] = data.renderHashes?.[persona] ?? {};
        textOverrides[persona] = data.overrides?.[persona] ?? {};
        const speed = data.voiceSettings?.[persona]?.speed;
        if (typeof speed === "number") voiceSpeeds[persona] = speed;
        const volume = data.voiceSettings?.[persona]?.volume;
        if (typeof volume === "number") voiceVolumes[persona] = volume;
      }
    }
  } catch {
    /* offline or route missing — flags stay pessimistic */
  }
}

// ---- promoted audio: a real actor's take, promoted from the studio ----

/** True when this phrase's live audio is a studio-promoted actor recording. */
export function isPromoted(persona: PersonaId, id: string): boolean {
  return promoted.has(key(persona, id));
}

/** Ids of this persona's phrases whose live audio is a real actor's take. */
export function promotedPhrases(persona: PersonaId): string[] {
  return allPhrasesFor(persona)
    .filter((p) => promoted.has(key(persona, p.id)))
    .map((p) => p.id);
}

// ---- stale audio: the MP3 exists, but it says the old words ----

/**
 * True when a phrase has rendered audio that was cut from different text than
 * the phrase carries now. Editing wording without changing the id leaves the
 * old recording in place, because the gap-filling pass only looks for missing
 * files.
 *
 * Provenance only ever comes from a render that actually happened. Audio cut
 * before this tracking existed has none, and is reported current rather than
 * guessed at — an earlier version assumed such audio matched the text as it
 * read at a fixed commit, which flagged phrases that had since been correctly
 * re-rendered. Silence beats a false alarm: this now only flags a mismatch it
 * can prove, at the cost of saying nothing until a phrase has been voiced once
 * under the new bookkeeping.
 */
export function isPhraseStale(persona: PersonaId, id: string): boolean {
  if (!urls.has(key(persona, id))) return false; // nothing rendered to be stale
  const known = renderHashes[persona]?.[id];
  if (!known) return false;
  const phrase = allPhrasesFor(persona).find((p) => p.id === id);
  return !!phrase && phraseHash(phrase.text) !== known;
}

/** Every phrase whose audio is provably out of date, across one or all personas. */
export function stalePhrases(only?: PersonaId): { persona: PersonaId; id: string }[] {
  const personas = only ? [only] : PERSONA_IDS;
  return personas.flatMap((persona) =>
    allPhrasesFor(persona)
      .filter((p) => isPhraseStale(persona, p.id))
      .map((p) => ({ persona, id: p.id }))
  );
}

/**
 * Re-cut every out-of-date phrase. Sequential and force-rendering, same shape
 * as the gap-filling pass — this spends ElevenLabs credits, one call per phrase.
 */
export async function reRenderStale(
  onProgress: (p: GenerationProgress) => void,
  only?: PersonaId
): Promise<void> {
  const stale = stalePhrases(only);
  const total = stale.length;
  let done = 0;
  const report = (state: GenerationProgress["state"], message?: string) =>
    onProgress({ state, done, total, message });

  if (total === 0) {
    report("done");
    return;
  }
  if (!flags.canRender) {
    report("unavailable", unavailableReason());
    return;
  }

  let consecutiveFailures = 0;
  let lastError = "unknown";
  report("generating");
  for (const { persona, id } of stale) {
    try {
      await reRenderPhrase(persona, id); // records the new hash locally too
      done++;
      consecutiveFailures = 0;
      report("generating");
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      consecutiveFailures++;
      if (consecutiveFailures >= 3) {
        report(
          "error",
          `Voice rendering stopped after 3 straight failures — last error: ${lastError}`
        );
        return;
      }
    }
  }
  report("done");
}

/**
 * Render every phrase that lacks audio, one at a time. Reports progress.
 * Pass a persona to fill only that persona's gaps (e.g. a newly added coach)
 * without touching anything already rendered.
 */
export async function renderMissingPhrases(
  onProgress: (p: GenerationProgress) => void,
  only?: PersonaId
): Promise<void> {
  const report = (state: GenerationProgress["state"], message?: string) =>
    onProgress({
      state,
      done: countKnown(only),
      total: allPhrasesAllPersonas(only).length,
      message,
    });

  const missing = allPhrasesAllPersonas(only).filter(
    ({ persona, id }) => !urls.has(key(persona, id))
  );
  if (missing.length === 0) {
    report("done");
    return;
  }
  if (!flags.canRender) {
    report("unavailable", unavailableReason());
    return;
  }

  // Sequential: ElevenLabs concurrency limits are low, and per-phrase progress
  // is exactly what the UI wants.
  let consecutiveFailures = 0;
  let lastError = "unknown";
  report("generating");
  for (const { persona, id } of missing) {
    try {
      const res = await fetch("/api/library/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona, id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data: { url: string } = await res.json();
      // Same ?v= versioning as the manifest load — a re-render must become a
      // new URL for the shell's disk cache and the CDN alike.
      urls.set(key(persona, id), `${data.url}?v=${Math.floor(Date.now() / 1000)}`);
      renderedAt.set(key(persona, id), new Date().toISOString());
      consecutiveFailures = 0;
      report("generating");
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      consecutiveFailures++;
      if (consecutiveFailures >= 3) {
        report(
          "error",
          `Voice rendering stopped after 3 straight failures — last error: ${lastError}`
        );
        return;
      }
    }
  }
  report("done");
}

export function getVoiceSpeed(persona: PersonaId): number {
  return voiceSpeeds[persona];
}

/** Playback level for this persona, 0.4–2. Above 1 the native player amplifies. */
export function getVoiceVolume(persona: PersonaId): number {
  return voiceVolumes[persona];
}

/** Admin: persist a new voice speed server-side. Takes effect on future renders. */
export async function saveVoiceSpeed(persona: PersonaId, speed: number): Promise<void> {
  await saveVoiceSetting(persona, { speed });
  voiceSpeeds[persona] = speed;
}

/** Admin: persist a playback level. Applies on the next run, no re-render. */
export async function saveVoiceVolume(persona: PersonaId, volume: number): Promise<void> {
  await saveVoiceSetting(persona, { volume });
  voiceVolumes[persona] = volume;
}

async function saveVoiceSetting(
  persona: PersonaId,
  patch: { speed?: number; volume?: number }
): Promise<void> {
  const res = await fetch("/api/library/voice-settings", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminPinHeaders() },
    body: JSON.stringify({ persona, ...patch }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `save failed (${res.status})`);
  }
}

/**
 * Force re-render every phrase for one persona — used after its ElevenLabs
 * voice ID (or speed) changes. Overwrites blob audio; URLs get a cache-buster
 * so the new voice plays immediately despite long-lived browser caching.
 * `skipPromoted` leaves studio-promoted actor recordings untouched — the mode
 * for refreshing TTS audio on a persona that has a real actor.
 */
export async function reRenderPersona(
  persona: PersonaId,
  onProgress: (p: GenerationProgress) => void,
  opts?: { skipPromoted?: boolean }
): Promise<void> {
  const pool = allPhrasesFor(persona).filter(
    (p) => !(opts?.skipPromoted && promoted.has(key(persona, p.id)))
  );
  const report = (state: GenerationProgress["state"], done: number, message?: string) =>
    onProgress({ state, done, total: pool.length, message });

  if (!flags.canRender) {
    report("unavailable", 0, unavailableReason());
    return;
  }
  let done = 0;
  let consecutiveFailures = 0;
  let lastError = "unknown";
  report("generating", 0);
  for (const phrase of pool) {
    try {
      const res = await fetch("/api/library/render", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...adminPinHeaders() },
        body: JSON.stringify({ persona, id: phrase.id, force: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data: { url: string } = await res.json();
      urls.set(key(persona, phrase.id), `${data.url}?v=${Date.now()}`);
      renderedAt.set(key(persona, phrase.id), new Date().toISOString());
      promoted.delete(key(persona, phrase.id)); // now TTS again
      consecutiveFailures = 0;
      done++;
      report("generating", done);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      consecutiveFailures++;
      if (consecutiveFailures >= 3) {
        report(
          "error",
          done,
          `Re-rendering stopped after 3 straight failures — last error: ${lastError}`
        );
        return;
      }
    }
  }
  report("done", done);
}

/**
 * Force one phrase to be re-rendered — for when its wording changed but its id
 * did not, which the "render missing" pass would otherwise skip entirely
 * because a file already exists at that path.
 */
export async function reRenderPhrase(persona: PersonaId, id: string): Promise<void> {
  const res = await fetch("/api/library/render", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminPinHeaders() },
    body: JSON.stringify({ persona, id, force: true }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `render failed (${res.status})`);
  }
  const data: { url: string } = await res.json();
  // Cache-buster: the blob path is unchanged, so the browser would happily
  // keep serving the old audio.
  urls.set(key(persona, id), `${data.url}?v=${Date.now()}`);
  renderedAt.set(key(persona, id), new Date().toISOString());
  promoted.delete(key(persona, id)); // now TTS again
  // Mirror the hash the server just recorded, so the row stops reading as
  // stale without waiting for a status refetch.
  const text = allPhrasesFor(persona).find((p) => p.id === id)?.text;
  if (text !== undefined) renderHashes[persona][id] = phraseHash(text);
}

let autoStarted = false;

/** App-launch hook: load state, then top up the library automatically. */
export async function ensureVoiceLibrary(
  onProgress: (p: GenerationProgress) => void
): Promise<void> {
  if (autoStarted) return;
  autoStarted = true;
  onProgress({ state: "checking", done: 0, total: 0 });
  await loadLibraryState();
  await renderMissingPhrases(onProgress);
}

/**
 * Ask the server for `count` brand-new AI-written phrases, then render them.
 * Pass a category to top up just that bank rather than a spread.
 */
export async function expandLibrary(
  persona: PersonaId,
  count: number,
  onProgress: (p: GenerationProgress) => void,
  category?: PhraseCategory
): Promise<Phrase[]> {
  const res = await fetch("/api/library/expand", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminPinHeaders() },
    body: JSON.stringify({ persona, count, category }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `expand failed (${res.status})`);
  }
  const data: { phrases: Phrase[] } = await res.json();
  extras[persona] = [...extras[persona], ...data.phrases];
  await renderMissingPhrases(onProgress);
  return data.phrases;
}

// ---- Lifetime play stats (persisted across runs) ----

export type ServeKind = "prerendered" | "live" | "synth";
const LIFETIME_KEY = "runbuddy-lifetime-plays";

export function recordLifetimePlay(kind: ServeKind) {
  try {
    const cur = JSON.parse(localStorage.getItem(LIFETIME_KEY) ?? "{}");
    cur[kind] = (cur[kind] ?? 0) + 1;
    localStorage.setItem(LIFETIME_KEY, JSON.stringify(cur));
  } catch {
    /* private mode etc. */
  }
}

export function lifetimeStats(): Record<ServeKind, number> {
  try {
    const cur = JSON.parse(localStorage.getItem(LIFETIME_KEY) ?? "{}");
    return { prerendered: cur.prerendered ?? 0, live: cur.live ?? 0, synth: cur.synth ?? 0 };
  } catch {
    return { prerendered: 0, live: 0, synth: 0 };
  }
}

// One shared element for previews, so starting a new one stops the last.
let previewAudio: HTMLAudioElement | null = null;

export function stopPreview() {
  if (previewAudio) {
    previewAudio.pause();
    previewAudio.currentTime = 0;
  }
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

/** Preview a phrase: the pre-rendered ElevenLabs audio if we have it, else synth. */
export function playPhrase(persona: Persona, phrase: Phrase) {
  stopPreview();
  const url = getPhraseUrl(persona.id, phrase.id);
  if (url) {
    if (!previewAudio) previewAudio = new Audio();
    previewAudio.volume = Math.min(1, voiceVolumes[persona.id]); // levels >1 are native-only
    previewAudio.src = url;
    void previewAudio.play().catch(() => speakFallback(persona, phrase.text));
  } else {
    speakFallback(persona, phrase.text);
  }
}

/**
 * A sample line for auditioning a persona — prefers one that already has
 * rendered audio, so the preview is the real voice rather than the robotic
 * on-device fallback.
 */
export function pickSamplePhrase(persona: PersonaId): Phrase | null {
  const pool = allPhrasesFor(persona, "encourage");
  if (pool.length === 0) return null;
  const rendered = pool.filter((p) => urls.has(key(persona, p.id)));
  const source = rendered.length > 0 ? rendered : pool;
  return source[Math.floor(Math.random() * source.length)];
}

/** Does this persona have any pre-rendered audio at all? */
export function hasRenderedAudio(persona: PersonaId): boolean {
  return renderedCount(persona) > 0;
}

function speakFallback(persona: Persona, text: string) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = persona.tts.rate;
  u.pitch = persona.tts.pitch;
  u.lang = persona.tts.lang;
  window.speechSynthesis.speak(u);
}
