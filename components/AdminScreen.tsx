"use client";

import { useEffect, useState } from "react";
import { PERSONAS, PERSONA_LIST } from "@/lib/personas";
import {
  adminPinHeaders,
  allPhrasesFor,
  expandLibrary,
  getPhraseUrl,
  getPhraseRenderedAt,
  getVoiceSpeed,
  getVoiceVolume,
  libraryFlags,
  lifetimeStats,
  loadLibraryState,
  playPhrase,
  reRenderPersona,
  renderMissingPhrases,
  reRenderPhrase,
  reRenderStale,
  renderedCount,
  isPhraseStale,
  stalePhrases,
  saveVoiceSpeed,
  saveVoiceVolume,
  storeAdminPin,
  type GenerationProgress,
} from "@/lib/voiceLibrary";
import { EXPANDABLE_CATEGORIES, FIXED_CATEGORY_REASON } from "@/lib/phraseCategories";
import type { PersonaId, PhraseCategory } from "@/lib/types";

const CATEGORY_LABELS: Record<PhraseCategory, string> = {
  intro: "Start-line intros",
  start: "Run starts",
  encourage: "Encouragement",
  pace_up: "Pace up (too slow)",
  pace_down: "Pace down (flying)",
  milestone: "Km milestones (generic)",
  km_marker: "Km markers (one per km)",
  pace_lead: "Pace lead-ins",
  anecdote: "Anecdotes & facts",
  finish: "Finishes",
  paused: "Paused",
  resumed: "Resumed",
  conditional: "Weather & time-of-day openers",
  countdown: "Delayed start countdown",
  auto_paused: "Auto-pause announcements",
  auto_resumed: "Auto-resume announcements",
  loitering: "Standing around too long",
  chat: "Chat replies",
  summary: "Run summaries",
  progress: "Target progress (generic)",
  progress_km: "Distance-target checkpoints",
  progress_time: "Time-target checkpoints",
  target_hit: "Target reached",
};

const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as PhraseCategory[];

/** Phrases written per tap. Small enough to judge the results before adding more. */
const EXPAND_BATCH = 5;

interface Props {
  onBack: () => void;
}

export default function AdminScreen({ onBack }: Props) {
  const [lock, setLock] = useState<"checking" | "locked" | "unlocked">("checking");
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);
  const [personaId, setPersonaId] = useState<PersonaId>("ahbeng");
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [expanding, setExpanding] = useState<PhraseCategory | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [speeds, setSpeeds] = useState<Record<PersonaId, number>>(
    () =>
      Object.fromEntries(
        PERSONA_LIST.map((p) => [p.id, p.elevenLabsSpeed])
      ) as Record<PersonaId, number>
  );
  const [savingSpeed, setSavingSpeed] = useState<PersonaId | null>(null);
  const [volumes, setVolumes] = useState<Record<PersonaId, number>>(
    () =>
      Object.fromEntries(PERSONA_LIST.map((p) => [p.id, p.playbackVolume])) as Record<
        PersonaId,
        number
      >
  );
  const [savingVolume, setSavingVolume] = useState<PersonaId | null>(null);
  const [redoing, setRedoing] = useState<string | null>(null);
  const [, bump] = useState(0); // re-render as the registry mutates
  const refresh = () => bump((n) => n + 1);

  useEffect(() => {
    // PIN gate: no ADMIN_PIN on the server → open; else try the session's
    // stored pin, else ask.
    void (async () => {
      try {
        const res = await fetch("/api/admin/verify");
        const { required } = await res.json();
        if (!required) return setLock("unlocked");
        const stored = adminPinHeaders()["x-admin-pin"];
        if (stored) {
          const check = await fetch("/api/admin/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pin: stored }),
          });
          if (check.ok) return setLock("unlocked");
        }
        setLock("locked");
      } catch {
        setLock("locked");
      }
    })();
    void loadLibraryState(true).then(() => {
      setReady(true);
      setSpeeds(
        Object.fromEntries(PERSONA_LIST.map((p) => [p.id, getVoiceSpeed(p.id)])) as Record<
          PersonaId,
          number
        >
      );
      setVolumes(
        Object.fromEntries(PERSONA_LIST.map((p) => [p.id, getVoiceVolume(p.id)])) as Record<
          PersonaId,
          number
        >
      );
      refresh();
    });
  }, []);

  const onSaveSpeed = async (id: PersonaId) => {
    setSavingSpeed(id);
    setNotice(null);
    try {
      await saveVoiceSpeed(id, speeds[id]);
      setNotice(
        `✓ ${PERSONAS[id].name} voice speed saved (${speeds[id].toFixed(2)}×). ` +
          "Re-render to apply it to existing audio."
      );
    } catch (err) {
      setNotice(`⚠ ${err instanceof Error ? err.message : "save failed"}`);
    } finally {
      setSavingSpeed(null);
    }
  };

  const onSaveVolume = async (id: PersonaId) => {
    setSavingVolume(id);
    setNotice(null);
    try {
      await saveVoiceVolume(id, volumes[id]);
      setNotice(
        `✓ ${PERSONAS[id].name} level saved (${Math.round(volumes[id] * 100)}%). ` +
          "Applies on your next run — no re-render needed."
      );
    } catch (err) {
      setNotice(`⚠ ${err instanceof Error ? err.message : "save failed"}`);
    } finally {
      setSavingVolume(null);
    }
  };

  // Re-render a single phrase, for wording that changed after it was voiced.
  const onRedoPhrase = async (id: string) => {
    setRedoing(id);
    setNotice(null);
    try {
      await reRenderPhrase(personaId, id);
      setNotice(`✓ Re-rendered ${id}`);
    } catch (err) {
      setNotice(`⚠ ${err instanceof Error ? err.message : "render failed"}`);
    } finally {
      setRedoing(null);
      refresh();
    }
  };

  const submitPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError(false);
    const res = await fetch("/api/admin/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: pinInput }),
    });
    if (res.ok) {
      storeAdminPin(pinInput);
      setLock("unlocked");
    } else {
      setPinError(true);
      setPinInput("");
    }
  };

  const flags = libraryFlags();
  const persona = PERSONAS[personaId];
  const phrases = allPhrasesFor(personaId);
  const life = lifetimeStats();
  const lifeTotal = life.prerendered + life.live + life.synth;
  const hitRate = lifeTotal > 0 ? Math.round((life.prerendered / lifeTotal) * 100) : null;
  const busy =
    expanding !== null || progress?.state === "generating" || progress?.state === "checking";

  const onRenderMissing = async (only?: PersonaId) => {
    setNotice(null);
    await renderMissingPhrases((p) => {
      setProgress(p);
      refresh();
    }, only);
    refresh();
  };

  const onReRender = async () => {
    const count = allPhrasesFor(personaId).length;
    if (
      !window.confirm(
        `Re-render ALL ${count} ${persona.name} phrases with the current voice? ` +
          "This overwrites existing audio and spends ElevenLabs credits."
      )
    )
      return;
    setNotice(null);
    await reRenderPersona(personaId, (p) => {
      setProgress(p);
      refresh();
    });
    refresh();
  };

  // Phrases whose wording was edited after they were voiced — the file exists,
  // so "render missing" skips them and the old audio would play forever.
  const staleHere = stalePhrases(personaId);
  const staleAll = stalePhrases();

  const onRenderStale = async (only?: PersonaId) => {
    const list = stalePhrases(only);
    if (
      !window.confirm(
        `Re-render ${list.length} outdated phrase${list.length === 1 ? "" : "s"}` +
          `${only ? ` for ${persona.name}` : " across all trainers"}? ` +
          "This spends ElevenLabs credits."
      )
    )
      return;
    setNotice(null);
    await reRenderStale((p) => {
      setProgress(p);
      refresh();
    }, only);
    refresh();
  };

  const onExpandCategory = async (cat: PhraseCategory) => {
    setNotice(null);
    setExpanding(cat);
    try {
      const fresh = await expandLibrary(
        personaId,
        EXPAND_BATCH,
        (p) => {
          setProgress(p);
          refresh();
        },
        cat
      );
      setNotice(
        `✓ Added ${fresh.length} new ${persona.shortName} "${CATEGORY_LABELS[cat]}" phrases`
      );
    } catch (err) {
      setNotice(`⚠ ${err instanceof Error ? err.message : "generation failed"}`);
    } finally {
      setExpanding(null);
      refresh();
    }
  };

  if (lock !== "unlocked") {
    return (
      <div className="fade-in">
        <div className="admin-topbar">
          <button className="back-link" onClick={onBack}>
            ‹ Back
          </button>
          <h1 className="admin-title">Admin</h1>
        </div>
        {lock === "checking" ? (
          <div className="admin-notice">Checking access…</div>
        ) : (
          <form className="card pin-gate" onSubmit={submitPin}>
            <div className="pin-emoji">🔒</div>
            <div className="pin-title">Enter admin PIN</div>
            <input
              className="pin-input"
              type="password"
              inputMode="numeric"
              autoFocus
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              placeholder="PIN"
            />
            {pinError && <div className="admin-notice bad">Wrong PIN — try again</div>}
            <button className="cta" type="submit" disabled={pinInput.length === 0}>
              Unlock
            </button>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div className="admin-topbar">
        <button className="back-link" onClick={onBack}>
          ‹ Back
        </button>
        <h1 className="admin-title">Admin</h1>
      </div>

      <div className="section-header">Server Config</div>
      <div className="card config-card">
        <div className={`config-row ${flags.elevenlabs ? "ok" : "bad"}`}>
          {flags.elevenlabs ? "✓" : "✕"} ElevenLabs API key
        </div>
        <div className={`config-row ${flags.blob ? "ok" : "bad"}`}>
          {flags.blob ? "✓" : "✕"} Vercel Blob store
          {!flags.blob && (
            <span className="config-hint">Storage → Create Database → Blob, then redeploy</span>
          )}
        </div>
        {!flags.statusReached && (
          <div className="config-row bad">✕ Server unreachable (running without API routes?)</div>
        )}
      </div>

      <div className="section-header">Persona</div>
      <div className="segmented compact">
        {PERSONA_LIST.map((p) => (
          <button
            key={p.id}
            className={personaId === p.id ? "active" : ""}
            onClick={() => setPersonaId(p.id)}
          >
            {p.emoji}
            <br />
            {p.shortName}
          </button>
        ))}
      </div>

      <div className="section-header">Voice Library</div>
      <div className="card" style={{ padding: 14 }}>
        <div className="admin-lib-stats">
          {PERSONA_LIST.map((p) => {
            const done = renderedCount(p.id);
            const total = allPhrasesFor(p.id).length;
            return (
              <span key={p.id} className={done === total ? "full" : done === 0 ? "empty" : ""}>
                {p.emoji} {done}/{total}
              </span>
            );
          })}
        </div>
        {staleAll.length > 0 && (
          <div className="stale-banner">
            <div className="stale-head">
              ⚠ {staleAll.length} phrase{staleAll.length === 1 ? "" : "s"} reworded since
              {staleAll.length === 1 ? " it was" : " they were"} voiced
            </div>
            <div className="stale-sub">
              The audio still says the old words. Look for the “old” tag in the phrase list
              below.
            </div>
            {staleHere.length > 0 && (
              <button
                className="cta"
                style={{ marginTop: 10 }}
                disabled={busy}
                onClick={() => onRenderStale(personaId)}
              >
                Re-render {staleHere.length} outdated {persona.shortName} phrase
                {staleHere.length === 1 ? "" : "s"}
              </button>
            )}
            {staleAll.length > staleHere.length && (
              <button
                className="cta secondary"
                style={{ marginTop: 10 }}
                disabled={busy}
                onClick={() => onRenderStale()}
              >
                Re-render all {staleAll.length} outdated — every trainer
              </button>
            )}
          </div>
        )}
        <button
          className="cta"
          style={{ marginTop: 12 }}
          disabled={busy}
          onClick={() => onRenderMissing(personaId)}
        >
          {progress?.state === "generating"
            ? `Rendering… ${progress.done}/${progress.total}`
            : `Render missing ${persona.shortName} phrases`}
        </button>
        <button
          className="cta secondary"
          style={{ marginTop: 10 }}
          disabled={busy}
          onClick={() => onRenderMissing()}
        >
          Render missing — all personas
        </button>
        <button
          className="cta secondary"
          style={{ marginTop: 10 }}
          disabled={busy}
          onClick={onReRender}
        >
          Re-render ALL {persona.shortName} phrases (voice changed)
        </button>
        {progress?.state === "generating" && (
          <div className="gen-bar" style={{ marginTop: 12 }}>
            <div
              className="gen-bar-fill"
              style={{
                width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%`,
              }}
            />
          </div>
        )}
        {progress?.state === "done" && (
          <div className="admin-notice ok">✓ Library fully rendered</div>
        )}
        {(progress?.state === "error" || progress?.state === "unavailable") && (
          <div className="admin-notice bad">⚠ {progress.message}</div>
        )}
        {notice && (
          <div className={`admin-notice ${notice.startsWith("✓") ? "ok" : "bad"}`}>{notice}</div>
        )}
      </div>

      <div className="section-header">Voice Speed</div>
      <div className="card" style={{ padding: "6px 14px" }}>
        {PERSONA_LIST.map((p) => (
          <div className="speed-row" key={p.id}>
            <span className="speed-name">
              {p.emoji} {p.shortName}
            </span>
            <input
              type="range"
              min={0.7}
              max={1.2}
              step={0.05}
              value={speeds[p.id]}
              onChange={(e) =>
                setSpeeds((s) => ({ ...s, [p.id]: Number(e.target.value) }))
              }
            />
            <span className="speed-value">{speeds[p.id].toFixed(2)}×</span>
            <button
              className="open-pill"
              disabled={savingSpeed !== null || speeds[p.id] === getVoiceSpeed(p.id)}
              onClick={() => onSaveSpeed(p.id)}
            >
              {savingSpeed === p.id ? "…" : "Save"}
            </button>
          </div>
        ))}
        <div className="gen-hint" style={{ padding: "2px 0 10px" }}>
          1.00× is the voice&apos;s natural pace; 1.20× is ElevenLabs&apos; max. Saved speed
          applies to live phrases immediately — hit Re-render to redo existing audio.
        </div>

        <div className="section-header" style={{ marginTop: 6 }}>
          Playback level
        </div>
        {PERSONA_LIST.map((p) => (
          <div className="speed-row" key={p.id}>
            <span className="speed-name">
              {p.emoji} {p.shortName}
            </span>
            <input
              type="range"
              min={0.4}
              max={1}
              step={0.05}
              value={volumes[p.id]}
              onChange={(e) =>
                setVolumes((v) => ({ ...v, [p.id]: Number(e.target.value) }))
              }
            />
            <span className="speed-value">{Math.round(volumes[p.id] * 100)}%</span>
            <button
              className="open-pill"
              disabled={savingVolume !== null || volumes[p.id] === getVoiceVolume(p.id)}
              onClick={() => onSaveVolume(p.id)}
            >
              {savingVolume === p.id ? "…" : "Save"}
            </button>
          </div>
        ))}
        <div className="gen-hint" style={{ padding: "2px 0 10px" }}>
          Every voice ships at 100%. An audio element can&apos;t play above that, so this can
          only pull a voice down — useful if one ever renders hot. Applies on your next run,
          no re-render needed.
        </div>
      </div>

      <div className="section-header">Lifetime Stats</div>
      <div className="stat-grid">
        <div className="stat-cell">
          <div className="stat-value">{lifeTotal}</div>
          <div className="stat-label">Lines spoken</div>
        </div>
        <div className="stat-cell">
          <div className="stat-value">{hitRate === null ? "—" : `${hitRate}%`}</div>
          <div className="stat-label">Pre-rendered hit rate</div>
        </div>
        <div className="stat-cell">
          <div className="stat-value">{life.live}</div>
          <div className="stat-label">Improvised (AI)</div>
        </div>
        <div className="stat-cell">
          <div className="stat-value">{life.synth}</div>
          <div className="stat-label">Robo-voice fallback</div>
        </div>
      </div>

      <div className="section-header">
        {persona.emoji} {persona.name} — {phrases.length} phrases
      </div>

      {!ready && <div className="admin-notice">Loading library…</div>}

      {CATEGORY_ORDER.map((cat) => {
        const pool = phrases.filter((p) => p.category === cat);
        if (pool.length === 0) return null;
        return (
          <div key={cat}>
            <div className="section-header cat-header">
              <span>
                {CATEGORY_LABELS[cat]} · {pool.length}
              </span>
              {EXPANDABLE_CATEGORIES.includes(cat) ? (
                <button
                  className="cat-add"
                  disabled={busy}
                  onClick={() => onExpandCategory(cat)}
                >
                  {expanding === cat ? "writing…" : `+ ${EXPAND_BATCH} new`}
                </button>
              ) : (
                <span className="cat-fixed" title={FIXED_CATEGORY_REASON[cat]}>
                  fixed set
                </span>
              )}
            </div>
            <div className="card">
              {pool.map((phrase) => {
                const rendered = !!getPhraseUrl(personaId, phrase.id);
                const recordedAt = getPhraseRenderedAt(personaId, phrase.id);
                const isAI = phrase.id.startsWith("xg-");
                const stale = isPhraseStale(personaId, phrase.id);
                return (
                  <div className={`phrase-row${stale ? " stale" : ""}`} key={phrase.id}>
                    <button
                      className="phrase-play"
                      aria-label="Play phrase"
                      onClick={() => playPhrase(persona, phrase)}
                    >
                      ▶
                    </button>
                    <span className="phrase-text">{phrase.text}</span>
                    <span className={`phrase-badge ${rendered ? "ok" : ""}`}>
                      {rendered ? "MP3" : "TTS"}
                    </span>
                    {recordedAt && (
                      <span className="phrase-date" title={recordedAt.toLocaleString()}>
                        {recordedAt.toLocaleDateString(undefined, {
                          day: "numeric",
                          month: "short",
                          year: "2-digit",
                        })}
                      </span>
                    )}
                    {isAI && <span className="phrase-badge ai">AI</span>}
                    {stale && (
                      <span
                        className="phrase-badge stale"
                        title="The wording changed after this was voiced — the MP3 still says the old line"
                      >
                        old
                      </span>
                    )}
                    <button
                      className={`phrase-redo${stale ? " urgent" : ""}`}
                      aria-label="Re-render this phrase"
                      title="Re-render just this phrase"
                      disabled={busy || redoing !== null}
                      onClick={() => onRedoPhrase(phrase.id)}
                    >
                      {redoing === phrase.id ? "…" : "↻"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div style={{ height: 32 }} />
    </div>
  );
}
