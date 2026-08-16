"use client";

import { useEffect, useState } from "react";
import SetupScreen from "./SetupScreen";
import RunScreen from "./RunScreen";
import SummaryScreen from "./SummaryScreen";
import { PERSONAS } from "@/lib/personas";
import { ensureVoiceLibrary, type GenerationProgress } from "@/lib/voiceLibrary";
import type { MusicSource, PersonaId, RunStats } from "@/lib/types";

type Screen = "setup" | "run" | "summary";

export default function RunBuddyApp() {
  const [screen, setScreen] = useState<Screen>("setup");
  const [personaId, setPersonaId] = useState<PersonaId>("ahbeng");
  const [music, setMusic] = useState<MusicSource>("spotify");
  const [finalStats, setFinalStats] = useState<RunStats | null>(null);
  const [genProgress, setGenProgress] = useState<GenerationProgress | null>(null);

  // First launch after deploy: top up the voice library through the server's
  // ElevenLabs key, one phrase at a time, with visible progress. No-ops when
  // everything is already rendered or rendering isn't configured.
  useEffect(() => {
    void ensureVoiceLibrary(setGenProgress);
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
          genProgress={genProgress}
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
