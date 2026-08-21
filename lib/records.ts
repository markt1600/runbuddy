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

/**
 * US high school national records at the exact race distances — no pace
 * extrapolation, these ARE 5 km and 10 km times. A fun wrinkle in the data:
 * Chapa's 1976 schoolboy 10K is 2 seconds FASTER than Kiptum's marathon-pace
 * 10K split, so on a 10 km run the kid finishes before the world-record
 * holder does.
 */
export const HS_RECORDS: Record<
  number,
  Record<"male" | "female", { name: string; timeSec: number }>
> = {
  5: {
    // 13:25.86 — Portland Track Festival, June 2024
    male: { name: "Daniel Simmons", timeSec: 13 * 60 + 26 },
    // 14:57.93 — Bryan Clay Invitational, April 2025; first HS girl under 15:00
    female: { name: "Jane Hedengren", timeSec: 14 * 60 + 58 },
  },
  10: {
    // 28:32.7 — Drake Relays, April 1976; unbeaten by a high schooler since
    male: { name: "Rudy Chapa", timeSec: 28 * 60 + 33 },
    // 32:52.5 — US Outdoor Championships, 1979
    female: { name: "Mary Shea", timeSec: 32 * 60 + 53 },
  },
};

/** The high schooler's literal finish time for this target, or null when the
 *  target has no HS-record line (only 5 and 10 km do). */
export function hsFinishMs(gender: "male" | "female", targetKm: number): number | null {
  const rec = HS_RECORDS[targetKm]?.[gender];
  return rec ? rec.timeSec * 1000 : null;
}
