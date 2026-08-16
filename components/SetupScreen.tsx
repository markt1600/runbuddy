"use client";

import { PERSONA_LIST, PERSONAS } from "@/lib/personas";
import { phrasesFor } from "@/lib/phrases";
import type { GenerationProgress } from "@/lib/voiceLibrary";
import type { MusicSource, PersonaId } from "@/lib/types";

const MUSIC_META: Record<
  Exclude<MusicSource, "none">,
  { icon: string; className: string; title: string; sub: string; link: string }
> = {
  spotify: {
    icon: "♫",
    className: "spotify",
    title: "Spotify",
    sub: "Opens the Spotify app — your buddy talks over the music",
    link: "spotify://",
  },
  "apple-podcasts": {
    icon: "🎙",
    className: "podcasts",
    title: "Apple Podcasts",
    sub: "Opens Podcasts — your buddy talks over the show",
    link: "podcasts://",
  },
};

interface Props {
  personaId: PersonaId;
  onPersonaChange: (id: PersonaId) => void;
  music: MusicSource;
  onMusicChange: (m: MusicSource) => void;
  onStart: () => void;
  onAdmin: () => void;
  genProgress: GenerationProgress | null;
}

function VoiceLibraryBanner({ progress }: { progress: GenerationProgress | null }) {
  if (!progress) return null;
  if (progress.state === "generating" || progress.state === "checking") {
    const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <div className="gen-banner">
        <div className="gen-row">
          <span className="gen-spinner" />
          <span className="gen-text">
            {progress.state === "checking"
              ? "Checking voice library…"
              : `Generating voice library… ${progress.done}/${progress.total}`}
          </span>
          <span className="gen-pct">{progress.state === "generating" ? `${pct}%` : ""}</span>
        </div>
        <div className="gen-bar">
          <div className="gen-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="gen-hint">
          One-time setup — voices are rendered with ElevenLabs and saved forever.
          You can start running now; phrases upgrade from robo-voice as they finish.
        </div>
      </div>
    );
  }
  if (progress.state === "done") {
    return (
      <div className="gen-banner gen-done">
        <div className="gen-row">
          <span className="gen-text">
            ✓ Voice library ready — {progress.total} phrases rendered
          </span>
        </div>
      </div>
    );
  }
  if (progress.state === "error") {
    return (
      <div className="gen-banner gen-error">
        <div className="gen-row">
          <span className="gen-text">⚠ {progress.message}</span>
        </div>
      </div>
    );
  }
  if (progress.state === "unavailable" && progress.message) {
    return (
      <div className="gen-banner gen-error">
        <div className="gen-row">
          <span className="gen-text">🔇 {progress.message}</span>
        </div>
      </div>
    );
  }
  return null;
}

export default function SetupScreen({
  personaId,
  onPersonaChange,
  music,
  onMusicChange,
  onStart,
  onAdmin,
  genProgress,
}: Props) {
  const previewVoice = (id: PersonaId, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const p = PERSONAS[id];
    const pool = phrasesFor(id, "encourage");
    const sample = pool[Math.floor(Math.random() * pool.length)];
    const u = new SpeechSynthesisUtterance(sample.text);
    u.rate = p.tts.rate;
    u.pitch = p.tts.pitch;
    u.lang = p.tts.lang;
    window.speechSynthesis.speak(u);
  };

  const musicMeta = music !== "none" ? MUSIC_META[music] : null;

  return (
    <div className="fade-in">
      <h1 className="large-title">Run Buddy</h1>
      <p className="subtitle">Pick your trainer. Press start. Get talked at.</p>

      <VoiceLibraryBanner progress={genProgress} />

      <div className="section-header">Your Run Buddy</div>
      {PERSONA_LIST.map((p) => (
        <button
          key={p.id}
          className={`persona-card${p.id === personaId ? " selected" : ""}`}
          style={{ "--accent": p.accent } as React.CSSProperties}
          onClick={() => onPersonaChange(p.id)}
        >
          <span className="persona-avatar">{p.emoji}</span>
          <span>
            <div className="persona-name">{p.name}</div>
            <div className="persona-tagline">{p.tagline}</div>
          </span>
          <span
            className="preview-btn"
            role="button"
            aria-label={`Preview ${p.name}'s voice`}
            onClick={(e) => previewVoice(p.id, e)}
            style={{ display: "grid", placeItems: "center" }}
          >
            ▶
          </span>
          <span className="persona-check">{p.id === personaId ? "✓" : ""}</span>
        </button>
      ))}

      <div className="section-header">Background Audio</div>
      <div className="segmented">
        {(["spotify", "apple-podcasts", "none"] as MusicSource[]).map((m) => (
          <button
            key={m}
            className={music === m ? "active" : ""}
            onClick={() => onMusicChange(m)}
          >
            {m === "spotify" ? "Spotify" : m === "apple-podcasts" ? "Podcasts" : "None"}
          </button>
        ))}
      </div>

      {musicMeta && (
        <div className="card music-widget" style={{ marginTop: 10 }}>
          <span className={`music-icon ${musicMeta.className}`}>{musicMeta.icon}</span>
          <span className="music-meta">
            <div className="music-title">{musicMeta.title}</div>
            <div className="music-sub">{musicMeta.sub}</div>
          </span>
          <a className="open-pill" href={musicMeta.link}>
            Open
          </a>
        </div>
      )}

      <div className="section-header">Before You Go</div>
      <div className="card" style={{ padding: "12px 16px", fontSize: 13, color: "var(--label-2)", lineHeight: 1.5 }}>
        Start your music first, then hit Start Run — the voice mixes over it.
        Flip your ringer switch ON so you can hear your buddy. Keep the screen
        on (we&apos;ll dim it into a runner-friendly always-on mode).
      </div>

      <div className="footer-cta">
        <button className="cta" onClick={onStart}>
          Start Run
        </button>
        <button className="admin-link" onClick={onAdmin}>
          ⚙ Admin
        </button>
      </div>
    </div>
  );
}
