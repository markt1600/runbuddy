"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GeoTracker, formatElapsed, formatPace, type GpsSignal } from "@/lib/geo";
import { VoiceEngine, WakeLockManager } from "@/lib/audio";
import { CoachEngine } from "@/lib/coach";
import { describeEnvironment, fetchRunEnvironment } from "@/lib/enviro";
import type { MusicSource, Persona, RunStats } from "@/lib/types";

interface Props {
  persona: Persona;
  music: MusicSource;
  onFinish: (stats: RunStats) => void;
}

export default function RunScreen({ persona, music, onFinish }: Props) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [paused, setPaused] = useState(false);
  const [distanceKm, setDistanceKm] = useState(0);
  const [pace, setPace] = useState<number | null>(null);
  const [coachText, setCoachText] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [aod, setAod] = useState(false);
  const [listening, setListening] = useState(false);
  const [gpsNote, setGpsNote] = useState<string | null>(null);
  const [gpsSignal, setGpsSignal] = useState<GpsSignal>("acquiring");
  const [clock, setClock] = useState("");
  const [envLine, setEnvLine] = useState<string | null>(null);
  const [phraseStats, setPhraseStats] = useState({
    total: 0,
    rendered: 0,
    prerendered: 0,
    live: 0,
    synth: 0,
  });
  const envFetchStateRef = useRef<{ fetching: boolean; at: number }>({ fetching: false, at: 0 });

  const voiceRef = useRef<VoiceEngine | null>(null);
  const coachRef = useRef<CoachEngine | null>(null);
  const geoRef = useRef<GeoTracker | null>(null);
  const wakeRef = useRef<WakeLockManager | null>(null);
  const startAtRef = useRef(Date.now());
  const accumulatedRef = useRef(0);
  const pausedRef = useRef(false);
  const splitsRef = useRef<number[]>([]);
  const lastSplitAtRef = useRef(0);
  const statsRef = useRef<RunStats>({
    elapsedMs: 0,
    distanceKm: 0,
    paceSecPerKm: null,
    avgPaceSecPerKm: null,
    splits: [],
    route: [],
  });

  const computeStats = useCallback((): RunStats => {
    const geo = geoRef.current!;
    const elapsed = pausedRef.current
      ? accumulatedRef.current
      : accumulatedRef.current + (Date.now() - startAtRef.current);
    const dist = geo.distanceKm;
    const avg = dist > 0.05 ? elapsed / 1000 / dist : null;
    const stats: RunStats = {
      elapsedMs: elapsed,
      distanceKm: dist,
      paceSecPerKm: geo.rollingPaceSecPerKm(),
      avgPaceSecPerKm: avg,
      splits: splitsRef.current,
      route: geo.route,
    };
    statsRef.current = stats;
    return stats;
  }, []);

  useEffect(() => {
    const voice = new VoiceEngine(persona);
    voice.onSpeakingChange = (s, text) => {
      setSpeaking(s);
      if (text) setCoachText(text);
    };
    voice.start();
    voiceRef.current = voice;

    const coach = new CoachEngine(persona, voice);
    coachRef.current = coach;

    const geo = new GeoTracker();
    geoRef.current = geo;
    geo.start(() => {
      setDistanceKm(geo.distanceKm);
      setGpsNote(geo.lastError);
      setGpsSignal(geo.signal());
      // Record km splits
      const km = Math.floor(geo.distanceKm);
      if (km > splitsRef.current.length) {
        const elapsed = statsRef.current.elapsedMs;
        splitsRef.current = [...splitsRef.current, elapsed - lastSplitAtRef.current];
        lastSplitAtRef.current = elapsed;
      }
    });

    const wake = new WakeLockManager();
    wakeRef.current = wake;
    void wake.enable();

    startAtRef.current = Date.now();
    coach.onRunStart();

    const interval = setInterval(() => {
      const stats = computeStats();
      setElapsedMs(stats.elapsedMs);
      setPace(stats.paceSecPerKm);
      setClock(
        new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      );
      setGpsSignal(geo.signal()); // staleness-based, so re-check every second

      // Weather + locality: fetch on first fix, refresh every 30 minutes
      const envState = envFetchStateRef.current;
      if (
        geo.lastPosition &&
        !envState.fetching &&
        Date.now() - envState.at > 30 * 60_000
      ) {
        envState.fetching = true;
        const { lat, lon } = geo.lastPosition;
        void fetchRunEnvironment(lat, lon)
          .then((env) => {
            envState.at = Date.now();
            coach.setEnvironment(env);
            setEnvLine(describeEnvironment(env));
          })
          .finally(() => {
            envState.fetching = false;
          });
      }

      const lib = coach.libraryStats();
      setPhraseStats({ ...lib, ...voice.counts });

      if (!pausedRef.current) coach.tick(stats);
    }, 1000);

    return () => {
      clearInterval(interval);
      coach.dispose();
      voice.stop();
      geo.stop();
      void wake.disable();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const togglePause = () => {
    if (pausedRef.current) {
      startAtRef.current = Date.now();
      pausedRef.current = false;
      setPaused(false);
      coachRef.current?.onResume();
    } else {
      accumulatedRef.current += Date.now() - startAtRef.current;
      pausedRef.current = true;
      setPaused(true);
      coachRef.current?.onPause();
    }
  };

  const endRun = () => {
    if (!window.confirm("End this run?")) return;
    const stats = computeStats();
    coachRef.current?.onFinish(stats);
    // Give the finish line a moment to start playing before unmount
    setTimeout(() => onFinish(stats), 300);
  };

  const pushToTalk = () => {
    if (listening) return;
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      setCoachText("Voice input isn't supported on this browser.");
      return;
    }
    const rec = new Recognition();
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    setListening(true);
    let got = false;
    rec.onresult = (e) => {
      got = true;
      const transcript = e.results[e.resultIndex][0].transcript;
      setListening(false);
      setCoachText(`You: “${transcript}”`);
      void coachRef.current?.respondTo(transcript, statsRef.current);
    };
    rec.onerror = () => {
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
      if (!got) setCoachText("Didn't catch that — try again!");
    };
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  };

  const musicLabel =
    music === "spotify" ? "Spotify" : music === "apple-podcasts" ? "Podcasts" : null;

  const GPS_META: Record<GpsSignal, { cls: string; label: string }> = {
    good: { cls: "good", label: "GPS" },
    weak: { cls: "weak", label: "GPS weak" },
    acquiring: { cls: "weak", label: "Locating…" },
    lost: { cls: "lost", label: "GPS lost" },
    denied: { cls: "lost", label: "No location" },
    unavailable: { cls: "lost", label: "No GPS" },
  };
  const gps = GPS_META[gpsSignal];
  const gpsTrouble = gpsSignal === "lost" || gpsSignal === "denied" || gpsSignal === "unavailable";

  return (
    <div className="run-screen fade-in">
      <div className="run-topbar">
        <div className="run-persona-chip">
          <span className="chip-emoji">{persona.emoji}</span>
          {persona.name}
        </div>
        <div className={`gps-pill ${gps.cls}`}>
          <span className="gps-dot" />
          {gps.label}
        </div>
        <button
          className={`icon-btn${aod ? " active" : ""}`}
          aria-label="Always-on display"
          onClick={() => setAod(true)}
        >
          ☾
        </button>
      </div>

      <div className="big-timer">{formatElapsed(elapsedMs)}</div>
      <div className="timer-label">{paused ? "Paused" : "Elapsed"}</div>

      <div className="stat-grid">
        <div className="stat-cell">
          <div className="stat-value">
            {distanceKm.toFixed(2)} <span className="stat-unit">km</span>
          </div>
          <div className="stat-label">Distance</div>
        </div>
        <div className="stat-cell">
          <div className="stat-value">{formatPace(pace)}</div>
          <div className="stat-label">Pace / km</div>
        </div>
      </div>

      {gpsSignal === "lost" || gpsNote ? (
        <div className="gps-note">
          {gpsSignal === "lost"
            ? "GPS signal lost — distance is paused until it comes back"
            : gpsNote}
        </div>
      ) : (
        <div className="env-line">
          {envLine ?? (musicLabel ? `Mixing over ${musicLabel} · ringer on 🔔` : "")}
        </div>
      )}

      <div className="coach-bubble">
        <div className={`eq${speaking ? " speaking" : ""}`}>
          <span /><span /><span /><span />
        </div>
        <div className={`text${coachText ? "" : " idle-text"}`}>
          {coachText ?? `${persona.name} is watching your pace…`}
        </div>
      </div>

      <div className="run-controls">
        <button className="control-btn pause" onClick={togglePause}>
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          className={`ptt-btn${listening ? " listening" : ""}`}
          aria-label="Talk to your trainer"
          onClick={pushToTalk}
        >
          🎤
        </button>
        <button className="control-btn end" onClick={endRun}>
          End
        </button>
      </div>

      <div className="phrase-stats">
        {(() => {
          const spoken = phraseStats.prerendered + phraseStats.live + phraseStats.synth;
          const hit =
            spoken > 0 ? Math.round((phraseStats.prerendered / spoken) * 100) : null;
          return (
            <>
              📚 {phraseStats.rendered}/{phraseStats.total} phrases pre-rendered
              {" · "}
              {hit === null
                ? "no lines spoken yet"
                : `hit rate ${hit}% (${phraseStats.prerendered}/${spoken}${
                    phraseStats.live ? `, ${phraseStats.live} improvised` : ""
                  })`}
            </>
          );
        })()}
      </div>

      {aod && (
        <div className="aod" onClick={() => setAod(false)}>
          <div className="aod-time">{formatElapsed(elapsedMs)}</div>
          <div className="aod-stats">
            <span>{distanceKm.toFixed(2)} km</span>
            <span>{formatPace(pace)}</span>
            <span>{clock}</span>
          </div>
          {gpsTrouble && <div className="aod-gps">⚠ {gps.label}</div>}
          <div className="aod-hint">tap anywhere to wake · coach keeps talking</div>
        </div>
      )}
    </div>
  );
}
