"use client";

import { useEffect, useState } from "react";
import SetupScreen from "./SetupScreen";
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
  loadChattiness,
  loadTargetKm,
  loadTargetMin,
  loadVoiceGain,
  loadStartDelay,
  saveAutoPause,
  saveChattiness,
  saveVoiceGain,
  saveStartDelay,
  saveTargetKm,
  saveTargetMin,
} from "@/lib/prefs";
import type { MusicSource, PersonaId, RunStats } from "@/lib/types";

type Screen = "setup" | "run" | "summary" | "admin";

export default function RunBuddyApp() {
  const [screen, setScreen] = useState<Screen>("setup");
  const [personaId, setPersonaId] = useState<PersonaId>("ahbeng");
  const [music, setMusic] = useState<MusicSource>("spotify");
  const [finalStats, setFinalStats] = useState<RunStats | null>(null);
  const [speedUnit, setSpeedUnitState] = useState<SpeedUnit>("kmh");
  const [chattiness, setChattinessState] = useState(CHATTINESS_DEFAULT);
  const [targetKm, setTargetKmState] = useState(0);
  const [targetMin, setTargetMinState] = useState(0);
  const [autoPause, setAutoPauseState] = useState(true);
  const [startDelay, setStartDelayState] = useState(false);
  const [voiceGain, setVoiceGainState] = useState(1.6);

  useEffect(() => {
    setSpeedUnitState(loadSpeedUnit());
    setChattinessState(loadChattiness());
    setTargetKmState(loadTargetKm());
    setTargetMinState(loadTargetMin());
    setAutoPauseState(loadAutoPause());
    setStartDelayState(loadStartDelay());
    setVoiceGainState(loadVoiceGain());
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

  const setStartDelay = (on: boolean) => {
    setStartDelayState(on);
    saveStartDelay(on);
  };

  const setVoiceGain = (v: number) => {
    setVoiceGainState(v);
    saveVoiceGain(v);
  };

  const setSpeedUnit = (unit: SpeedUnit) => {
    setSpeedUnitState(unit);
    saveSpeedUnit(unit);
  };

  const setChattiness = (v: number) => {
    setChattinessState(v);
    saveChattiness(v);
  };

  // First launch after deploy: quietly top up the voice library through the
  // server's ElevenLabs key. No-ops when everything is already rendered or
  // rendering isn't configured; the admin screen has the visible controls.
  useEffect(() => {
    void ensureVoiceLibrary(() => {});
  }, []);

  const persona = PERSONAS[personaId];

  return (
    <div className="app" style={{ "--accent": persona.accent } as React.CSSProperties}>
      {screen === "setup" && (
        <SetupScreen
          personaId={personaId}
          onPersonaChange={setPersonaId}
          music={music}
          onMusicChange={setMusic}
          onStart={() => setScreen("run")}
          onAdmin={() => setScreen("admin")}
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
          startDelay={startDelay}
          onStartDelayChange={setStartDelay}
          voiceGain={voiceGain}
          onVoiceGainChange={setVoiceGain}
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
          startDelaySec={startDelay ? START_DELAY_SEC : 0}
          voiceGain={voiceGain}
          onFinish={(stats) => {
            setFinalStats(stats);
            setScreen("summary");
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
            setScreen("setup");
          }}
        />
      )}
    </div>
  );
}
