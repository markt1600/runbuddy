import type { Phrase } from "./types";

// The split figure that follows a pace lead-in ("and that last kilometre
// took you…"), in the trainer's own voice instead of the device's. Built
// from two clips played back to back with no breath between: the minutes
// ("Five minutes,") and the seconds ("twelve seconds per kilometre." — or
// "flat!" for a round minute). Thirteen minute clips for 3:00–15:59 plus
// sixty second clips is 73 renders per trainer, not 780. The words are the
// same for every trainer — the lead-in already carries the persona — and the
// ids (pf-min-3 … pf-sec-59) can never collide with a studio phrase, so an
// actor's promoted takes are untouched by rendering these.
//
// Deliberately NOT part of PHRASE_LIBRARY: the studio script, the phrase
// editor, the word counts and the level check all walk that list, and the
// numbers have no business in any of them. They live only in the render
// pipeline (Admin renders them per trainer) and in the coach's lookup.

export const PACE_FIGURE_MIN_MINUTES = 3;
export const PACE_FIGURE_MAX_MINUTES = 15;

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty"];

/** 0–59 in words. */
export function numberWords(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o === 0 ? TENS[t] : `${TENS[t]}-${ONES[o]}`;
}

export const minuteFigureId = (minutes: number) => `pf-min-${minutes}`;
export const secondFigureId = (seconds: number) => `pf-sec-${String(seconds).padStart(2, "0")}`;

/** "Five minutes," — left open for the seconds to complete. */
export function minuteFigureText(minutes: number): string {
  const m = numberWords(minutes);
  return `${m.charAt(0).toUpperCase() + m.slice(1)} minutes,`;
}

/** "flat!" / "one second per kilometre." / "twelve seconds per kilometre." */
export function secondFigureText(seconds: number): string {
  if (seconds === 0) return "flat!";
  return `${numberWords(seconds)} second${seconds === 1 ? "" : "s"} per kilometre.`;
}

export const MINUTE_FIGURES: Phrase[] = Array.from(
  { length: PACE_FIGURE_MAX_MINUTES - PACE_FIGURE_MIN_MINUTES + 1 },
  (_, i) => {
    const m = PACE_FIGURE_MIN_MINUTES + i;
    return { id: minuteFigureId(m), category: "pace_figure", text: minuteFigureText(m), sec: m * 60 };
  }
);

export const SECOND_FIGURES: Phrase[] = Array.from({ length: 60 }, (_, s) => ({
  id: secondFigureId(s),
  category: "pace_figure",
  text: secondFigureText(s),
  sec: s,
}));

/** All 73 clips, shared by every trainer. */
export const PACE_FIGURES: Phrase[] = [...MINUTE_FIGURES, ...SECOND_FIGURES];

const byId = new Map(PACE_FIGURES.map((p) => [p.id, p]));

export function paceFigureById(id: string): Phrase | undefined {
  return byId.get(id);
}

/**
 * The two clips for a split, to the nearest second — or null outside the
 * 3:00–15:59 band, where the coach falls back to the device voice.
 */
export function paceFigureFor(totalSec: number): { minute: Phrase; second: Phrase } | null {
  const rounded = Math.round(totalSec);
  const m = Math.floor(rounded / 60);
  const s = rounded % 60;
  if (m < PACE_FIGURE_MIN_MINUTES || m > PACE_FIGURE_MAX_MINUTES) return null;
  const minute = byId.get(minuteFigureId(m));
  const second = byId.get(secondFigureId(s));
  return minute && second ? { minute, second } : null;
}
