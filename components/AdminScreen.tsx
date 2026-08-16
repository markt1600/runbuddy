"use client";

import { useEffect, useState } from "react";
import { PERSONAS, PERSONA_LIST } from "@/lib/personas";
import {
  allPhrasesFor,
  expandLibrary,
  getPhraseUrl,
  libraryFlags,
  lifetimeStats,
  loadLibraryState,
  playPhrase,
  renderMissingPhrases,
  renderedCount,
  type GenerationProgress,
} from "@/lib/voiceLibrary";
import type { PersonaId, PhraseCategory } from "@/lib/types";

const CATEGORY_LABELS: Record<PhraseCategory, string> = {
  intro: "Start-line intros",
  start: "Run starts",
  encourage: "Encouragement",
  pace_up: "Pace up (too slow)",
  pace_down: "Pace down (flying)",
  milestone: "Km milestones",
  anecdote: "Anecdotes & facts",
  finish: "Finishes",
  paused: "Paused",
  resumed: "Resumed",
  chat: "Chat replies",
};

const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as PhraseCategory[];

interface Props {
  onBack: () => void;
}

export default function AdminScreen({ onBack }: Props) {
  const [personaId, setPersonaId] = useState<PersonaId>("ahbeng");
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [expanding, setExpanding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [, bump] = useState(0); // re-render as the registry mutates
  const refresh = () => bump((n) => n + 1);

  useEffect(() => {
    void loadLibraryState(true).then(() => {
      setReady(true);
      refresh();
    });
  }, []);

  const flags = libraryFlags();
  const persona = PERSONAS[personaId];
  const phrases = allPhrasesFor(personaId);
  const life = lifetimeStats();
  const lifeTotal = life.prerendered + life.live + life.synth;
  const hitRate = lifeTotal > 0 ? Math.round((life.prerendered / lifeTotal) * 100) : null;
  const busy = expanding || progress?.state === "generating" || progress?.state === "checking";

  const onRenderMissing = async () => {
    setNotice(null);
    await renderMissingPhrases((p) => {
      setProgress(p);
      refresh();
    });
  };

  const onExpand = async () => {
    setNotice(null);
    setExpanding(true);
    try {
      const fresh = await expandLibrary(personaId, 10, (p) => {
        setProgress(p);
        refresh();
      });
      setNotice(`✓ Added ${fresh.length} fresh ${persona.name} phrases`);
    } catch (err) {
      setNotice(`⚠ ${err instanceof Error ? err.message : "generation failed"}`);
    } finally {
      setExpanding(false);
      refresh();
    }
  };

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

      <div className="section-header">Voice Library</div>
      <div className="card" style={{ padding: 14 }}>
        <div className="admin-lib-stats">
          {PERSONA_LIST.map((p) => (
            <span key={p.id}>
              {p.emoji} {renderedCount(p.id)}/{allPhrasesFor(p.id).length} rendered
            </span>
          ))}
        </div>
        <button className="cta" style={{ marginTop: 12 }} disabled={busy} onClick={onRenderMissing}>
          {progress?.state === "generating"
            ? `Rendering… ${progress.done}/${progress.total}`
            : "Render missing phrases"}
        </button>
        <button
          className="cta secondary"
          style={{ marginTop: 10 }}
          disabled={busy}
          onClick={onExpand}
        >
          {expanding ? "Writing fresh phrases…" : `Generate 10 fresh ${persona.name} phrases`}
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

      <div className="section-header">Phrases</div>
      <div className="segmented">
        {PERSONA_LIST.map((p) => (
          <button
            key={p.id}
            className={personaId === p.id ? "active" : ""}
            onClick={() => setPersonaId(p.id)}
          >
            {p.emoji} {p.name}
          </button>
        ))}
      </div>

      {!ready && <div className="admin-notice">Loading library…</div>}

      {CATEGORY_ORDER.map((cat) => {
        const pool = phrases.filter((p) => p.category === cat);
        if (pool.length === 0) return null;
        return (
          <div key={cat}>
            <div className="section-header">
              {CATEGORY_LABELS[cat]} · {pool.length}
            </div>
            <div className="card">
              {pool.map((phrase) => {
                const rendered = !!getPhraseUrl(personaId, phrase.id);
                const isAI = phrase.id.startsWith("xg-");
                return (
                  <div className="phrase-row" key={phrase.id}>
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
                    {isAI && <span className="phrase-badge ai">AI</span>}
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
