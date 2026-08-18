"use client";

import { useEffect, useState } from "react";
import SetupScreen from "./SetupScreen";
import LandingScreen from "./LandingScreen";
import HomeScreen, { type AuthUser, type RunSummary } from "./HomeScreen";
import RunDetailScreen from "./RunDetailScreen";
import RunScreen from "./RunScreen";
import SummaryScreen from "./SummaryScreen";
import AdminScreen from "./AdminScreen";
import { PERSONAS } from "@/lib/personas";
import { ensureVoiceLibrary } from "@/lib/voiceLibrary";
import { loadSpeedUnit, saveSpeedUnit, type SpeedUnit } from "@/lib/units";
import {
  CHATTINESS_DEFAULT,
  START_DELAY_SEC,
  loadAutoPause,
  loadDistanceCorrection,
  loadChattiness,
  loadTargetKm,
  loadTargetMin,
  loadStartDelay,
  loadGuestChoice,
  saveGuestChoice,
  saveAutoPause,
  saveDistanceCorrection,
  saveChattiness,
  saveStartDelay,
  saveTargetKm,
  saveTargetMin,
} from "@/lib/prefs";
import type { MusicSource, PersonaId, RunStats } from "@/lib/types";

type Screen = "boot" | "landing" | "home" | "setup" | "run" | "summary" | "admin" | "runDetail";

interface AuthState {
  configured: boolean;
  historyAvailable: boolean;
  user: AuthUser | null;
}

export default function RunBuddyApp() {
  const [screen, setScreen] = useState<Screen>("boot");
  const [auth, setAuth] = useState<AuthState>({
    configured: false,
    historyAvailable: false,
    user: null,
  });
  const [openRun, setOpenRun] = useState<RunSummary | null>(null);
  const [personaId, setPersonaId] = useState<PersonaId>("ahbeng");
  const [music, setMusic] = useState<MusicSource>("spotify");
  const [finalStats, setFinalStats] = useState<RunStats | null>(null);
  const [speedUnit, setSpeedUnitState] = useState<SpeedUnit>("kmh");
  const [chattiness, setChattinessState] = useState(CHATTINESS_DEFAULT);
  const [targetKm, setTargetKmState] = useState(0);
  const [targetMin, setTargetMinState] = useState(0);
  const [autoPause, setAutoPauseState] = useState(true);
  const [distanceCorrection, setDistanceCorrectionState] = useState(true);
  const [startDelay, setStartDelayState] = useState(false);

  // Boot: who are we, and does sign-in even exist here? Unconfigured or
  // unreachable resolves to the app exactly as it was before accounts —
  // straight into setup, nothing new on screen.
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: AuthState | null) => {
        if (cancelled) return;
        const state = data ?? { configured: false, historyAvailable: false, user: null };
        setAuth(state);
        if (state.user) setScreen("home");
        else if (!state.configured || loadGuestChoice()) setScreen("setup");
        else setScreen("landing");
      })
      .catch(() => {
        if (!cancelled) setScreen("setup");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSpeedUnitState(loadSpeedUnit());
    setChattinessState(loadChattiness());
    setTargetKmState(loadTargetKm());
    setTargetMinState(loadTargetMin());
    setAutoPauseState(loadAutoPause());
    setDistanceCorrectionState(loadDistanceCorrection());
    setStartDelayState(loadStartDelay());
  }, []);

  const setTargetKm = (v: number) => {
    setTargetKmState(v);
    saveTargetKm(v);
  };

  const setTargetMin = (v: number) => {
    setTargetMinState(v);
    saveTargetMin(v);
  };

  const setAutoPause = (on: boolean) => {
    setAutoPauseState(on);
    saveAutoPause(on);
  };

  const setDistanceCorrection = (on: boolean) => {
    setDistanceCorrectionState(on);
    saveDistanceCorrection(on);
  };

  const setStartDelay = (on: boolean) => {
    setStartDelayState(on);
    saveStartDelay(on);
  };


  const setSpeedUnit = (unit: SpeedUnit) => {
    setSpeedUnitState(unit);
    saveSpeedUnit(unit);
  };

  const setChattiness = (v: number) => {
    setChattinessState(v);
    saveChattiness(v);
  };

  // Keep the browser chrome (iOS status bar, PWA title bar) on the same ground
  // as the screen under it. The static viewport export can only name one
  // colour, and this app has two grounds — paper everywhere, ink during a run.
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", screen === "run" ? "#211c15" : "#f5efe2");
  }, [screen]);

  // First launch after deploy: quietly top up the voice library through the
  // server's ElevenLabs key. No-ops when everything is already rendered or
  // rendering isn't configured; the admin screen has the visible controls.
  useEffect(() => {
    void ensureVoiceLibrary(() => {});
  }, []);

  const persona = PERSONAS[personaId];

  return (
    // --persona, not --accent: the brand rust owns chrome and actions, and the
    // trainer's own colour is reserved for marking which trainer this is.
    <div
      className={`app${screen === "run" ? " theme-ink" : ""}`}
      style={{ "--persona": persona.accent } as React.CSSProperties}
    >
      {screen === "boot" && null}
      {screen === "landing" && (
        <LandingScreen
          onGuest={() => {
            saveGuestChoice(true);
            setScreen("setup");
          }}
        />
      )}
      {screen === "home" && auth.user && (
        <HomeScreen
          user={auth.user}
          historyAvailable={auth.historyAvailable}
          onStart={() => setScreen("setup")}
          onOpenRun={(run) => {
            setOpenRun(run);
            setScreen("runDetail");
          }}
          onSignOut={() => {
            void fetch("/api/auth/logout", { method: "POST" }).finally(() => {
              saveGuestChoice(false);
              setAuth((a) => ({ ...a, user: null }));
              setScreen("landing");
            });
          }}
        />
      )}
      {screen === "runDetail" && openRun && (
        <RunDetailScreen
          run={openRun}
          onBack={() => setScreen("home")}
          onDeleted={() => {
            setOpenRun(null);
            setScreen("home");
          }}
        />
      )}
      {screen === "setup" && (
        <SetupScreen
          personaId={personaId}
          onPersonaChange={setPersonaId}
          music={music}
          onMusicChange={setMusic}
          onStart={() => setScreen("run")}
          onAdmin={() => setScreen("admin")}
          onHome={auth.user ? () => setScreen("home") : undefined}
          showSignIn={auth.configured && !auth.user}
          speedUnit={speedUnit}
          onSpeedUnitChange={setSpeedUnit}
          chattiness={chattiness}
          onChattinessChange={setChattiness}
          targetKm={targetKm}
          onTargetKmChange={setTargetKm}
          targetMin={targetMin}
          onTargetMinChange={setTargetMin}
          autoPause={autoPause}
          onAutoPauseChange={setAutoPause}
          distanceCorrection={distanceCorrection}
          onDistanceCorrectionChange={setDistanceCorrection}
          startDelay={startDelay}
          onStartDelayChange={setStartDelay}
        />
      )}
      {screen === "admin" && <AdminScreen onBack={() => setScreen("setup")} />}
      {screen === "run" && (
        <RunScreen
          persona={persona}
          music={music}
          speedUnit={speedUnit}
          onSpeedUnitChange={setSpeedUnit}
          chattiness={chattiness}
          onChattinessChange={setChattiness}
          targetKm={targetKm}
          targetMin={targetMin}
          autoPause={autoPause}
          distanceCorrection={distanceCorrection}
          startDelaySec={startDelay ? START_DELAY_SEC : 0}
          onFinish={(stats) => {
            setFinalStats(stats);
            setScreen("summary");
            // Best-effort history save. The server drops sub-minute or
            // sub-50m runs on purpose — those are pocket-starts, not runs.
            if (auth.user && auth.historyAvailable) {
              void fetch("/api/runs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ personaId, stats }),
              }).catch(() => {});
            }
          }}
        />
      )}
      {screen === "summary" && finalStats && (
        <SummaryScreen
          persona={persona}
          stats={finalStats}
          speedUnit={speedUnit}
          onDone={() => {
            setFinalStats(null);
            setScreen(auth.user ? "home" : "setup");
          }}
        />
      )}
    </div>
  );
}
