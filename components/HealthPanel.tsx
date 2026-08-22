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

interface Props {
  /** The run's wall-clock window, ms epoch. */
  sinceMs: number;
  untilMs: number;
  /** The app's own distance for the side-by-side; null for treadmill runs. */
  appDistanceKm?: number | null;
}

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function HealthPanel({ sinceMs, untilMs, appDistanceKm }: Props) {
  const [health, setHealth] = useState<HealthRunSummary | null>(null);
  const [note, setNote] = useState<string | null>(null);

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

  return (
    <>
      <div className="section-header">Apple Health · read-only</div>
      <div className="card health-card">
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
          </>
        )}
        <button className="cta secondary health-refresh" onClick={() => void fetchHealth()}>
          ↻ Refresh Health data
        </button>
      </div>
    </>
  );
}
