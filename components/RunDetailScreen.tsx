"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatElapsed, formatPace } from "@/lib/geo";
import { PERSONAS } from "@/lib/personas";
import { loadCardBg } from "@/lib/prefs";
import { drawRunCard, shareOrDownloadCard } from "@/lib/runCard";
import { loadSpeedUnit } from "@/lib/units";
import HealthPanel from "./HealthPanel";
import RouteTileMap from "./RouteTileMap";
import type { PersonaId, RunStats } from "@/lib/types";
import type { RunSummary } from "./HomeScreen";

interface Props {
  run: RunSummary;
  onBack: () => void;
  onDeleted: () => void;
  /** Where this run's payload lives. Admin passes its per-user route. */
  apiBase?: string;
  /**
   * Admin view of someone else's run: everything the runner sees, minus the
   * actions that belong to the owner (conform, delete) and the Health panel,
   * which reads the VIEWER's HealthKit and would show the admin's own data
   * against another runner's window.
   */
  readOnly?: boolean;
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

export default function RunDetailScreen({
  run,
  onBack,
  onDeleted,
  apiBase = "/api/runs",
  readOnly = false,
}: Props) {
  const [stats, setStats] = useState<RunStats | null>(null);
  const [payload, setPayload] = useState<unknown>(null);
  const [failed, setFailed] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Conforming to the Watch re-saves the run under a NEW id (the basename
  // encodes distance) — every later call must use the current one.
  const [runId, setRunId] = useState(run.id);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cardUrl, setCardUrl] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);

  /** Same adopt-the-Watch-distance flow as the summary, days later. */
  const conformDistance = async (w: { distanceKm: number; source: string }) => {
    try {
      const res = await fetch(`${apiBase}/${encodeURIComponent(runId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ distanceKm: w.distanceKm, source: w.source }),
      });
      if (!res.ok) return false;
      const data: { id: string; stats: RunStats } = await res.json();
      setRunId(data.id);
      setStats(data.stats);
      return true;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    let cancelled = false;
    void fetch(`${apiBase}/${encodeURIComponent(run.id)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { stats: RunStats }) => {
        if (cancelled) return;
        setStats(data.stats);
        setPayload(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [run.id]);

  // The run's raw record, as a file — for backup, or for debugging distance
  // questions (the gps block + route are the evidence). Share sheet first so
  // an iPhone can AirDrop / message it; plain download elsewhere.
  const exportData = async () => {
    if (!payload) return;
    const name = `runbuddy-${new Date(run.startedAt).toISOString().slice(0, 10)}.json`;
    const blob = new Blob([JSON.stringify(payload, null, 1)], { type: "application/json" });
    const file = new File([blob], name, { type: "application/json" });
    const nav = navigator as Navigator & {
      canShare?: (d?: ShareData) => boolean;
      share?: (d?: ShareData) => Promise<void>;
    };
    if (nav.canShare?.({ files: [file] }) && nav.share) {
      try {
        await nav.share({ files: [file] });
        return;
      } catch {
        /* dismissed or unsupported — fall through to download */
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const doDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`${apiBase}/${encodeURIComponent(runId)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      onDeleted();
    } catch {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  const persona = PERSONAS[run.personaId as PersonaId];
  const treadmill = run.distanceKm === 0;

  // The same shareable card the summary shows, rebuilt from the saved stats.
  // Keyed on stats, so conforming to the Watch redraws it with the adopted
  // distance and pace. Past runs don't store the coach's closing line, so the
  // card carries the persona's stock sign-off.
  useEffect(() => {
    if (!stats || !persona) return;
    let cancelled = false;
    let bgImg: HTMLImageElement | null = null;
    const comment = persona.positive
      ? "Every step of that was yours. Be proud!"
      : "Don't get cocky ah, kanina. Same time tomorrow.";
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      drawRunCard(canvas, {
        persona,
        stats,
        unit: loadSpeedUnit(),
        comment,
        background: bgImg,
        date: new Date(run.startedAt), // the run's day, not the day it's saved
      });
      setCardUrl(canvas.toDataURL("image/png"));
    };
    const bgUrl = loadCardBg();
    if (bgUrl) {
      const img = new Image();
      img.onload = () => {
        bgImg = img;
        draw();
      };
      img.src = bgUrl;
    }
    draw();
    if (typeof document !== "undefined" && document.fonts?.status !== "loaded") {
      void document.fonts.ready.then(draw).catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [stats, persona]);

  const saveCard = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stamp = new Date(run.startedAt).toISOString().slice(0, 10);
    const result = await shareOrDownloadCard(canvas, `run-buddy-${stamp}.png`);
    setSaveNote(
      result === "shared"
        ? null
        : result === "photos"
          ? "✓ Saved to your Photos"
          : result === "downloaded"
            ? "Saved to your downloads"
            : "Couldn't save — long-press the image to save it instead"
    );
  }, [run.startedAt]);
  // Prefer the loaded (possibly just-conformed) stats over the listing row.
  const distanceKm = stats?.distanceKm ?? run.distanceKm;
  const avgPaceSec = !treadmill && distanceKm > 0 ? run.movingSec / distanceKm : null;
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
              {distanceKm.toFixed(2)} <span className="stat-unit">km</span>
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
      {/* Same GPS delivery line the summary shows, preserved with the run —
          the difference between "the run was short" and "iOS starved the
          tracker of fixes". */}
      {stats?.gps && stats.gps.avgFixGapSec !== null && (
        <div className="gps-diag">
          GPS fix every {stats.gps.avgFixGapSec.toFixed(1)}s avg · longest gap{" "}
          {Math.round(stats.gps.maxFixGapSec)}s
          {stats.gps.overCapSec >= 1 &&
            ` · ${Math.round(stats.gps.overCapSec)}s beyond the credit cap`}
          {stats.gps.bridgedKm >= 0.005 &&
            ` · correction added ${Math.round(stats.gps.bridgedKm * 1000)}m`}
          {(stats.gps.startKm ?? 0) >= 0.005 &&
            ` · start credit ${Math.round((stats.gps.startKm ?? 0) * 1000)}m`}
        </div>
      )}

      {/* The shareable card, re-buildable long after the run — and rebuilt
          live if the distance below is conformed to the Watch. */}
      <canvas ref={canvasRef} style={{ display: "none" }} />
      {cardUrl && (
        <>
          <div className="section-header">Run Card</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="run-card-img" src={cardUrl} alt="Shareable run card" />
          <button className="cta secondary save-card-btn" onClick={() => void saveCard()}>
            ⬇︎ Save run card
          </button>
          {saveNote && <div className="save-note">{saveNote}</div>}
        </>
      )}

      {/* Health syncs the Watch's workout minutes after a run ends, so the
          detail page re-asks over the run's saved wall-clock window — refresh
          here works days later, not just on the post-run summary. */}
      {!readOnly && (
        <HealthPanel
          sinceMs={run.startedAt}
          untilMs={run.startedAt + run.wallSec * 1000}
          appDistanceKm={treadmill ? null : distanceKm}
          confirmed={stats?.confirmed ?? null}
          onConfirm={treadmill ? undefined : conformDistance}
        />
      )}

      {payload !== null && (
        <button className="run-export-link" onClick={() => void exportData()}>
          ⇩ Export run data (JSON)
        </button>
      )}

      {failed && <div className="home-empty">Couldn&apos;t load the full stats for this run.</div>}
      {!failed && stats === null && <div className="home-empty">Loading…</div>}

      {readOnly ? null : (
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
      )}
    </div>
  );
}
