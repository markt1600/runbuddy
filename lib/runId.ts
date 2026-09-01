// A run's id (its blob basename) encodes the listing row — the same format
// lib/server/runs.ts parses. Client-side twin so a notification carrying only
// a runId can open the detail screen without an extra listing round-trip.

const BASENAME_RE = /^(\d{10,17})_(\d{1,9})_(\d{1,7})_(\d{1,7})_([a-z]+)\.json$/;

export interface ParsedRunId {
  id: string;
  startedAt: number;
  distanceKm: number;
  movingSec: number;
  wallSec: number;
  personaId: string;
}

export function parseRunId(basename: string): ParsedRunId | null {
  const m = basename.match(BASENAME_RE);
  if (!m) return null;
  return {
    id: basename,
    startedAt: Number(m[1]),
    distanceKm: Number(m[2]) / 1000,
    movingSec: Number(m[3]),
    wallSec: Number(m[4]),
    personaId: m[5],
  };
}
