"use client";

import { PERSONA_LIST, PERSONAS } from "@/lib/personas";
import { phrasesFor } from "@/lib/phrases";
import {
  CHATTINESS_MAX,
  CHATTINESS_MIN,
  TARGET_OPTIONS,
  chattinessLabel,
} from "@/lib/prefs";
import type { SpeedUnit } from "@/lib/units";
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
  "apple-music": {
    icon: "♪",
    className: "applemusic",
    title: "Apple Music",
    sub: "Opens Music — your buddy talks over the tunes",
    link: "music://",
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
  speedUnit: SpeedUnit;
  onSpeedUnitChange: (u: SpeedUnit) => void;
  chattiness: number;
  onChattinessChange: (v: number) => void;
  targetKm: number;
  onTargetKmChange: (v: number) => void;
}

export default function SetupScreen({
  personaId,
  onPersonaChange,
  music,
  onMusicChange,
  onStart,
  onAdmin,
  speedUnit,
  onSpeedUnitChange,
  chattiness,
  onChattinessChange,
  targetKm,
  onTargetKmChange,
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
        {(["spotify", "apple-music", "apple-podcasts", "none"] as MusicSource[]).map((m) => (
          <button
            key={m}
            className={music === m ? "active" : ""}
            onClick={() => onMusicChange(m)}
          >
            {m === "spotify"
              ? "Spotify"
              : m === "apple-music"
                ? "Music"
                : m === "apple-podcasts"
                  ? "Podcasts"
                  : "None"}
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

      <div className="section-header">Speed Display</div>
      <div className="segmented">
        <button
          className={speedUnit === "kmh" ? "active" : ""}
          onClick={() => onSpeedUnitChange("kmh")}
        >
          km/h
        </button>
        <button
          className={speedUnit === "minkm" ? "active" : ""}
          onClick={() => onSpeedUnitChange("minkm")}
        >
          min/km
        </button>
      </div>

      <div className="section-header">Target Distance</div>
      <div className="card" style={{ padding: "14px 16px" }}>
        <div className="target-value">
          {targetKm === 0 ? (
            <span className="target-off">No target</span>
          ) : (
            <>
              {targetKm}
              <span className="target-unit"> km</span>
            </>
          )}
        </div>
        <input
          className="target-slider"
          type="range"
          min={0}
          max={TARGET_OPTIONS.length - 1}
          step={1}
          value={Math.max(0, TARGET_OPTIONS.indexOf(targetKm as (typeof TARGET_OPTIONS)[number]))}
          onChange={(e) => onTargetKmChange(TARGET_OPTIONS[Number(e.target.value)])}
        />
        <div className="target-ticks">
          {TARGET_OPTIONS.map((km) => (
            <span key={km} className={km === targetKm ? "on" : ""}>
              {km === 0 ? "NA" : km}
            </span>
          ))}
        </div>
        <div className="chatter-label">
          {targetKm === 0
            ? "Run as long as you like — no distance goal."
            : `Your buddy will call out 10%, a quarter, a third, halfway, two thirds, three quarters and 90% — then talk you through the run-in to ${targetKm} km.`}
        </div>
      </div>

      <div className="section-header">Coach Chatter</div>
      <div className="card" style={{ padding: "12px 16px" }}>
        <div className="chatter-row">
          <span className="chatter-end">Quieter</span>
          <input
            type="range"
            min={CHATTINESS_MIN}
            max={CHATTINESS_MAX}
            step={0.25}
            value={chattiness}
            onChange={(e) => onChattinessChange(Number(e.target.value))}
          />
          <span className="chatter-end">Chattier</span>
        </div>
        <div className="chatter-label">
          {chattinessLabel(chattiness)}
          {chattiness === 1 ? " (default)" : ""} — km markers and pace reactions always
          fire; this tunes how often the in-between talking happens
        </div>
      </div>

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
