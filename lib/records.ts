// Marathon world records — the numbers the wr_finish phrases are written
// against. If a record falls, update BOTH this file and the wr_finish lines
// in lib/phrases.ts: the spoken names and times are baked into the
// pre-rendered recordings, so the text must change (and be re-rendered) too.

export const MARATHON_KM = 42.195;

export const MARATHON_WR = {
  // 2:00:35 — Chicago, October 2023
  male: { name: "Kelvin Kiptum", timeSec: 2 * 3600 + 35 },
  // 2:09:56 — Chicago, October 2024
  female: { name: "Ruth Chepngetich", timeSec: 2 * 3600 + 9 * 60 + 56 },
} as const;

/**
 * When the record holder, running at their marathon average pace, would cross
 * the finish line of a `targetKm` run — the moment the trainer drops the fact.
 */
export function wrFinishMs(gender: "male" | "female", targetKm: number): number {
  return (MARATHON_WR[gender].timeSec / MARATHON_KM) * targetKm * 1000;
}
