"use client";

import { useEffect, useRef, useState } from "react";
import { PERSONA_LIST, PERSONAS } from "@/lib/personas";
import {
  hasRenderedAudio,
  loadLibraryState,
  pickSamplePhrase,
  playPhrase,
  promotedPhrases,
  renderedUrlsFor,
  stopPreview,
} from "@/lib/voiceLibrary";
import { audioSessionSupported } from "@/lib/audio";
import {
  CHATTINESS_MAX,
  CHATTINESS_MIN,
  START_DELAY_SEC,
  TARGET_OPTIONS,
  TARGET_PACE_OPTIONS,
  TARGET_TIME_OPTIONS,
  chattinessLabel,
  formatTargetPace,
} from "@/lib/prefs";
import { isNativeApp, runBuddyNative } from "@/lib/native";
import type { SpeedUnit } from "@/lib/units";
import type { MusicSource, PersonaId } from "@/lib/types";
import SpotifyTransport from "./SpotifyTransport";

// The setup screen is a trainer picker first: hear a line, pick one, add
// the partner for duo mode. The run settings follow, target and chatter
// first since those change from run to run; the tab bar's pill starts the
// run, as it does everywhere else.

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

/** Duo mode is always these two; the pill lives on whichever isn't picked. */
const DUO_PARTNER: Partial<Record<PersonaId, PersonaId>> = { ahbeng: "ahlian", ahlian: "ahbeng" };

/** A preview that never reports back (a stalled load) shouldn't stick the button. */
const PREVIEW_MAX_MS = 15_000;

interface Props {
  personaId: PersonaId;
  onPersonaChange: (id: PersonaId) => void;
  /** Duo mode: Ah Beng + Ah Lian coach together. Overrides the single pick. */
  duoMode: boolean;
  onDuoChange: (on: boolean) => void;
  music: MusicSource;
  onMusicChange: (m: MusicSource) => void;
  speedUnit: SpeedUnit;
  onSpeedUnitChange: (u: SpeedUnit) => void;
  chattiness: number;
  onChattinessChange: (v: number) => void;
  targetKm: number;
  onTargetKmChange: (v: number) => void;
  targetMin: number;
  onTargetMinChange: (v: number) => void;
  targetPaceSec: number;
  onTargetPaceSecChange: (v: number) => void;
  autoPause: boolean;
  onAutoPauseChange: (on: boolean) => void;
  startDelay: boolean;
  onStartDelayChange: (on: boolean) => void;
}

export default function SetupScreen({
  personaId,
  onPersonaChange,
  duoMode,
  onDuoChange,
  music,
  onMusicChange,

  speedUnit,
  onSpeedUnitChange,
  chattiness,
  onChattinessChange,
  targetKm,
  onTargetKmChange,
  targetMin,
  onTargetMinChange,
  targetPaceSec,
  onTargetPaceSecChange,
  autoPause,
  onAutoPauseChange,
  startDelay,
  onStartDelayChange,
}: Props) {
  const [libraryReady, setLibraryReady] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  /** Which trainer's sample line is playing, for the button's state. */
  const [playing, setPlaying] = useState<PersonaId | null>(null);
  const playTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mode: "none" | "distance" | "time" | "pace" =
    targetMin > 0
      ? "time"
      : targetKm > 0
        ? "distance"
        : targetPaceSec > 0
          ? "pace"
          : "none";
  // Make sure the rendered-audio registry is loaded before anyone taps play —
  // otherwise the preview would fall back to the robotic on-device voice.
  useEffect(() => {
    void loadLibraryState().then(() => setLibraryReady(true));
  }, []);

  // Leaving the screen (Start, another tab) cuts a preview that is mid-line.
  useEffect(
    () => () => {
      stopPreview();
      if (playTimer.current) clearTimeout(playTimer.current);
    },
    []
  );

  // Shell: start pulling the selected persona's voice pack onto disk the
  // moment you're on this screen — not at Start Run — and show how far the
  // download is. Old binaries without cacheStatus just skip the readout.
  const [voicePack, setVoicePack] = useState<{ cached: number; total: number } | null>(null);
  useEffect(() => {
    const native = runBuddyNative();
    if (!native || !libraryReady) {
      setVoicePack(null);
      return;
    }
    let cancelled = false;
    // Duo mode needs both trainers' packs on the phone.
    const urls = duoMode
      ? [...renderedUrlsFor("ahbeng"), ...renderedUrlsFor("ahlian")]
      : renderedUrlsFor(personaId);
    if (urls.length === 0) {
      setVoicePack(null);
      return;
    }
    void native.prefetchAudio({ urls }).catch(() => {});
    const poll = async () => {
      try {
        const status = await native.cacheStatus({ urls });
        if (!cancelled) setVoicePack(status);
        return status;
      } catch {
        return null; // binary predates cacheStatus — prefetch still runs
      }
    };
    void poll();
    const timer = setInterval(() => {
      void poll().then((s) => {
        if (s && s.cached >= s.total) clearInterval(timer);
      });
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [personaId, duoMode, libraryReady]);

  const previewVoice = (id: PersonaId) => {
    if (playTimer.current) clearTimeout(playTimer.current);
    if (playing === id) {
      stopPreview();
      setPlaying(null);
      return;
    }
    const sample = pickSamplePhrase(id);
    if (!sample) return;
    setPlaying(id);
    const done = () => setPlaying((cur) => (cur === id ? null : cur));
    playPhrase(PERSONAS[id], sample, done);
    playTimer.current = setTimeout(done, PREVIEW_MAX_MS);
  };

  const pick = (id: PersonaId) => {
    onDuoChange(false);
    onPersonaChange(id);
  };

  // Duo always runs as Ah Beng with Ah Lian alongside (the app pins the
  // lead), whichever row the pill was tapped on.
  const toggleDuo = () => {
    if (duoMode) {
      onDuoChange(false);
      return;
    }
    onPersonaChange("ahbeng");
    onDuoChange(true);
  };

  const musicMeta = music !== "none" ? MUSIC_META[music] : null;

  // What the folded settings currently say, in one line.
  const moreLine = [
    musicMeta?.title ?? "No music",
    speedUnit === "minkm" ? "min/km" : "km/h",
    startDelay ? `${START_DELAY_SEC} s delay` : null,
    mode !== "time" ? (autoPause ? "Auto-pause" : "No auto-pause") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="fade-in setup">
      <div className="setup-head">
        <h1 className="setup-title">Who&apos;s running with you?</h1>
        <p className="setup-sub">Tap play to hear each one. Add a second for duo mode.</p>
      </div>

      <div className="picker" role="radiogroup" aria-label="Your trainer">
        {PERSONA_LIST.map((p) => {
          const selected = duoMode ? p.id === "ahbeng" || p.id === "ahlian" : p.id === personaId;
          const partner = DUO_PARTNER[p.id];
          // The pill sits on the partner of whoever is picked — or, once duo
          // is on, on Ah Lian's row, where it reads as the thing to undo.
          const duoPill = partner !== undefined && (duoMode ? p.id === "ahlian" : personaId === partner);
          const noAudio = libraryReady && !hasRenderedAudio(p.id);
          const realVoice = libraryReady && promotedPhrases(p.id).length > 0;
          const isPlaying = playing === p.id;
          return (
            <div
              key={p.id}
              className={`persona-card${selected ? " selected" : ""}`}
              style={{ "--persona": p.accent } as React.CSSProperties}
            >
              <button
                className={`pick-play${noAudio ? " no-audio" : ""}${isPlaying ? " playing" : ""}`}
                aria-label={
                  isPlaying
                    ? `Stop ${p.name}'s line`
                    : noAudio
                      ? `Play a line from ${p.name} — no voice rendered yet, using the device voice`
                      : `Play a line from ${p.name}`
                }
                title={noAudio ? "No voice rendered yet — render this persona in Admin" : undefined}
                onClick={() => previewVoice(p.id)}
              >
                {isPlaying ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <rect x="6" y="6" width="12" height="12" rx="1.5" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M8 5l12 7-12 7z" />
                  </svg>
                )}
              </button>
              <button
                className="pick-main"
                role="radio"
                aria-checked={selected}
                onClick={() => pick(p.id)}
              >
                <span className="pick-name-row">
                  <span className="pick-name">{p.name}</span>
                  {realVoice && <span className="pick-badge">Real voice</span>}
                </span>
                <span className="pick-brief">{p.tagline}</span>
              </button>
              {duoPill ? (
                <button
                  className={`pick-duo${duoMode ? " on" : ""}`}
                  aria-pressed={duoMode}
                  onClick={toggleDuo}
                >
                  {duoMode ? "Duo ✓" : "+ Duo"}
                </button>
              ) : selected ? (
                <svg
                  className="pick-check"
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M5 12l5 5L20 7" />
                </svg>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Offline voice-pack progress (shell): every phrase downloaded here
          plays from disk mid-run — dead zones only cost the improvised lines. */}
      {voicePack && (
        <div className="voicepack-line">
          {voicePack.cached >= voicePack.total
            ? `✓ ${duoMode ? "Both trainers' voice packs are" : `${PERSONAS[personaId].shortName}'s voice pack is`} on this phone · ${voicePack.total} phrases`
            : `⬇︎ Downloading ${duoMode ? "both trainers' voice packs" : `${PERSONAS[personaId].shortName}'s voice pack`}… ${voicePack.cached}/${voicePack.total}`}
        </div>
      )}

      <div className="setup-settings">
        <div className="section-header">Target</div>
        <div className="segmented compact">
          <button
            className={mode === "none" ? "active" : ""}
            onClick={() => {
              onTargetKmChange(0);
              onTargetMinChange(0);
              onTargetPaceSecChange(0);
            }}
          >
            None
          </button>
          <button
            className={mode === "distance" ? "active" : ""}
            onClick={() => {
              onTargetMinChange(0);
              onTargetPaceSecChange(0);
              onTargetKmChange(targetKm || 5);
            }}
          >
            Distance
          </button>
          <button
            className={mode === "time" ? "active" : ""}
            onClick={() => {
              onTargetKmChange(0);
              onTargetPaceSecChange(0);
              onTargetMinChange(targetMin || 30);
            }}
          >
            Time
          </button>
          <button
            className={mode === "pace" ? "active" : ""}
            onClick={() => {
              onTargetKmChange(0);
              onTargetMinChange(0);
              onTargetPaceSecChange(targetPaceSec || 360);
            }}
          >
            Pace
          </button>
        </div>

        {mode !== "none" && (
          <div className="card" style={{ padding: "14px 16px", marginTop: 10 }}>
            <div className="target-value">
              {mode === "distance"
                ? targetKm
                : mode === "time"
                  ? targetMin
                  : formatTargetPace(targetPaceSec)}
              <span className="target-unit">
                {mode === "distance" ? " km" : mode === "time" ? " min" : " /km"}
              </span>
            </div>
            {mode === "pace" ? (
              <>
                <input
                  className="target-slider"
                  type="range"
                  min={1}
                  max={TARGET_PACE_OPTIONS.length - 1}
                  step={1}
                  value={Math.max(1, TARGET_PACE_OPTIONS.indexOf(targetPaceSec))}
                  onChange={(e) =>
                    onTargetPaceSecChange(TARGET_PACE_OPTIONS[Number(e.target.value)])
                  }
                />
                {/* Steps are 10s; labelling every one would be soup. The half-
                    minute marks are evenly spaced on the 10s grid, so a plain
                    space-between row still lines up with the track. */}
                <div className="target-ticks pace-ticks">
                  {TARGET_PACE_OPTIONS.slice(1)
                    .filter((sec) => sec % 30 === 0)
                    .map((sec) => (
                      <span key={sec} className={sec === targetPaceSec ? "on" : ""}>
                        {formatTargetPace(sec)}
                      </span>
                    ))}
                </div>
              </>
            ) : mode === "distance" ? (
              <>
                <input
                  className="target-slider"
                  type="range"
                  min={1}
                  max={TARGET_OPTIONS.length - 1}
                  step={1}
                  value={Math.max(
                    1,
                    TARGET_OPTIONS.indexOf(targetKm as (typeof TARGET_OPTIONS)[number])
                  )}
                  onChange={(e) => onTargetKmChange(TARGET_OPTIONS[Number(e.target.value)])}
                />
                <div className="target-ticks">
                  {TARGET_OPTIONS.slice(1).map((km) => (
                    <span key={km} className={km === targetKm ? "on" : ""}>
                      {km}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <>
                <input
                  className="target-slider"
                  type="range"
                  min={1}
                  max={TARGET_TIME_OPTIONS.length - 1}
                  step={1}
                  value={Math.max(
                    1,
                    TARGET_TIME_OPTIONS.indexOf(
                      targetMin as (typeof TARGET_TIME_OPTIONS)[number]
                    )
                  )}
                  onChange={(e) =>
                    onTargetMinChange(TARGET_TIME_OPTIONS[Number(e.target.value)])
                  }
                />
                <div className="target-ticks">
                  {TARGET_TIME_OPTIONS.slice(1).map((m) => (
                    <span key={m} className={m === targetMin ? "on" : ""}>
                      {m}
                    </span>
                  ))}
                </div>
              </>
            )}
            <div className="chatter-label">
              {mode === "distance"
                ? `Your buddy calls out 10%, a quarter, a third, halfway, two thirds, three quarters and 90% — then talks you through the run-in to ${targetKm} km.`
                : mode === "time"
                  ? `Your buddy calls out the same checkpoints against the clock, then counts you down to ${targetMin} minutes.`
                  : `Your buddy keeps checking you against ${formatTargetPace(targetPaceSec)} /km — praise while you're on it, a push when you slip off it. Km markers still fire; no checkpoint callouts.`}
            </div>
            {mode === "time" && (
              <div className="treadmill-warning">
                🏃 Treadmill mode — GPS, speed, distance and route tracking are all off.
                Your buddy paces you by the clock only.
              </div>
            )}
          </div>
        )}
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
            {chattiness === 1 ? " (default)" : ""}
            {chattiness <= CHATTINESS_MIN
              ? " — start, finish, pause and resume, target hit and each kilometre with its split. Nothing else, so your music or podcast plays through."
              : " — km markers and pace reactions always fire; this tunes how often the in-between talking happens. All the way left is essentials only."}
          </div>
        </div>

        {/* Music, speed display, delayed start and auto-pause are set once
            and kept; they fold behind one line so the picker, the target and
            the chatter stay in reach. */}
        <button
          className={`setup-more${moreOpen ? " open" : ""}`}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((o) => !o)}
        >
          <span className="setup-more-title">More settings</span>
          <span className="setup-more-sub">{moreLine}</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="setup-more-chev">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
        {moreOpen && (
          <div className="setup-more-body">
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

        {musicMeta &&
          (() => {
            const openCard = (
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
            );
            // Spotify connected: the transport replaces the open-the-app card —
            // start the playlist and set the volume without leaving Tekan Buddy.
            // Everyone else (guests, no link, other apps) sees the card as before.
            return music === "spotify" ? (
              <SpotifyTransport
                firstPollMs={400}
                intervalMs={30_000}
                openLink
                fallback={openCard}
              />
            ) : (
              openCard
            );
          })()}
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
        <div className="section-header">Getting Going</div>
        <div className="card" style={{ padding: "12px 16px" }}>
          <label className="switch-row">
            <span className="switch-text">
              {START_DELAY_SEC}-second delayed start
              <span className="switch-sub">
                Press Start, slide the phone into your arm sleeve and get set. The
                screen locks straight away and your buddy calls out ten seconds and
                five seconds before the run begins.
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={startDelay}
              onChange={(e) => onStartDelayChange(e.target.checked)}
            />
          </label>
        </div>

        {mode !== "time" && (
          <>
            <div className="section-header">Auto-Pause</div>
            <div className="card" style={{ padding: "12px 16px" }}>
              <label className="switch-row">
                <span className="switch-text">
                  Pause when I stop
                  <span className="switch-sub">
                    Your buddy freezes the clock about two seconds after you stop
                    moving and picks it back up about two seconds after you start
                    again — and says so out loud, since your phone won&apos;t be in
                    your hand.
                  </span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={autoPause}
                  onChange={(e) => onAutoPauseChange(e.target.checked)}
                />
              </label>
            </div>
          </>
        )}
          </div>
        )}

        <div className="section-header">Before You Go</div>
        <div
          className="card"
          style={{ padding: "12px 16px", fontSize: 13, color: "var(--label-2)", lineHeight: 1.5 }}
        >
          {!audioSessionSupported() && !isNativeApp() && (
            <>
              ⚠ This iOS version won&apos;t let a web app soften other apps&apos; audio, so
              your music will stay at full volume while your buddy talks — turn it down
              yourself before you start.
              <br />
              <br />
            </>
          )}
          {isNativeApp() ? (
            <>
              Start your music first, then hit Start — the voice ducks under it. Flip
              your ringer switch ON so you can hear your buddy. Lock the phone whenever
              you like: your buddy keeps talking and the GPS keeps tracking with the
              screen off.
            </>
          ) : (
            <>
              Start your music first, then hit Start — the voice mixes over it. Flip
              your ringer switch ON so you can hear your buddy. Keep the screen on
              (we&apos;ll dim it into a runner-friendly always-on mode).
            </>
          )}
        </div>
      </div>
    </div>
  );
}
