"use client";

import { useEffect, useRef, useState } from "react";
import { WEB_BUILD } from "@/lib/version";
import SetupScreen from "./SetupScreen";
import LandingScreen from "./LandingScreen";
import HomeScreen, { type AuthUser, type RunSummary } from "./HomeScreen";
import RunDetailScreen from "./RunDetailScreen";
import AccountScreen from "./AccountScreen";
import TabBar from "./TabBar";
import FriendsScreen, { type FeedRun } from "./FriendsScreen";
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
  loadTargetPace,
  loadStartDelay,
  loadDuoMode,
  saveDuoMode,
  saveAutoPause,
  saveChattiness,
  saveStartDelay,
  saveTargetKm,
  saveTargetMin,
  saveTargetPace,
} from "@/lib/prefs";
import type { MusicSource, PersonaId, RunStats } from "@/lib/types";
import type { RunnerInfo } from "@/lib/coach";
import { buildHistoryDigest, type RunHistoryDigest } from "@/lib/history";
import { loadPrTable } from "@/lib/efforts";
import { initNativeAuthListener, isNativeApp } from "@/lib/native";

type Screen =
  | "boot"
  | "landing"
  | "home"
  | "friends"
  | "friendRun"
  | "setup"
  | "account"
  | "run"
  | "summary"
  | "admin"
  | "runDetail";

interface AuthState {
  configured: boolean;
  historyAvailable: boolean;
  user: AuthUser | null;
  /** ADMIN_EMAIL is set server-side and this session doesn't match it. */
  adminGated?: boolean;
  isAdmin?: boolean;
}

export default function RunBuddyApp() {
  const [screen, setScreen] = useState<Screen>("boot");
  const [auth, setAuth] = useState<AuthState>({
    configured: false,
    historyAvailable: false,
    user: null,
    isAdmin: true, // ungated until the server says otherwise
  });
  const [openRun, setOpenRun] = useState<RunSummary | null>(null);
  const [openFriendRun, setOpenFriendRun] = useState<FeedRun | null>(null);
  const [runnerStats, setRunnerStats] = useState<Omit<RunnerInfo, "name"> | null>(null);
  const [runHistory, setRunHistory] = useState<RunHistoryDigest | null>(null);
  const [personalRecords, setPersonalRecords] = useState<
    { targetKm: number; sec: number; startedAt: number }[] | null
  >(null);
  const [personaId, setPersonaId] = useState<PersonaId>("ahbeng");
  const [music, setMusic] = useState<MusicSource>("spotify");
  const [finalStats, setFinalStats] = useState<RunStats | null>(null);
  // The just-saved run's id, for the summary's confirm-with-Watch button —
  // null until the save round-trips (or forever, for guests).
  const [savedRunId, setSavedRunId] = useState<string | null>(null);
  const [speedUnit, setSpeedUnitState] = useState<SpeedUnit>("kmh");
  const [chattiness, setChattinessState] = useState(CHATTINESS_DEFAULT);
  const [targetKm, setTargetKmState] = useState(0);
  const [targetMin, setTargetMinState] = useState(0);
  const [targetPaceSec, setTargetPaceSecState] = useState(0);
  const [autoPause, setAutoPauseState] = useState(true);
  const [startDelay, setStartDelayState] = useState(false);
  // Duo mode: Ah Beng + Ah Lian coach together. Forces the primary persona
  // to Ah Beng so the summary, card and saved run have a stable owner.
  const [duoMode, setDuoModeState] = useState(false);
  const setDuoMode = (on: boolean) => {
    setDuoModeState(on);
    saveDuoMode(on);
    if (on) setPersonaId("ahbeng");
  };

  // Boot: who are we, and does sign-in even exist here? Unconfigured or
  // unreachable resolves to the app exactly as it was before accounts —
  // straight into setup, nothing new on screen.
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: AuthState | null) => {
        if (cancelled) return;
        const state = data ?? {
          configured: false,
          historyAvailable: false,
          user: null,
          isAdmin: true,
        };
        setAuth(state);
        if (state.user) setScreen("home");
        else if (state.configured) setScreen("landing");
        else setScreen("setup");
      })
      .catch(() => {
        if (!cancelled) setScreen("setup");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The coach's memory: run summaries digested down to last-run figures and
  // personal bests. One listing, no body fetches. Refreshed after each save so
  // tomorrow's intro knows about today's run.
  const refreshHistory = () => {
    void fetch("/api/runs")
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (data: {
          runs: { id: string; startedAt: number; distanceKm: number; movingSec: number }[];
        } | null) => {
          if (!data?.runs) return;
          setRunHistory(buildHistoryDigest(data.runs));
          // Best 1/5/10km efforts, mined once per run and cached — the coach
          // compares the live run against these for PR announcements.
          void loadPrTable(data.runs)
            .then((table) => {
              setPersonalRecords(
                (Object.entries(table) as [string, { sec: number; startedAt: number }][]).map(
                  ([km, rec]) => ({ targetKm: Number(km), sec: rec.sec, startedAt: rec.startedAt })
                )
              );
            })
            .catch(() => {});
        }
      )
      .catch(() => {});
  };

  // Once signed in, pull the saved body stats so the coach can personalize
  // its improvised lines. Missing or failed just means an anonymous run.
  useEffect(() => {
    if (!auth.user) {
      setRunnerStats(null);
      setRunHistory(null);
      setPersonalRecords(null);
      return;
    }
    if (auth.historyAvailable) refreshHistory();
    let cancelled = false;
    void fetch("/api/profile")
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (data: {
          profile: {
            age: number | null;
            heightCm: number | null;
            weightKg: number | null;
            gender: "female" | "male" | null;
            homeCity: string | null;
          };
        } | null) => {
          if (cancelled || !data) return;
          setRunnerStats({
            age: data.profile.age ?? undefined,
            heightCm: data.profile.heightCm ?? undefined,
            weightKg: data.profile.weightKg ?? undefined,
            gender: data.profile.gender ?? undefined,
            homeCity: data.profile.homeCity ?? undefined,
          });
        }
      )
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user, auth.historyAvailable]);

  useEffect(() => {
    setSpeedUnitState(loadSpeedUnit());
    setChattinessState(loadChattiness());
    setTargetKmState(loadTargetKm());
    setTargetMinState(loadTargetMin());
    setTargetPaceSecState(loadTargetPace());
    setAutoPauseState(loadAutoPause());
    setStartDelayState(loadStartDelay());
    if (loadDuoMode()) {
      setDuoModeState(true);
      setPersonaId("ahbeng");
    }
  }, []);

  const setTargetKm = (v: number) => {
    setTargetKmState(v);
    saveTargetKm(v);
  };

  const setTargetMin = (v: number) => {
    setTargetMinState(v);
    saveTargetMin(v);
  };

  const setTargetPaceSec = (v: number) => {
    setTargetPaceSecState(v);
    saveTargetPace(v);
  };

  const setAutoPause = (on: boolean) => {
    setAutoPauseState(on);
    saveAutoPause(on);
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

  // Inside the native shell only: catch the sign-in deep link. A no-op in
  // every browser — the Capacitor modules aren't even loaded there.
  useEffect(() => {
    if (isNativeApp()) void initNativeAuthListener();
  }, []);

  // Shell auto-refresh: the WebView only refetches the site on a cold
  // launch, so a phone can show last week's build indefinitely. On each
  // return to foreground (throttled), ask the server which build it's on
  // and reload when it's newer — never mid-run or on the summary, where a
  // reload would eat live state.
  const screenRef = useRef(screen);
  screenRef.current = screen;
  useEffect(() => {
    if (!isNativeApp()) return;
    let lastCheck = 0;
    let removed = false;
    let remove: (() => void) | null = null;
    const check = async () => {
      if (Date.now() - lastCheck < 5 * 60_000) return;
      lastCheck = Date.now();
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const data: { build?: string } = await res.json();
        if (!data.build || data.build === WEB_BUILD) return;
        if (screenRef.current === "run" || screenRef.current === "summary") return;
        window.location.reload();
      } catch {
        /* offline — next foreground tries again */
      }
    };
    void import("@capacitor/app").then(({ App }) =>
      App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) void check();
      }).then((h) => {
        if (removed) h.remove();
        else remove = () => h.remove();
      })
    );
    return () => {
      removed = true;
      remove?.();
    };
  }, []);

  const persona = PERSONAS[personaId];

  return (
    // --persona, not --accent: the brand rust owns chrome and actions, and the
    // trainer's own colour is reserved for marking which trainer this is.
    <div
      className={`app${screen === "run" ? " theme-ink" : ""}`}
      style={{ "--persona": persona.accent } as React.CSSProperties}
    >
      {/* keyed by screen so each one opens scrolled to the top */}
      <div className="screen-scroll" key={screen}>
      {screen === "boot" && null}
      {screen === "account" && (
        <AccountScreen
          user={auth.user}
          configured={auth.configured}
          historyAvailable={auth.historyAvailable}
          onProfileSaved={(p) =>
            setRunnerStats({
              age: p.age ?? undefined,
              heightCm: p.heightCm ?? undefined,
              weightKg: p.weightKg ?? undefined,
              gender: p.gender ?? undefined,
            })
          }
          onSignOut={() => {
            void fetch("/api/auth/logout", { method: "POST" }).finally(() => {
              setAuth((a) => ({ ...a, user: null }));
              setScreen("landing");
            });
          }}
        />
      )}
      {screen === "landing" && (
        <LandingScreen
          onGuest={() => setScreen("setup")}
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
          commentsUrlFor={(id) => `/api/runs/${encodeURIComponent(id)}/comments`}
        />
      )}
      {screen === "friends" && auth.user && (
        <FriendsScreen
          onOpenRun={(run) => {
            setOpenFriendRun(run);
            setScreen("friendRun");
          }}
        />
      )}
      {screen === "friendRun" && openFriendRun && (
        <RunDetailScreen
          run={openFriendRun}
          readOnly
          apiBase={`/api/friends/runs/${openFriendRun.friendUid}`}
          onBack={() => setScreen("friends")}
          onDeleted={() => setScreen("friends")}
          commentsUrlFor={(id) =>
            `/api/friends/runs/${openFriendRun.friendUid}/${encodeURIComponent(id)}/comments`
          }
          cardBgSrc={`/api/friends/card-bg/${openFriendRun.friendUid}`}
        />
      )}
      {screen === "setup" && (
        <SetupScreen
          personaId={personaId}
          onPersonaChange={setPersonaId}
          duoMode={duoMode}
          onDuoChange={setDuoMode}
          music={music}
          onMusicChange={setMusic}
          speedUnit={speedUnit}
          onSpeedUnitChange={setSpeedUnit}
          chattiness={chattiness}
          onChattinessChange={setChattiness}
          targetKm={targetKm}
          onTargetKmChange={setTargetKm}
          targetMin={targetMin}
          onTargetMinChange={setTargetMin}
          targetPaceSec={targetPaceSec}
          onTargetPaceSecChange={setTargetPaceSec}
          autoPause={autoPause}
          onAutoPauseChange={setAutoPause}
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
          targetPaceSec={targetPaceSec}
          autoPause={autoPause}
          startDelaySec={startDelay ? START_DELAY_SEC : 0}
          runner={
            auth.user
              ? {
                  // First name only — that's how a coach talks to you.
                  name: auth.user.name.trim().split(/\s+/)[0] || undefined,
                  ...runnerStats,
                }
              : null
          }
          history={runHistory}
          personalRecords={personalRecords}
          onPersonaChange={setPersonaId}
          duoWith={duoMode ? "ahlian" : null}
          onFinish={(stats) => {
            setFinalStats(stats);
            setSavedRunId(null);
            setScreen("summary");
            // Best-effort history save. The server drops sub-minute or
            // sub-50m runs on purpose — those are pocket-starts, not runs.
            if (auth.user && auth.historyAvailable) {
              void fetch("/api/runs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ personaId, stats }),
              })
                .then((res) => (res.ok ? res.json() : null))
                .then((data: { id?: string } | null) => {
                  if (data?.id) setSavedRunId(data.id);
                  refreshHistory(); // next run's coach knows this one
                })
                .catch(() => {});
            }
          }}
        />
      )}
      {screen === "summary" && finalStats && (
        <SummaryScreen
          persona={persona}
          stats={finalStats}
          runId={savedRunId}
          speedUnit={speedUnit}
          onDone={() => {
            setFinalStats(null);
            setSavedRunId(null);
            setScreen(auth.user ? "home" : "setup");
          }}
        />
      )}
      </div>
      {screen !== "run" && screen !== "boot" && (
        <TabBar
          active={
            screen === "setup"
              ? "setup"
              : screen === "account"
                ? "account"
                : screen === "friends" || screen === "friendRun"
                  ? "friends"
                  : screen === "home" || screen === "runDetail"
                    ? "home"
                    : undefined
          }
          showHome={auth.configured || !!auth.user}
          showFriends={!!auth.user}
          showAdmin={auth.isAdmin !== false}
          runLabel={screen === "setup" ? "START RUN" : "GET READY"}
          onHome={() => setScreen(auth.user ? "home" : "landing")}
          onFriends={() => setScreen("friends")}
          onRun={() => setScreen(screen === "setup" ? "run" : "setup")}
          onAccount={() => setScreen("account")}
          onAdmin={() => setScreen("admin")}
        />
      )}
    </div>
  );
}
