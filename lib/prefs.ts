// Coach chatter frequency: a multiplier on how often the trainer interjects.
// 1.0 = the default cadence; the random jitter between phrases is unchanged,
// only the tendency shifts. Persisted like the speed-unit preference.

const KEY = "runbuddy-chattiness";

export const CHATTINESS_DEFAULT = 1.0;
export const CHATTINESS_MIN = 0.5;
export const CHATTINESS_MAX = 2.0;

export function loadChattiness(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    if (isFinite(v) && v >= CHATTINESS_MIN && v <= CHATTINESS_MAX) return v;
  } catch {
    /* private mode */
  }
  return CHATTINESS_DEFAULT;
}

export function saveChattiness(v: number) {
  try {
    localStorage.setItem(KEY, String(v));
  } catch {
    /* private mode */
  }
}

export function chattinessLabel(v: number): string {
  if (v <= 0.5) return "Rare";
  if (v <= 0.75) return "Quieter";
  if (v < 1.25) return "Normal";
  if (v < 1.75) return "Chatty";
  return "Non-stop";
}
