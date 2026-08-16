import { formatPace } from "./geo";

// Display unit for speed readouts: km/h or min/km pace. Persisted preference,
// togglable on the setup screen and mid-run.

export type SpeedUnit = "kmh" | "minkm";

const KEY = "runbuddy-speed-unit";

export function loadSpeedUnit(): SpeedUnit {
  try {
    return localStorage.getItem(KEY) === "minkm" ? "minkm" : "kmh";
  } catch {
    return "kmh";
  }
}

export function saveSpeedUnit(unit: SpeedUnit) {
  try {
    localStorage.setItem(KEY, unit);
  } catch {
    /* private mode */
  }
}

/** Format a speed (km/h) in the chosen unit. "--" when unknown. */
export function formatInUnit(kmh: number | null, unit: SpeedUnit): string {
  if (kmh === null || !isFinite(kmh) || kmh <= 0) return "--";
  if (unit === "kmh") return kmh.toFixed(1);
  return formatPace(3600 / kmh); // e.g. 6'24"
}

export function unitSuffix(unit: SpeedUnit): string {
  return unit === "kmh" ? "km/h" : "/km";
}
