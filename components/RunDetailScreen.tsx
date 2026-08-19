"use client";

import { useEffect, useState } from "react";
import { formatElapsed, formatPace } from "@/lib/geo";
import { PERSONAS } from "@/lib/personas";
import RouteTileMap from "./RouteTileMap";
import type { PersonaId, RunStats } from "@/lib/types";
import type { RunSummary } from "./HomeScreen";

interface Props {
  run: RunSummary;
  onBack: () => void;
  onDeleted: () => void;
}

/** Split bars, one per kilometre. Longer bar = faster split (the way a runner
 *  reads pace), the fastest highlighted in the accent. Pure markup — a chart
 *  library would be the heaviest thing in the app. */
function SplitChart({ splits }: { splits: number[] }) {
  const fastest = Math.min(...splits);
  return (
    <div className="split-chart">
      {splits.map((ms, i) => {
        const isFastest = ms === fastest;
        return (
          <div className="split-chart-row" key={i}>
            <span className="split-chart-km">{i + 1}</span>
            <div className="split-chart-track">
              <div
                className={`split-chart-bar${isFastest ? " fastest" : ""}`}
                style={{ width: `${Math.max(8, (fastest / ms) * 100)}%` }}
              />
            </div>
            <span className={`split-chart-time${isFastest ? " fastest" : ""}`}>
              {formatElapsed(ms)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function RunDetailScreen({ run, onBack, onDeleted }: Props) {
  const [stats, setStats] = useState<RunStats | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/runs/${encodeURIComponent(run.id)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { stats: RunStats }) => {
        if (!cancelled) setStats(data.stats);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [run.id]);

  const doDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(run.id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      onDeleted();
    } catch {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  const persona = PERSONAS[run.personaId as PersonaId];
  const treadmill = run.distanceKm === 0;
  const avgPaceSec =
    !treadmill && run.distanceKm > 0 ? run.movingSec / run.distanceKm : null;
  const splits = stats?.splits ?? [];
  const fastestSplit = splits.length > 0 ? Math.min(...splits) : null;

  return (
    <div className="fade-in run-detail">
      <div className="admin-topbar">
        <button className="back-link" onClick={onBack}>
          ‹ Runs
        </button>
        <div className="admin-title">
          {new Date(run.startedAt).toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </div>
      </div>
      <p className="run-detail-sub">
        {new Date(run.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        {persona ? ` · with ${persona.name} ${persona.emoji}` : ""}
      </p>

      <div className="stat-grid" style={{ marginTop: 18 }}>
        {!treadmill && (
          <div className="stat-cell">
            <div className="stat-value">
              {run.distanceKm.toFixed(2)} <span className="stat-unit">km</span>
            </div>
            <div className="stat-label">Distance</div>
          </div>
        )}
        {!treadmill && (
          <div className="stat-cell">
            <div className="stat-value">{formatPace(avgPaceSec)}</div>
            <div className="stat-label">Avg pace / km</div>
          </div>
        )}
        <div className="stat-cell">
          <div className="stat-value">{formatElapsed(run.movingSec * 1000)}</div>
          <div className="stat-label">Moving time</div>
        </div>
        <div className="stat-cell">
          <div className="stat-value">{formatElapsed(run.wallSec * 1000)}</div>
          <div className="stat-label">Total elapsed</div>
        </div>
        {fastestSplit !== null && (
          <div className="stat-cell">
            <div className="stat-value">{formatElapsed(fastestSplit)}</div>
            <div className="stat-label">Fastest split</div>
          </div>
        )}
      </div>

      {(stats?.route?.length ?? 0) >= 2 && (
        <>
          <div className="section-header">Route</div>
          <RouteTileMap route={stats!.route} accent={persona?.accent ?? "#bb3b22"} />
        </>
      )}

      {splits.length > 0 && (
        <>
          <div className="section-header">Kilometre Splits</div>
          <div className="card" style={{ padding: "14px 16px" }}>
            <SplitChart splits={splits} />
          </div>
        </>
      )}
      {failed && <div className="home-empty">Couldn&apos;t load the full stats for this run.</div>}
      {!failed && stats === null && <div className="home-empty">Loading…</div>}

      <div className="run-detail-danger">
        {confirmingDelete ? (
          <div className="run-delete-confirm">
            <span className="run-delete-question">Delete this run forever?</span>
            <button className="cta danger" disabled={deleting} onClick={doDelete}>
              {deleting ? "Deleting…" : "Yes, delete it"}
            </button>
            <button
              className="cta secondary"
              disabled={deleting}
              onClick={() => setConfirmingDelete(false)}
            >
              Keep it
            </button>
          </div>
        ) : (
          <button className="run-delete-link" onClick={() => setConfirmingDelete(true)}>
            Delete this run
          </button>
        )}
      </div>
    </div>
  );
}
