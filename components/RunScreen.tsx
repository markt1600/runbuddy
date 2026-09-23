"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GeoTracker, formatElapsed, type GpsSignal } from "@/lib/geo";
import { formatInUnit, unitSuffix, type SpeedUnit } from "@/lib/units";
import { VoiceEngine, WakeLockManager, audioSessionSupported, vibrate } from "@/lib/audio";
import { CoachEngine, type RunnerInfo } from "@/lib/coach";
import { planAllowsGenerated, type Plan } from "@/lib/plan";
import type { RunHistoryDigest } from "@/lib/history";
import { describeEnvironment, fetchRunEnvironment } from "@/lib/enviro";
import { CHATTINESS_MAX, CHATTINESS_MIN, chattinessLabel, formatTargetPace } from "@/lib/prefs";
import { isNativeApp, runBuddyNative } from "@/lib/native";
import { renderedUrlsFor } from "@/lib/voiceLibrary";
import { PERSONAS, PERSONA_LIST } from "@/lib/personas";
import type { MusicSource, Persona, PersonaId, RunStats } from "@/lib/types";
import SpotifyTransport from "./SpotifyTransport";

/** Long enough to get the phone back into an arm sleeve and set yourself. */
const RESUME_DELAY_SEC = 10;

interface Props {
  persona: Persona;
  music: MusicSource;
  speedUnit: SpeedUnit;
  onSpeedUnitChange: (u: SpeedUnit) => void;
  chattiness: number;
  onChattinessChange: (v: number) => void;
  targetKm: number;
  targetMin: number;
  targetPaceSec: number;
  autoPause: boolean;
  startDelaySec: number;
  /** Signed-in runner's profile — the coach weaves it into improvised lines. */
  runner?: RunnerInfo | null;
  /** The account's plan (lib/plan): "free" plays the library only. */
  plan?: Plan;
  /** Their saved-run digest — what the coach "remembers" about them. */
  history?: RunHistoryDigest | null;
  /** Best 1/5/10km efforts from history — live PR announcements compare here. */
  personalRecords?: { targetKm: number; sec: number; startedAt: number }[] | null;
  /** Mid-run trainer swap: tapping the persona chip cycles and reports here. */
  onPersonaChange?: (id: PersonaId) => void;
  /** Duo mode: this persona co-coaches the run alongside `persona`. */
  duoWith?: PersonaId | null;
  /** Mid-run duo toggling reports here so the preference persists. */
  onDuoModeChange?: (on: boolean) => void;
  /** The shell re-themes the whole app while the run is paused. */
  onPauseStateChange?: (paused: boolean) => void;
  onFinish: (stats: RunStats) => void;
}

export default function RunScreen({
  persona,
  music,
  speedUnit,
  onSpeedUnitChange,
  chattiness,
  onChattinessChange,
  targetKm,
  targetMin,
  targetPaceSec,
  autoPause,
  startDelaySec,
  runner,
  plan = "full",
  history,
  personalRecords,
  onPersonaChange,
  duoWith,
  onDuoModeChange,
  onPauseStateChange,
  onFinish,
}: Props) {
  // Duo can be toggled mid-run via the chip, so it's live state seeded from
  // the prop. The pair is fixed: Ah Beng + Ah Lian.
  const [duoActive, setDuoActive] = useState(!!duoWith);
  // Shoutout delivery renders in whatever trainer is CURRENT — track it.
  const personaRef = useRef(persona);
  personaRef.current = persona;

  // Presence + friends' shoutouts, signed-in runs only. The heartbeat marks
  // this runner as "Running" for their friends; the first fetch collects
  // messages queued for this run's start/middle/end, and the slow poll picks
  // up "right now" messages sent while the run is in progress.
  useEffect(() => {
    if (!runner) return; // guests have no friends layer
    let stopped = false;
    const deliver = (slots: string[]) => {
      void fetch("/api/shoutouts/deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona: personaRef.current.id, slots }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { shoutouts?: import("@/lib/coach").DeliveredShoutout[] } | null) => {
          if (!stopped && data?.shoutouts?.length) {
            coachRef.current?.addShoutouts(data.shoutouts);
          }
        })
        .catch(() => {});
    };
    const beat = () => {
      void fetch("/api/presence", { method: "POST" }).catch(() => {});
    };
    beat();
    deliver(["start", "middle", "end"]);
    const beatTimer = setInterval(() => {
      if (!stopped) beat();
    }, 75_000);
    const nowTimer = setInterval(() => {
      if (!stopped) deliver(["now"]);
    }, 90_000);
    return () => {
      stopped = true;
      clearInterval(beatTimer);
      clearInterval(nowTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const treadmill = targetMin > 0;
  const [elapsedMs, setElapsedMs] = useState(0);
  const [paused, setPaused] = useState(false);
  const [autoPaused, setAutoPaused] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [resumeCountdown, setResumeCountdown] = useState(0);
  const [awaitingMovement, setAwaitingMovement] = useState(false);
  const [distanceKm, setDistanceKm] = useState(0);
  const [speeds, setSpeeds] = useState<{
    now: number | null;
    lastKm: number | null;
    avg: number | null;
  }>({ now: null, lastKm: null, avg: null });
  const [coachText, setCoachText] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  /** Who is talking right now — the partner or a cameo, not always the lead. */
  const [speaker, setSpeaker] = useState<Persona | null>(null);
  /** Chatter, music, stats and the microphone live behind one sheet. */
  const [sheetOpen, setSheetOpen] = useState(false);
  /** Friends' shout-outs that actually played — the summary counts them. */
  const cheersRef = useRef<string[]>([]);
  const [aod, setAod] = useState(false);
  const [listening, setListening] = useState(false);
  const [gpsNote, setGpsNote] = useState<string | null>(null);
  const [gpsSignal, setGpsSignal] = useState<GpsSignal>("acquiring");
  const [locked, setLocked] = useState(startDelaySec > 0);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [holdPct, setHoldPct] = useState(0);
  const holdRef = useRef<{ raf: number; start: number } | null>(null);
  const holdDoneRef = useRef(false);
  const unlockingRef = useRef(false);
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
  const localityRef = useRef<string | null>(null);
  const cityRef = useRef<string | null>(null);

  const voiceRef = useRef<VoiceEngine | null>(null);
  const coachRef = useRef<CoachEngine | null>(null);
  const geoRef = useRef<GeoTracker | null>(null);
  const wakeRef = useRef<WakeLockManager | null>(null);
  const startAtRef = useRef(Date.now());
  const accumulatedRef = useRef(0);
  // Wall-clock start, set once when the run truly begins (after any countdown)
  // and never touched by pauses — moving time and total elapsed time diverge
  // the moment the first pause happens, and history wants both.
  const wallStartRef = useRef(0);
  const pausedRef = useRef(false);
  const autoPausedRef = useRef(false);
  const countdownRef = useRef(0);
  const resumeCountdownRef = useRef(0);
  const awaitingMovementRef = useRef(false);
  const finishedRef = useRef(false);
  const splitsRef = useRef<number[]>([]);
  const lastSplitAtRef = useRef(0);
  const statsRef = useRef<RunStats>({
    elapsedMs: 0,
    distanceKm: 0,
    paceSecPerKm: null,
    avgPaceSecPerKm: null,
    speedNowKmh: null,
    lastKmSpeedKmh: null,
    avgSpeedKmh: null,
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
      speedNowKmh: geo.speedKmhLastSeconds(10),
      lastKmSpeedKmh: geo.lastKmSpeedKmh(),
      avgSpeedKmh: dist > 0.05 && elapsed > 0 ? dist / (elapsed / 3_600_000) : null,
      splits: splitsRef.current,
      route: geo.route,
      treadmill,
      targetMinutes: treadmill ? targetMin : undefined,
      targetKm: !treadmill && targetKm > 0 ? targetKm : undefined,
      targetPaceSec: !treadmill && targetPaceSec > 0 ? targetPaceSec : undefined,
      gps: treadmill ? undefined : geo.fixDiagnostics(),
      startedAt: wallStartRef.current || undefined,
      wallElapsedMs: wallStartRef.current ? Date.now() - wallStartRef.current : undefined,
      locality: localityRef.current ?? undefined,
      city: cityRef.current ?? undefined,
      cheers:
        cheersRef.current.length > 0
          ? { count: cheersRef.current.length, from: [...new Set(cheersRef.current)] }
          : undefined,
    };
    statsRef.current = stats;
    return stats;
  }, []);

  // The shell inverts the whole app while the clock is stopped: a paused run
  // must be unmistakable at arm's length, and a colour change across the
  // entire screen beats any label. Cleared on unmount so the summary is paper.
  useEffect(() => {
    onPauseStateChange?.(paused);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);
  useEffect(() => () => onPauseStateChange?.(false), [onPauseStateChange]);

  /**
   * Pause and resume are things you feel rather than see when the phone is in
   * a sleeve, so every transition gets a buzz and a two-tone cue. The buzz is a
   * no-op on iOS (Safari has no Vibration API); the cue is what actually
   * lands there.
   */
  const signalTransition = useCallback((kind: "pause" | "resume") => {
    vibrate(kind === "pause" ? [120, 80, 120] : [220]);
    voiceRef.current?.cue(kind);
  }, []);

  const changeChattiness = (v: number) => {
    coachRef.current?.setChattiness(v);
    onChattinessChange(v); // also remembered for next run
  };

  /** Everything a resume has to do, however it was triggered. */
  const resumeRun = useCallback((atMs?: number) => {
    resumeCountdownRef.current = 0;
    setResumeCountdown(0);
    awaitingMovementRef.current = false;
    setAwaitingMovement(false);
    geoRef.current?.disarmResume();
    startAtRef.current = atMs ?? Date.now();
    pausedRef.current = false;
    autoPausedRef.current = false;
    setPaused(false);
    setAutoPaused(false);
    // Resuming by hand while standing still is a deliberate override — clear
    // the detector's state so it judges from here rather than re-firing.
    geoRef.current?.clearAutoPause();
    if (geoRef.current) geoRef.current.paused = false;
    signalTransition("resume");
    coachRef.current?.onResume();
  }, [signalTransition]);

  useEffect(() => {
    const voice = new VoiceEngine(persona);
    voice.onSpeakingChange = (s, text, who) => {
      setSpeaking(s);
      if (text) setCoachText(text);
      if (s) setSpeaker(who ?? null);
    };
    voice.start();
    voiceRef.current = voice;

    const coach = new CoachEngine(persona, voice, chattiness, targetKm, targetMin, targetPaceSec);
    coach.setRunner(runner ?? null);
    coach.setGenerated(planAllowsGenerated(plan));
    coach.setHistory(history ?? null);
    coach.setPersonalRecords(personalRecords ?? null);
    if (duoWith && PERSONAS[duoWith]) coach.setDuo(PERSONAS[duoWith]);
    coachRef.current = coach;
    // Played receipts: the sender's What's-new gets "✅ Played at 07:42 in
    // Mark's run" the moment their message starts. Clock time from this
    // phone — it's this run, in this timezone. Fire-and-forget; guests have
    // no friends layer, so nothing is ever queued for them.
    if (runner) {
      coach.onShoutoutPlayed = (id, fromName) => {
        cheersRef.current.push(fromName);
        const localTime = new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
        void fetch("/api/shoutouts/played", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, localTime }),
        }).catch(() => {});
      };
    }

    // Offline armour (shell only): warm this persona's whole rendered
    // library into the native disk cache while there's still signal, so a
    // dead zone mid-run only silences the improvised lines. Duo mode warms
    // both trainers' packs.
    const nativeShell = runBuddyNative();
    if (nativeShell) {
      const urls = [
        ...renderedUrlsFor(persona.id),
        ...(duoWith ? renderedUrlsFor(duoWith) : []),
      ];
      if (urls.length > 0) void nativeShell.prefetchAudio({ urls });
    }

    // Now-playing awareness lives in the SpotifyTransport component below —
    // it stays mounted (just unrendered) while locked, so its polling keeps
    // feeding the coach's improvise context all run.

    const geo = new GeoTracker();
    geoRef.current = geo;
    // Treadmill mode: never start the watch, so no location permission is
    // requested and nothing about speed, distance or route is tracked.
    if (!treadmill) {
      geo.autoPauseEnabled = autoPause;
      // correctedDistance stays at its default (true): the chord engine is
      // permanent since a field run validated it to 0.6% of a Watch. The
      // legacy path survives only as the sim's comparison baseline.
      // Both edges arrive back-dated to the fix where movement actually turned,
      // so the ~2s the detector spends confirming costs nothing on the clock.
      geo.onAutoPause = (at) => {
        if (pausedRef.current) return; // a manual pause already owns the state
        accumulatedRef.current += Math.max(0, at - startAtRef.current);
        pausedRef.current = true;
        autoPausedRef.current = true;
        setPaused(true);
        setAutoPaused(true);
        signalTransition("pause");
        coach.onAutoPause();
      };
      geo.onAutoResume = (at) => {
        if (!autoPausedRef.current) return; // never un-pause a manual pause
        startAtRef.current = at;
        pausedRef.current = false;
        autoPausedRef.current = false;
        resumeCountdownRef.current = 0;
        setResumeCountdown(0);
        setPaused(false);
        setAutoPaused(false);
        signalTransition("resume");
        coach.onAutoResume();
      };
      // Manual pause, phone back in the sleeve: the clock restarts itself the
      // moment the runner moves off, back-dated to that fix like auto-resume.
      geo.onArmedResume = (at) => {
        if (!awaitingMovementRef.current) return;
        resumeRun(at);
      };
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
          // A wrist-less tap on every completed kilometre — only real in the
          // shell (iPhone Safari has no vibration), a no-op elsewhere.
          vibrate(60);
        }
      });
    }

    const wake = new WakeLockManager();
    wakeRef.current = wake;
    void wake.enable();

    startAtRef.current = Date.now();
    wallStartRef.current = startDelaySec > 0 ? 0 : Date.now();
    if (startDelaySec > 0) {
      // Held at the start line: the screen is already locked so the phone can
      // go straight into the sleeve, and nothing counts until we say go.
      countdownRef.current = startDelaySec;
      setCountdown(startDelaySec);
      geo.paused = true;
    } else {
      coach.onRunStart();
    }

    const interval = setInterval(() => {
      // Delayed start: nothing else on this tick until the count reaches zero.
      if (countdownRef.current > 0) {
        const left = countdownRef.current - 1;
        countdownRef.current = left;
        setCountdown(left);
        if (left === 10) coach.sayCountdown(0);
        else if (left === 5) coach.sayCountdown(1);
        if (left === 0) {
          startAtRef.current = Date.now();
          wallStartRef.current = Date.now();
          geo.paused = false;
          coach.onRunStart();
        }
        setGpsSignal(geo.signal());
        return;
      }

      const stats = computeStats();
      setElapsedMs(stats.elapsedMs);
      setSpeeds({
        now: stats.speedNowKmh,
        lastKm: stats.lastKmSpeedKmh,
        avg: stats.avgSpeedKmh,
      });
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
            if (env.locality) localityRef.current = env.locality;
            if (env.city) cityRef.current = env.city;
            coach.setEnvironment(env);
            // Away from the home city: say so on the env line — it's also
            // the tell that the coach's travel commentary is armed.
            const away =
              env.city &&
              runner?.homeCity &&
              env.city.trim().toLowerCase() !== runner.homeCity.trim().toLowerCase();
            const base = describeEnvironment(env);
            setEnvLine(away ? `✈️ ${env.city} · ${base ?? ""}`.replace(/ · $/, "") : base);
          })
          .finally(() => {
            envState.fetching = false;
          });
      }

      const lib = coach.libraryStats();
      setPhraseStats({ ...lib, ...voice.counts });

      if (pausedRef.current) {
        if (resumeCountdownRef.current > 0) {
          const left = resumeCountdownRef.current - 1;
          resumeCountdownRef.current = left;
          setResumeCountdown(left);
          if (left === 5) coach.sayCountdown(1); // the five-second line
          if (left === 0) resumeRun();
          return; // no loitering nags while we're counting back in
        }
        coach.tickPaused(stats);
      } else {
        coach.tick(stats);
        // A rolling effort just dipped under a stored PR → the coach's
        // fireworks, once per distance per run.
        if (!treadmill) coach.checkPersonalRecords(geo.bestEffortsSec(), stats);
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      coach.dispose();
      // A finished run gets to say its piece; anything else stops dead.
      if (finishedRef.current) voice.stopWhenIdle();
      else voice.stop();
      geo.stop();
      void wake.disable();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pauseRun = () => {
    accumulatedRef.current += Date.now() - startAtRef.current;
    pausedRef.current = true;
    setPaused(true);
    if (geoRef.current) geoRef.current.paused = true;
    signalTransition("pause");
    coachRef.current?.onPause();
  };

  const togglePause = () => {
    if (pausedRef.current) resumeRun();
    else pauseRun();
  };

  /**
   * "Put it away and go." Locks the screen immediately, then hands the resume
   * to whatever evidence this mode has: outdoors we wait for the runner to
   * actually move off; on a treadmill there is no GPS to watch, so it counts
   * down instead.
   */
  const startDelayedResume = () => {
    setLocked(true);
    const sig = geoRef.current?.signal();
    if (treadmill || !geoRef.current || sig === "denied" || sig === "unavailable") {
      resumeCountdownRef.current = RESUME_DELAY_SEC;
      setResumeCountdown(RESUME_DELAY_SEC);
      return;
    }
    awaitingMovementRef.current = true;
    setAwaitingMovement(true);
    geoRef.current.armResume();
  };

  // In-app confirmation, NOT window.confirm: the native confirm() is a
  // synchronous WebView modal that can hang the JS thread mid-gesture (a
  // sweaty multi-touch on the End button froze the whole UI — taps queued,
  // the run wouldn't end). A React overlay repaints normally and can't block.
  const endRun = () => {
    if (!finishedRef.current) setConfirmEnd(true);
  };
  const doEndRun = () => {
    setConfirmEnd(false);
    // Idempotent: a second tap (or a queued one) must not finish the run
    // twice — every finish POSTs a run record.
    if (finishedRef.current) return;
    const stats = computeStats();
    finishedRef.current = true;
    coachRef.current?.onFinish();
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

  // Hold-to-unlock: a sustained 1.5s press ARMS the unlock; the unlock itself
  // happens on finger RELEASE, and the overlay lingers briefly past release.
  // Unlocking mid-press used to unmount the overlay while the finger was still
  // down, so the lift-off tap fell through onto the push-to-talk button
  // underneath and started the microphone. Fabric brushing the screen still
  // can't unlock: short or moving contacts never survive the full hold.
  const HOLD_MS = 1500;

  const startHold = () => {
    if (holdRef.current || unlockingRef.current) return;
    holdDoneRef.current = false;
    const start = performance.now();
    const step = () => {
      const pct = Math.min(100, ((performance.now() - start) / HOLD_MS) * 100);
      setHoldPct(pct);
      if (pct >= 100) {
        holdDoneRef.current = true; // armed — waiting for release
        holdRef.current = null;
        return;
      }
      holdRef.current = { raf: requestAnimationFrame(step), start };
    };
    holdRef.current = { raf: requestAnimationFrame(step), start };
  };

  const releaseHold = () => {
    if (unlockingRef.current) return;
    if (holdDoneRef.current) {
      holdDoneRef.current = false;
      unlockingRef.current = true;
      // Keep the overlay mounted through the tap that iOS synthesises on
      // lift-off, so it lands here and not on the controls underneath.
      window.setTimeout(() => {
        unlockingRef.current = false;
        setHoldPct(0);
        setLocked(false);
        // Unlocking mid-run means you're stopping to do something — pause in
        // the same gesture rather than demanding a second press while the
        // clock eats your pace. Not during the start countdown (nothing is
        // running yet) and not when already paused however that happened.
        if (!pausedRef.current && countdownRef.current === 0 && !finishedRef.current) {
          pauseRun();
        }
      }, 250);
    } else {
      if (holdRef.current) cancelAnimationFrame(holdRef.current.raf);
      holdRef.current = null;
      setHoldPct(0);
    }
  };

  /**
   * Mid-run trainer swap: cycle to the next persona. The coach keeps every
   * bit of run state (records told, checkpoints crossed) — only the voice
   * and material change, and the newcomer says hello. The parent's persona
   * state updates too, so the accent colour, summary and saved run follow.
   */
  const switchPersona = () => {
    if (!onPersonaChange) return;
    // The cycle: every solo trainer, then the duo, then round again. The
    // coach keeps all run state across every hop — only the voices change.
    const cycle: (PersonaId | "duo")[] = [...PERSONA_LIST.map((p) => p.id), "duo"];
    const current: PersonaId | "duo" = duoActive ? "duo" : persona.id;
    const next = cycle[(cycle.indexOf(current) + 1) % cycle.length];
    const coach = coachRef.current;
    const native = runBuddyNative();
    if (next === "duo") {
      coach?.setPersona(PERSONAS.ahbeng);
      coach?.setDuo(PERSONAS.ahlian);
      onPersonaChange("ahbeng");
      onDuoModeChange?.(true);
      setDuoActive(true);
      if (native) {
        const urls = [...renderedUrlsFor("ahbeng"), ...renderedUrlsFor("ahlian")];
        if (urls.length > 0) void native.prefetchAudio({ urls });
      }
    } else {
      coach?.setDuo(null);
      coach?.setPersona(PERSONAS[next]);
      onPersonaChange(next);
      if (duoActive) onDuoModeChange?.(false);
      setDuoActive(false);
      if (native) {
        const urls = renderedUrlsFor(next);
        if (urls.length > 0) void native.prefetchAudio({ urls });
      }
    }
    vibrate(40);
  };

  const musicLabel =
    music === "spotify"
      ? "Spotify"
      : music === "apple-music"
        ? "Apple Music"
        : music === "apple-podcasts"
          ? "Podcasts"
          : null;

  // The shell ducks through a real AVAudioSession; Safari needs the web
  // audioSession API. Either way "softening" is the truth to display.
  const canDuck = audioSessionSupported() || isNativeApp();
  const musicNote = musicLabel
    ? canDuck
      ? `${musicLabel} softens while your buddy talks · ringer on`
      : `${musicLabel} stays at full volume on this iOS · ringer on`
    : null;

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
  const partner = PERSONAS.ahlian;
  const counting = countdown > 0 || resumeCountdown > 0;

  // One line that says what the coach is doing. Three things on the screen:
  // the clock, this, and the buttons — everything else is behind the sheet.
  const status: { tone: "live" | "hold" | "bad" | "idle"; title: string; sub: string | null } =
    (() => {
      if (!treadmill && gpsSignal === "lost")
        return {
          tone: "bad",
          title: "GPS lost — distance paused",
          sub: "It picks up on its own when the signal comes back.",
        };
      if (resumeCountdown > 0)
        return { tone: "hold", title: `Resuming in ${resumeCountdown}`, sub: "Get set." };
      if (awaitingMovement)
        return {
          tone: "hold",
          title: "Waiting for you to run",
          sub: "The clock restarts itself the moment you move off.",
        };
      if (autoPaused)
        return {
          tone: "hold",
          title: "Auto-paused",
          sub: "Start moving and the clock resumes on its own.",
        };
      if (paused)
        return {
          tone: "hold",
          title: duoActive ? "Your buddies are quiet" : `${persona.shortName} is quiet`,
          sub: "No nagging while you chose to stop.",
        };
      if (speaking)
        return {
          tone: "live",
          title: `${(speaker ?? persona).shortName} is talking`,
          sub: coachText,
        };
      return {
        tone: "idle",
        title: duoActive
          ? `${persona.shortName} and ${partner.shortName} are with you`
          : `${persona.shortName} is with you`,
        sub: coachText ?? gpsNote ?? envLine ?? musicNote,
      };
    })();

  const timerLabel = countdown > 0
    ? "Starting soon"
    : resumeCountdown > 0
      ? "Resuming soon"
      : awaitingMovement
        ? "In the sleeve"
        : autoPaused
          ? "Auto-paused"
          : paused
            ? "Clock stopped"
            : "Moving time";

  const targetLine = (() => {
    if (treadmill) {
      const done = elapsedMs / (targetMin * 60_000);
      return {
        pct: Math.min(100, Math.max(0, done * 100)),
        text:
          done >= 1
            ? `${targetMin} minute target reached`
            : `${formatElapsed(elapsedMs)} of ${targetMin} min`,
      };
    }
    if (targetKm > 0) {
      const done = distanceKm / targetKm;
      return {
        pct: Math.min(100, Math.max(0, done * 100)),
        text:
          done >= 1 ? `${targetKm} km target reached` : `${distanceKm.toFixed(2)} of ${targetKm} km`,
      };
    }
    if (targetPaceSec > 0) {
      return { pct: null, text: `Target pace ${formatTargetPace(targetPaceSec)} /km` };
    }
    return null;
  })();

  const spoken = phraseStats.prerendered + phraseStats.live + phraseStats.synth;
  const hitRate = spoken > 0 ? Math.round((phraseStats.prerendered / spoken) * 100) : null;
  const showControls = !locked && !counting;

  return (
    <div className={`run-screen fade-in${paused ? " is-paused" : ""}`}>
      <div className="rs-head">
        <button
          className={`rs-trainer${speaking ? " speaking" : ""}`}
          aria-label="Switch trainer"
          onClick={switchPersona}
        >
          <span className="rs-avatar" style={{ "--persona": persona.accent } as React.CSSProperties}>
            {persona.emoji}
            {duoActive ? partner.emoji : ""}
          </span>
          <span className="rs-trainer-text">
            <span className="rs-trainer-name">{persona.shortName}</span>
            <span className="rs-trainer-sub">
              {duoActive ? `with ${partner.shortName}` : onPersonaChange ? "tap to switch" : persona.name}
            </span>
          </span>
        </button>
        <div className="rs-head-right">
          {treadmill ? (
            <span className="gps-pill treadmill">Treadmill</span>
          ) : (
            <span className={`gps-pill ${gps.cls}`}>
              <span className="gps-dot" />
              {gps.label}
            </span>
          )}
          <button
            className="rs-lock"
            aria-label="Lock screen for armband"
            onClick={() => setLocked(true)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
          </button>
        </div>
      </div>

      <div className="rs-centre">
        {counting ? (
          <>
            <div className="rs-timer counting">{countdown > 0 ? countdown : resumeCountdown}</div>
            <div className="rs-timer-label">{timerLabel}</div>
          </>
        ) : (
          <>
            <div className="rs-timer">{formatElapsed(elapsedMs)}</div>
            <div className="rs-timer-label">{timerLabel}</div>
          </>
        )}

        {treadmill ? (
          <div className="rs-pair">
            <div className="rs-pair-item">
              <span className="rs-pair-value">
                {formatElapsed(Math.max(0, targetMin * 60_000 - elapsedMs))}
              </span>
              <span className="rs-pair-label">Remaining</span>
            </div>
            <span className="rs-pair-divider" />
            <div className="rs-pair-item">
              <span className="rs-pair-value">
                {Math.floor(Math.min(100, (elapsedMs / (targetMin * 60_000)) * 100))}%
              </span>
              <span className="rs-pair-label">Complete</span>
            </div>
          </div>
        ) : (
          <button
            className="rs-pair tappable"
            aria-label="Toggle between km/h and min/km"
            onClick={() => onSpeedUnitChange(speedUnit === "kmh" ? "minkm" : "kmh")}
          >
            <span className="rs-pair-item">
              <span className="rs-pair-value">{distanceKm.toFixed(2)}</span>
              <span className="rs-pair-label">km</span>
            </span>
            <span className="rs-pair-divider" />
            <span className="rs-pair-item">
              <span className="rs-pair-value">{formatInUnit(speeds.now, speedUnit)}</span>
              <span className="rs-pair-label">
                {speedUnit === "minkm" ? "per km" : unitSuffix(speedUnit)}
              </span>
            </span>
          </button>
        )}

        {targetLine && (
          <div className="rs-target">
            {targetLine.pct !== null && (
              <div className="target-bar">
                <div className="target-bar-fill" style={{ width: `${targetLine.pct}%` }} />
              </div>
            )}
            <div className="rs-target-line">{targetLine.text}</div>
          </div>
        )}

        {(counting || awaitingMovement) && (
          <div className="sleeve-notice">
            {isNativeApp() ? (
              <>
                <strong>Lock the phone if you like.</strong> Your buddy keeps talking and
                the GPS keeps tracking with the screen off.
              </>
            ) : (
              <>
                <strong>Don&apos;t press the side button.</strong> Tekan Buddy locks the screen
                for you — it&apos;s already locked. If you lock the phone yourself, iOS mutes
                your buddy until you unlock it again.
              </>
            )}
          </div>
        )}
      </div>

      <div className={`rs-status ${status.tone}`}>
        <span className="rs-status-dot" />
        <div className="rs-status-text">
          <span className="rs-status-title">{status.title}</span>
          {status.sub && <span className="rs-status-sub">{status.sub}</span>}
        </div>
      </div>

      {/* Hidden rather than unmounted while locked, so nothing above jumps. */}
      <div className="rs-actions" style={{ visibility: locked ? "hidden" : "visible" }}>
        {counting ? (
          <button className="control-btn end ghost" onClick={endRun}>
            End run
          </button>
        ) : paused ? (
          <>
            <button className="control-btn pause primary" onClick={togglePause}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M7 5l12 7-12 7z" />
              </svg>
              Resume now
            </button>
            {!autoPaused && !awaitingMovement && (
              <button className="control-btn secondary" onClick={startDelayedResume}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="4" y="11" width="16" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
                {treadmill
                  ? `Put it away, resumes in ${RESUME_DELAY_SEC}s`
                  : "Put it away, resume when I run"}
              </button>
            )}
            <button className="control-btn end ghost" onClick={endRun}>
              End run
            </button>
          </>
        ) : (
          <div className="rs-actions-row">
            <button className="control-btn pause" onClick={togglePause}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
              Pause
            </button>
            <button className="control-btn end" onClick={endRun}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <rect x="5" y="5" width="14" height="14" rx="2" />
              </svg>
              End run
            </button>
          </div>
        )}
      </div>

      {/* Likewise kept in the layout while locked: the unlock pad floats over
          this bottom band, and the status box must not slide down into it. */}
      {(showControls || locked) && (
        <button
          className="rs-sheet-toggle"
          style={{ visibility: locked ? "hidden" : "visible" }}
          onClick={() => setSheetOpen(true)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M6 15l6-6 6 6" />
          </svg>
          Chatter, music, stats
        </button>
      )}

      {/* Always mounted: the Spotify transport inside keeps polling now-playing
          for the coach whether or not the sheet is showing. */}
      <div className={`rs-sheet${sheetOpen && !locked ? " open" : ""}`} aria-hidden={!sheetOpen}>
        <button className="rs-sheet-scrim" aria-label="Close" onClick={() => setSheetOpen(false)} />
        <div className="rs-sheet-panel">
          <div className="rs-sheet-head">
            <span className="rs-sheet-title">Chatter, music, stats</span>
            <button className="rs-sheet-close" aria-label="Close" onClick={() => setSheetOpen(false)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <div className="rs-sheet-label">How much your buddy talks</div>
          <div className="chatter-inline">
            <input
              type="range"
              aria-label="How often your buddy talks"
              min={CHATTINESS_MIN}
              max={CHATTINESS_MAX}
              step={0.25}
              value={chattiness}
              onChange={(e) => changeChattiness(Number(e.target.value))}
            />
            <span className="chatter-inline-label">{chattinessLabel(chattiness)}</span>
          </div>

          {!treadmill && (
            <>
              <div className="rs-sheet-label">Speed display</div>
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
            </>
          )}

          {music === "spotify" && (
            <>
              <div className="rs-sheet-label">Music</div>
              <SpotifyTransport
                hidden={!sheetOpen || locked}
                firstPollMs={8_000}
                intervalMs={120_000}
                onTrack={(label) => coachRef.current?.setNowPlaying(label)}
              />
            </>
          )}

          <div className="rs-sheet-row">
            <button
              className={`rs-sheet-btn${listening ? " listening" : ""}`}
              onClick={pushToTalk}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" />
                <path d="M19 12a7 7 0 0 1-14 0" />
                <path d="M12 19v3" />
              </svg>
              {listening ? "Listening…" : "Talk to your trainer"}
            </button>
            <button
              className="rs-sheet-btn"
              onClick={() => {
                setSheetOpen(false);
                setAod(true);
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
              </svg>
              Dim the screen
            </button>
          </div>

          <div className="phrase-stats">
            {musicNote && <div>{musicNote}</div>}
            <div>
              {phraseStats.rendered}/{phraseStats.total} phrases pre-rendered
              {" · "}
              {hitRate === null
                ? "no lines spoken yet"
                : `hit rate ${hitRate}% (${phraseStats.prerendered}/${spoken}${
                    phraseStats.live ? `, ${phraseStats.live} improvised` : ""
                  })`}
            </div>
          </div>
        </div>
      </div>

      {aod && (
        <div className="aod" onClick={() => !locked && setAod(false)}>
          <div className="aod-time">{formatElapsed(elapsedMs)}</div>
          <div className="aod-stats">
            {treadmill ? (
              <>
                <span>{formatElapsed(Math.max(0, targetMin * 60_000 - elapsedMs))} left</span>
                <span>{clock}</span>
              </>
            ) : (
              <>
                <span>{distanceKm.toFixed(2)} km</span>
                <span>
                  {formatInUnit(speeds.now, speedUnit)} {unitSuffix(speedUnit)}
                </span>
                <span>{clock}</span>
              </>
            )}
          </div>
          {!treadmill && gpsTrouble && <div className="aod-gps">⚠ {gps.label}</div>}
          <div className="aod-hint">
            {locked ? "screen locked · coach keeps talking" : "tap anywhere to wake · coach keeps talking"}
          </div>
        </div>
      )}

      {locked && (
        <div
          className="lock-overlay"
          onClickCapture={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
        >
          <div className="lock-badge">Screen locked</div>
          <button
            className="unlock-pad"
            aria-label="Hold to unlock"
            onPointerDown={startHold}
            onPointerUp={releaseHold}
            onPointerLeave={releaseHold}
            onPointerCancel={releaseHold}
            onContextMenu={(e) => e.preventDefault()}
          >
            <span
              className="unlock-fill"
              style={{ transform: `scaleX(${holdPct / 100})` }}
            />
            <span className="unlock-text">
              {holdPct >= 100
                ? "Release to unlock"
                : holdPct > 0
                  ? "Keep holding…"
                  : "Hold to unlock"}
            </span>
          </button>
        </div>
      )}

      {confirmEnd && (
        <div className="end-confirm-overlay" onClick={() => setConfirmEnd(false)}>
          <div className="end-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="end-confirm-title">End this run?</div>
            <div className="end-confirm-actions">
              <button className="cta secondary" onClick={() => setConfirmEnd(false)}>
                Keep running
              </button>
              <button className="cta" onClick={doEndRun}>
                End run
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
