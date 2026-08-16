"use client";

import { useEffect, useState } from "react";
import SetupScreen from "./SetupScreen";
import RunScreen from "./RunScreen";
import SummaryScreen from "./SummaryScreen";
import AdminScreen from "./AdminScreen";
import { PERSONAS } from "@/lib/personas";
import { ensureVoiceLibrary } from "@/lib/voiceLibrary";
import { loadSpeedUnit, saveSpeedUnit, type SpeedUnit } from "@/lib/units";
import type { MusicSource, PersonaId, RunStats } from "@/lib/types";

type Screen = "setup" | "run" | "summary" | "admin";

export default function RunBuddyApp() {
  const [screen, setScreen] = useState<Screen>("setup");
  const [personaId, setPersonaId] = useState<PersonaId>("ahbeng");
  const [music, setMusic] = useState<MusicSource>("spotify");
  const [finalStats, setFinalStats] = useState<RunStats | null>(null);
  const [speedUnit, setSpeedUnitState] = useState<SpeedUnit>("kmh");

  useEffect(() => {
    setSpeedUnitState(loadSpeedUnit());
  }, []);

  const setSpeedUnit = (unit: SpeedUnit) => {
    setSpeedUnitState(unit);
    saveSpeedUnit(unit);
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
        />
      )}
      {screen === "admin" && <AdminScreen onBack={() => setScreen("setup")} />}
      {screen === "run" && (
        <RunScreen
          persona={persona}
          music={music}
          speedUnit={speedUnit}
          onSpeedUnitChange={setSpeedUnit}
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
          onDone={() => {
            setFinalStats(null);
            setScreen("setup");
          }}
        />
      )}
    </div>
  );
}
