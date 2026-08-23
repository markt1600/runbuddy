"use client";

import { useEffect, useState } from "react";
import { loadPrTable, type PrTable } from "@/lib/efforts";
import { formatElapsed, formatPace } from "@/lib/geo";
import { PERSONAS } from "@/lib/personas";
import type { PersonaId } from "@/lib/types";

export interface RunSummary {
  id: string;
  startedAt: number;
  distanceKm: number;
  movingSec: number;
  wallSec: number;
  personaId: string;
}

export interface AuthUser {
  name: string;
  picture: string | null;
  email?: string | null;
}

interface Props {
  user: AuthUser;
  historyAvailable: boolean;
  onOpenRun: (run: RunSummary) => void;
  /** First-run empty state: a big obvious way into setup, mid-screen. */
  onStart: () => void;
}

function runDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function runTimeOfDay(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function HomeScreen({ user, historyAvailable, onOpenRun, onStart }: Props) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [prs, setPrs] = useState<PrTable | null>(null);

  useEffect(() => {
    if (!historyAvailable) return;
    let cancelled = false;
    void fetch("/api/runs")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { runs: RunSummary[] }) => {
        if (cancelled) return;
        setRuns(data.runs);
        // Best 1/5/10km efforts — cached per run, so this is instant after
        // the first visit and only mines newly saved runs.
        void loadPrTable(data.runs)
          .then((table) => {
            if (!cancelled) setPrs(table);
          })
          .catch(() => {});
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [historyAvailable]);

  const firstName = user.name.split(" ")[0] || "runner";

  return (
    <div className="fade-in home">
      <h1 className="large-title">Run Buddy</h1>
      <p className="subtitle">Welcome back, {firstName}.</p>

      {/* Best rolling 1/5/10km efforts across every saved run — mined from
          the route traces, not just whole-km splits. The coach beats these
          live mid-run; here they're the scoreboard. */}
      {prs && (prs["1"] || prs["5"] || prs["10"]) && (
        <>
          <div className="section-header">Personal Records</div>
          <div className="card pr-board">
            {(["1", "5", "10"] as const).map((key) => {
              const rec = prs[key];
              if (!rec) return null;
              const paceSec = rec.sec / Number(key);
              return (
                <div className="pr-row" key={key}>
                  <span className="pr-dist">🏅 {key} km</span>
                  <span className="pr-time">{formatElapsed(rec.sec * 1000)}</span>
                  <span className="pr-sub">
                    {formatPace(paceSec)} /km · {runDate(rec.startedAt)}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="section-header">Your Runs</div>
      {!historyAvailable ? (
        <div className="home-empty">
          Run history needs a Vercel Blob store — connect one and redeploy.
        </div>
      ) : failed ? (
        <div className="home-empty">Couldn&apos;t load your runs. Pull to refresh, or try again later.</div>
      ) : runs === null ? (
        <div className="home-empty">Loading your runs…</div>
      ) : runs.length === 0 ? (
        <div className="home-first-run">
          <div className="home-first-emoji">🏃</div>
          <p className="home-first-title">No runs saved yet.</p>
          <p className="home-empty">
            Time to change that — pick a trainer, press start, and your first run
            will show up right here with its pace and splits.
          </p>
          <button className="cta home-start-cta" onClick={onStart}>
            Get Ready to Run
          </button>
        </div>
      ) : (
        <div className="run-list">
          {runs.map((run) => {
            const persona = PERSONAS[run.personaId as PersonaId];
            const treadmill = run.distanceKm === 0;
            const pace = !treadmill && run.distanceKm > 0 ? run.movingSec / run.distanceKm : null;
            return (
              <button className="run-card" key={run.id} onClick={() => onOpenRun(run)}>
                <div className="run-card-emoji">{persona?.emoji ?? "🏃"}</div>
                <div className="run-card-main">
                  <div className="run-card-date">
                    {runDate(run.startedAt)} · {runTimeOfDay(run.startedAt)}
                  </div>
                  <div className="run-card-figures">
                    {treadmill ? (
                      <span className="run-card-km">{formatElapsed(run.movingSec * 1000)}</span>
                    ) : (
                      <>
                        <span className="run-card-km">
                          {run.distanceKm.toFixed(2)}
                          <span className="run-card-unit"> km</span>
                        </span>
                        <span className="run-card-sub">{formatElapsed(run.movingSec * 1000)}</span>
                        <span className="run-card-sub">{formatPace(pace)} /km</span>
                      </>
                    )}
                  </div>
                </div>
                <span className="run-card-chevron">›</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
