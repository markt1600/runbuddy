import type { Phrase } from "./types";

// The split figure that follows a pace lead-in ("and that last kilometre
// took you…"): every whole second from 3:00 to 15:59 per kilometre, as a
// phrase each trainer renders in their own voice, so the number no longer
// drops out of the trainer's mouth into the device's. The words are the same
// for every trainer — the lead-in already carries the persona — and the ids
// (pf-3-00 … pf-15-59) can never collide with a studio phrase, so an actor's
// promoted takes are untouched by rendering these.
//
// Deliberately NOT part of PHRASE_LIBRARY: the studio script, the phrase
// editor, the word counts and the level check all walk that list, and 780
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

export function paceFigureId(minutes: number, seconds: number): string {
  return `pf-${minutes}-${String(seconds).padStart(2, "0")}`;
}

/** "Three minutes flat!" / "Three minutes, one second per kilometre." */
export function paceFigureText(minutes: number, seconds: number): string {
  const m = numberWords(minutes);
  const cap = m.charAt(0).toUpperCase() + m.slice(1);
  if (seconds === 0) return `${cap} minutes flat!`;
  const s = numberWords(seconds);
  return `${cap} minutes, ${s} second${seconds === 1 ? "" : "s"} per kilometre.`;
}

/** All 780 figures, in order, shared by every trainer. */
export const PACE_FIGURES: Phrase[] = (() => {
  const out: Phrase[] = [];
  for (let m = PACE_FIGURE_MIN_MINUTES; m <= PACE_FIGURE_MAX_MINUTES; m++) {
    for (let s = 0; s < 60; s++) {
      out.push({
        id: paceFigureId(m, s),
        category: "pace_figure",
        text: paceFigureText(m, s),
        sec: m * 60 + s,
      });
    }
  }
  return out;
})();

const byId = new Map(PACE_FIGURES.map((p) => [p.id, p]));
const bySec = new Map(PACE_FIGURES.map((p) => [p.sec!, p]));

export function paceFigureById(id: string): Phrase | undefined {
  return byId.get(id);
}

/**
 * The figure for a split, to the nearest second — or null outside the
 * 3:00–15:59 band, where the coach falls back to the device voice.
 */
export function paceFigureFor(totalSec: number): Phrase | null {
  return bySec.get(Math.round(totalSec)) ?? null;
}
