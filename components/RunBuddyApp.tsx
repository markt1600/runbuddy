"use client";

import { useState } from "react";
import SetupScreen from "./SetupScreen";
import RunScreen from "./RunScreen";
import SummaryScreen from "./SummaryScreen";
import { PERSONAS } from "@/lib/personas";
import type { MusicSource, PersonaId, RunStats } from "@/lib/types";

type Screen = "setup" | "run" | "summary";

export default function RunBuddyApp() {
  const [screen, setScreen] = useState<Screen>("setup");
  const [personaId, setPersonaId] = useState<PersonaId>("ahbeng");
  const [music, setMusic] = useState<MusicSource>("spotify");
  const [finalStats, setFinalStats] = useState<RunStats | null>(null);

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
        />
      )}
      {screen === "run" && (
        <RunScreen
          persona={persona}
          music={music}
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
