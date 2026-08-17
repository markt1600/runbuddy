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

// Optional target distance for the run. 0 = no target (default).
export const TARGET_OPTIONS = [0, 3, 5, 10, 12, 14] as const;

const TARGET_KEY = "runbuddy-target-km";

export function loadTargetKm(): number {
  try {
    const v = Number(localStorage.getItem(TARGET_KEY));
    if (TARGET_OPTIONS.includes(v as (typeof TARGET_OPTIONS)[number])) return v;
  } catch {
    /* private mode */
  }
  return 0;
}

export function saveTargetKm(v: number) {
  try {
    localStorage.setItem(TARGET_KEY, String(v));
  } catch {
    /* private mode */
  }
}

// Optional target duration (minutes). Choosing one puts the app in treadmill
// mode: GPS, speed and route tracking are off and the coach paces by the clock.
export const TARGET_TIME_OPTIONS = [0, 15, 20, 30, 45, 60] as const;

const TARGET_MIN_KEY = "runbuddy-target-min";

export function loadTargetMin(): number {
  try {
    const v = Number(localStorage.getItem(TARGET_MIN_KEY));
    if (TARGET_TIME_OPTIONS.includes(v as (typeof TARGET_TIME_OPTIONS)[number])) return v;
  } catch {
    /* private mode */
  }
  return 0;
}

export function saveTargetMin(v: number) {
  try {
    localStorage.setItem(TARGET_MIN_KEY, String(v));
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

// Auto-pause: freeze the clock when the runner stops moving, and pick it back
// up when they start again. On by default — it's what every running app does —
// but it needs GPS, so it has no effect in treadmill mode.
const AUTOPAUSE_KEY = "runbuddy-autopause";

export function loadAutoPause(): boolean {
  try {
    return localStorage.getItem(AUTOPAUSE_KEY) !== "0";
  } catch {
    return true; // private mode
  }
}

export function saveAutoPause(on: boolean) {
  try {
    localStorage.setItem(AUTOPAUSE_KEY, on ? "1" : "0");
  } catch {
    /* private mode */
  }
}

// Delayed start: press Start, get the phone into the arm sleeve, and let the
// trainer count you in. Off by default.
export const START_DELAY_SEC = 20;

const START_DELAY_KEY = "runbuddy-start-delay";

export function loadStartDelay(): boolean {
  try {
    return localStorage.getItem(START_DELAY_KEY) === "1";
  } catch {
    return false; // private mode
  }
}

export function saveStartDelay(on: boolean) {
  try {
    localStorage.setItem(START_DELAY_KEY, on ? "1" : "0");
  } catch {
    /* private mode */
  }
}


