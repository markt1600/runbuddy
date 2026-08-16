"use client";

import { formatElapsed, formatPace } from "@/lib/geo";
import type { Persona, RunStats } from "@/lib/types";

interface Props {
  persona: Persona;
  stats: RunStats;
  onDone: () => void;
}

export default function SummaryScreen({ persona, stats, onDone }: Props) {
  const headline = persona.positive
    ? "You crushed it!"
    : "Okay lah, not bad, chee bye.";
  const sub = persona.positive
    ? "Every step of that was yours. Be proud!"
    : "Don't get cocky ah, kan ni na. Same time tomorrow.";

  return (
    <div className="fade-in" style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <div className="summary-hero">
        <div className="summary-emoji">{persona.emoji}</div>
        <div className="summary-headline">{headline}</div>
        <div className="summary-sub">{sub}</div>
      </div>

      <div className="stat-grid">
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
            {Math.round((stats.elapsedMs / 60000) * 10)}{" "}
            <span className="stat-unit">kcal*</span>
          </div>
          <div className="stat-label">Est. burn</div>
        </div>
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
