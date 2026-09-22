"use client";

import { useCallback, useEffect, useState } from "react";
import { formatElapsed } from "@/lib/geo";
import { isNativeApp, runBuddyNative, type HealthRunSummary } from "@/lib/native";

// What Apple Health saw over a run's window — read-only, never stored, shown
// so its numbers can be eyeballed against the app's own. Used on the post-run
// summary AND the run detail page: the Watch can sync its workout minutes
// after the run ends, so "look again later" is the realistic use, and the
// refresh button re-asks Health on the spot. Renders nothing outside the
// native shell (browsers can't reach HealthKit).
//
// Two shapes: the classic card (run detail), and a collapsible row for the
// summary, whose header carries the one thing that matters at a glance —
// whether the Watch agrees with the app, and if not, the conform button.

interface Props {
  /** The run's wall-clock window, ms epoch. */
  sinceMs: number;
  untilMs: number;
  /** The app's own distance for the side-by-side; null for treadmill runs. */
  appDistanceKm?: number | null;
  /** Already confirmed against a device (persisted on the run). */
  confirmed?: { source: string; appDistanceKm: number } | null;
  /**
   * Offered on the summary: adopt the workout's distance as the run's
   * official one. Resolves true when the run was updated.
   */
  onConfirm?: (w: { distanceKm: number; source: string }) => Promise<boolean>;
  /** "card" (default): the full panel. "row": a collapsible summary row. */
  variant?: "card" | "row";
}

/**
 * Below this the Watch and the app are reading the same run: conforming would
 * only shuffle the second decimal, so the button gives way to a note saying so.
 */
const CONFORM_MIN_DELTA_KM = 0.015;

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function HealthPanel({
  sinceMs,
  untilMs,
  appDistanceKm,
  confirmed = null,
  onConfirm,
  variant = "card",
}: Props) {
  const [health, setHealth] = useState<HealthRunSummary | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<"idle" | "busy" | "done" | "failed">(
    "idle"
  );
  const [open, setOpen] = useState(false);

  const fetchHealth = useCallback(async () => {
    const native = runBuddyNative();
    if (!native) return;
    setNote(null);
    try {
      // First call ever shows the permission sheet; a no-op afterwards.
      await native.healthAuthorize();
      setHealth(await native.healthRunSummary({ sinceMs, untilMs }));
    } catch {
      setNote("Couldn't read Apple Health — this needs the newest app build.");
    }
  }, [sinceMs, untilMs]);

  useEffect(() => {
    void fetchHealth();
  }, [fetchHealth]);

  if (!isNativeApp()) return null;

  const appSide =
    appDistanceKm !== null && appDistanceKm !== undefined
      ? ` (app: ${appDistanceKm.toFixed(2)} km)`
      : "";

  const workoutKm = health?.workout?.distanceKm;
  const haveBoth =
    workoutKm !== undefined && appDistanceKm !== null && appDistanceKm !== undefined;
  const delta = haveBoth ? Math.abs(workoutKm - appDistanceKm) : null;
  const agrees = delta !== null && delta <= CONFORM_MIN_DELTA_KM;
  const conformOffered =
    !!onConfirm && !confirmed && confirmState !== "done" && delta !== null && !agrees;

  const conform = () => {
    const w = health?.workout;
    if (!onConfirm || !w || w.distanceKm === undefined) return;
    setConfirmState("busy");
    void onConfirm({ distanceKm: w.distanceKm, source: w.source }).then((ok) =>
      setConfirmState(ok ? "done" : "failed")
    );
  };

  const body = (
    <div className={`card health-card${variant === "row" ? " in-row" : ""}`}>
      {note ? (
        <div className="health-line">{note}</div>
      ) : health === null ? (
        <div className="health-line">Reading Apple Health…</div>
      ) : !health.available ? (
        <div className="health-line">Apple Health is not available on this device.</div>
      ) : (
        <>
          {health.workout ? (
            <>
              <div className="split-row">
                <span className="k">{health.workout.activity} workout</span>
                <span>{health.workout.source}</span>
              </div>
              <div className="split-row">
                <span className="k">Workout time</span>
                <span>
                  {clock(health.workout.startMs)}–{clock(health.workout.endMs)} ·{" "}
                  {formatElapsed(health.workout.durationSec * 1000)}
                </span>
              </div>
              {health.workout.distanceKm !== undefined && (
                <div className="split-row">
                  <span className="k">Workout distance</span>
                  <span>
                    {health.workout.distanceKm.toFixed(2)} km{appSide}
                  </span>
                </div>
              )}
              {health.workout.calories !== undefined && (
                <div className="split-row">
                  <span className="k">Active calories</span>
                  <span>{Math.round(health.workout.calories)} kcal</span>
                </div>
              )}
            </>
          ) : (
            <div className="health-line">
              No workout found in this window
              {(health.workoutCount ?? 0) > 0 ? " (another type exists)" : ""} — if your
              Watch is still recording, end the workout there and refresh.
            </div>
          )}
          {health.heartRate?.avg !== undefined ? (
            <div className="split-row">
              <span className="k">Heart rate</span>
              <span>
                {Math.round(health.heartRate.avg)} avg
                {health.heartRate.min !== undefined &&
                  health.heartRate.max !== undefined &&
                  ` · ${Math.round(health.heartRate.min)}–${Math.round(
                    health.heartRate.max
                  )}`}{" "}
                bpm
                {health.heartRateSamples ? ` (${health.heartRateSamples} samples)` : ""}
              </span>
            </div>
          ) : (
            <div className="health-line">
              No heart-rate samples in this window yet — Watch data can take a minute
              to sync.
            </div>
          )}
          {health.distanceKm !== undefined && (
            <div className="split-row">
              <span className="k">Health distance</span>
              <span>
                {health.distanceKm.toFixed(2)} km{appSide}
              </span>
            </div>
          )}
          {health.statsSource && (
            <div className="health-line">
              Heart rate and distance from {health.statsSource} only — other
              trackers&apos; overlapping data (WHOOP etc.) is excluded.
            </div>
          )}
          {confirmed ? (
            <div className="health-line">
              ✓ Conformed — this run uses the {confirmed.source} distance (the app
              measured {confirmed.appDistanceKm.toFixed(2)} km).
            </div>
          ) : confirmState === "done" ? (
            <div className="health-line">
              ✓ Run conformed — the stats and the share card now use the Watch
              distance.
            </div>
          ) : agrees ? (
            // Within GPS noise of each other: a conform would change the
            // second decimal at most, so say why the button isn't here
            // rather than leave the runner hunting for it.
            <div className="health-line">
              Watch and app agree within {Math.round(CONFORM_MIN_DELTA_KM * 1000)} m (
              {workoutKm!.toFixed(2)} vs {appDistanceKm!.toFixed(2)} km) — nothing to
              conform.
            </div>
          ) : (
            conformOffered && (
              <>
                <button
                  className="cta secondary health-refresh"
                  disabled={confirmState === "busy"}
                  onClick={conform}
                >
                  {confirmState === "busy"
                    ? "Updating…"
                    : `✓ Conform run to ${workoutKm!.toFixed(2)} km (${
                        health!.workout!.source
                      })`}
                </button>
                {confirmState === "failed" && (
                  <div className="health-line">
                    Couldn&apos;t update the run — check the connection and try again.
                  </div>
                )}
              </>
            )
          )}
        </>
      )}
      <button className="cta secondary health-refresh" onClick={() => void fetchHealth()}>
        ↻ Refresh Health data
      </button>
    </div>
  );

  if (variant === "card") {
    return (
      <>
        <div className="section-header">Apple Health · read-only</div>
        {body}
      </>
    );
  }

  // The row header: the verdict in one line, the conform pill when it matters.
  const bpm = health?.heartRate?.avg !== undefined ? `${Math.round(health.heartRate.avg)} bpm avg` : null;
  const verdict = note
    ? "Couldn't read Health"
    : health === null
      ? "Reading…"
      : !health.available
        ? "Not available on this device"
        : confirmed
          ? `Conformed to ${confirmed.source}`
          : confirmState === "done"
            ? "Conformed to the Watch"
            : agrees
              ? `Watch and app agree within ${Math.round(CONFORM_MIN_DELTA_KM * 1000)} m`
              : delta !== null
                ? `Watch ${workoutKm!.toFixed(2)} km, app ${appDistanceKm!.toFixed(2)} km`
                : health.workout
                  ? "Workout found"
                  : "No workout in this window";
  const sub = [verdict, bpm].filter(Boolean).join(" · ");

  return (
    <div className={`sum-row-wrap${open ? " open" : ""}`}>
      <div className="sum-row">
        <button className="sum-row-main" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="sum-row-title">
            {agrees || confirmed || confirmState === "done" ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="sum-row-ok">
                <path d="M5 12l5 5L20 7" />
              </svg>
            ) : null}
            Apple Health
          </span>
          <span className="sum-row-sub">{sub}</span>
        </button>
        {conformOffered && (
          <button className="sum-row-pill" disabled={confirmState === "busy"} onClick={conform}>
            {confirmState === "busy" ? "Updating…" : `Conform to ${workoutKm!.toFixed(2)} km`}
          </button>
        )}
        <button
          className="sum-row-chev"
          aria-label={open ? "Hide Apple Health details" : "Show Apple Health details"}
          onClick={() => setOpen((o) => !o)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>
      {open && <div className="sum-row-body">{body}</div>}
    </div>
  );
}
