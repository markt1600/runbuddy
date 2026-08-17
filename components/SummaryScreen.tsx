"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatElapsed, formatPace } from "@/lib/geo";
import { coachIsSpeaking } from "@/lib/audio";
import { getVoiceVolume } from "@/lib/voiceLibrary";
import type { SpeedUnit } from "@/lib/units";
import { drawRunCard, shareOrDownloadCard } from "@/lib/runCard";
import type { Persona, RunStats } from "@/lib/types";

interface Props {
  persona: Persona;
  stats: RunStats;
  speedUnit: SpeedUnit;
  onDone: () => void;
}

/** Strava-style route silhouette drawn from the GPS path — no map tiles, no keys. */
function RouteMap({ route, accent }: { route: RunStats["route"]; accent: string }) {
  if (route.length < 2) {
    return <div className="route-empty">No GPS route recorded for this run</div>;
  }
  // Equirectangular projection with latitude correction, fitted to the viewBox.
  const W = 320;
  const H = 190;
  const PAD = 18;
  const midLat = (route[0].lat + route[route.length - 1].lat) / 2;
  const cosLat = Math.cos((midLat * Math.PI) / 180);
  const xs = route.map((p) => p.lon * cosLat);
  const ys = route.map((p) => p.lat);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min(
    (W - 2 * PAD) / Math.max(maxX - minX, 1e-9),
    (H - 2 * PAD) / Math.max(maxY - minY, 1e-9)
  );
  const ox = (W - (maxX - minX) * scale) / 2;
  const oy = (H - (maxY - minY) * scale) / 2;
  const pts = route.map((p, i) => ({
    x: ox + (xs[i] - minX) * scale,
    y: H - (oy + (ys[i] - minY) * scale), // invert: north is up
  }));
  const path = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const start = pts[0];
  const end = pts[pts.length - 1];

  return (
    <svg className="route-map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Map of your run">
      <polyline
        points={path}
        fill="none"
        stroke={accent}
        strokeWidth={3.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.9}
      />
      <circle cx={start.x} cy={start.y} r={5.5} fill="#30d158" stroke="#000" strokeWidth={1.5} />
      <circle cx={end.x} cy={end.y} r={5.5} fill="#ff453a" stroke="#000" strokeWidth={1.5} />
    </svg>
  );
}

export default function SummaryScreen({ persona, stats, speedUnit, onDone }: Props) {
  const [comment, setComment] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [cardUrl, setCardUrl] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);

  const headline = persona.positive ? "You crushed it!" : "Okay lah, not bad, chee bye.";
  const fallbackSub = persona.positive
    ? "Every step of that was yours. Be proud!"
    : "Don't get cocky ah, kanina. Same time tomorrow.";

  const avgSpeedKmh =
    stats.elapsedMs > 0 ? stats.distanceKm / (stats.elapsedMs / 3_600_000) : 0;

  // One in-persona closing comment on the actual numbers. Falls back to the
  // static line if generation is unavailable.
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/phrase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        persona: persona.id,
        category: "summary",
        // A treadmill run has no distance, pace or speed to talk about.
        context: stats.treadmill
          ? {
              treadmill: true,
              targetMinutes: stats.targetMinutes,
              elapsedMin: Math.round(stats.elapsedMs / 60000),
              localTime: new Date().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              }),
            }
          : {
              distanceKm: Number(stats.distanceKm.toFixed(2)),
              elapsedMin: Math.round(stats.elapsedMs / 60000),
              avgPaceMinPerKm:
                stats.avgPaceSecPerKm !== null
                  ? `${Math.floor(stats.avgPaceSecPerKm / 60)}:${Math.round(
                      stats.avgPaceSecPerKm % 60
                    )
                      .toString()
                      .padStart(2, "0")}`
                  : undefined,
              speedKmh: Number(avgSpeedKmh.toFixed(1)),
              localTime: new Date().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              }),
            },
      }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then(async (data: { text: string; audioBase64?: string } | null) => {
        if (cancelled || !data?.text) return;
        setComment(data.text);
        if (!data.audioBase64) return;
        // The run screen's sign-off is still playing out; queue behind it
        // rather than speaking over the top.
        const waitStartedAt = Date.now();
        while (coachIsSpeaking() && Date.now() - waitStartedAt < 15_000) {
          await new Promise((r) => setTimeout(r, 250));
        }
        if (cancelled) return;
        const closing = new Audio(`data:audio/mpeg;base64,${data.audioBase64}`);
        closing.volume = getVoiceVolume(persona.id); // same level as the run
        void closing.play().catch(() => {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw whenever the coach's line lands, so the saved card carries it.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawRunCard(canvas, {
      persona,
      stats,
      unit: speedUnit,
      comment: comment ?? fallbackSub,
    });
    setCardUrl(canvas.toDataURL("image/png"));
  }, [comment, persona, stats, speedUnit, fallbackSub]);

  const saveCard = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stamp = new Date().toISOString().slice(0, 10);
    const result = await shareOrDownloadCard(canvas, `run-buddy-${stamp}.png`);
    setSaveNote(
      result === "shared"
        ? null
        : result === "downloaded"
          ? "Saved to your downloads"
          : "Couldn't save — long-press the image to save it instead"
    );
  }, []);

  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <div className="summary-hero">
        <div className="summary-emoji">{persona.emoji}</div>
        <div className="summary-headline">{headline}</div>
      </div>

      {/* The shareable square card — what you see is exactly what saves. */}
      <canvas ref={canvasRef} style={{ display: "none" }} />
      {cardUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="run-card-img" src={cardUrl} alt="Your run summary card" />
      ) : (
        <div className="card route-card">
          <RouteMap route={stats.route} accent={persona.accent} />
        </div>
      )}

      <button className="cta secondary save-card-btn" onClick={saveCard}>
        ⬇︎ Save run card
      </button>
      {saveNote && <div className="save-note">{saveNote}</div>}

      <div className="stat-grid">
        {stats.treadmill ? (
          <>
            <div className="stat-cell">
              <div className="stat-value">{formatElapsed(stats.elapsedMs)}</div>
              <div className="stat-label">Time</div>
            </div>
            <div className="stat-cell">
              <div className="stat-value">
                {stats.targetMinutes} <span className="stat-unit">min</span>
              </div>
              <div className="stat-label">Target</div>
            </div>
          </>
        ) : (
          <>
            <div className="stat-cell">
              <div className="stat-value">
                {stats.distanceKm.toFixed(2)} <span className="stat-unit">km</span>
              </div>
              <div className="stat-label">Distance</div>
            </div>
            <div className="stat-cell">
              <div className="stat-value">{formatElapsed(stats.elapsedMs)}</div>
              <div className="stat-label">Time</div>
            </div>
            <div className="stat-cell">
              <div className="stat-value">{formatPace(stats.avgPaceSecPerKm)}</div>
              <div className="stat-label">Avg pace / km</div>
            </div>
            <div className="stat-cell">
              <div className="stat-value">
                {avgSpeedKmh.toFixed(1)} <span className="stat-unit">km/h</span>
              </div>
              <div className="stat-label">Avg speed</div>
            </div>
          </>
        )}
      </div>

      {stats.splits.length > 0 && (
        <>
          <div className="section-header">Splits</div>
          <div className="card splits">
            {stats.splits.map((ms, i) => (
              <div className="split-row" key={i}>
                <span className="k">Kilometre {i + 1}</span>
                <span>{formatElapsed(ms)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="footer-cta">
        <button className="cta" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
