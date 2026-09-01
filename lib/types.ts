export type PersonaId = "ahbeng" | "posbeng" | "ahlian" | "coach" | "flirty" | "loanshark";

export type PhraseCategory =
  | "intro" // ~10s opening monologue at the start line
  | "start"
  | "encourage" // periodic motivation (positive or negative depending on persona)
  | "pace_up" // runner slowed down
  | "pace_down" // runner sped up / praise pace
  | "milestone" // each km (generic; used past the pre-rendered marker range)
  | "duo_react" // duo mode: one trainer reacting to the other's line
  | "km_marker" // "three kilometres down" — one per km, so the number is in-voice
  | "pace_lead" // lead-in that hands off to the spoken pace figure
  | "anecdote" // facts, stories, nuggets
  | "finish"
  | "paused"
  | "resumed"
  | "conditional" // opener keyed to the live time of day / weather
  | "countdown" // delayed start: ordered [10 seconds, 5 seconds]
  | "auto_paused" // the app paused itself — say so, the phone is in a sleeve
  | "auto_resumed" // …and say when it picked the run back up
  | "loitering" // stopped for far too long, and the coach has noticed
  | "chat" // canned push-to-talk replies when offline
  | "summary" // post-run closing comment (generated only)
  | "progress" // generic checkpoint line (fallback)
  | "progress_km" // checkpoint on a preset distance target: percentage + exact remaining
  | "progress_time" // checkpoint on a preset time target
  | "target_hit" // the target distance was reached
  | "wr_finish" // the marathon WR holder would have finished your target right now
  | "hs_finish" // the US high school record holder just finished your 5K/10K
  | "pr"; // they just beat their own personal record (generated only)

/**
 * What has to be true for a "conditional" phrase to be eligible. Evaluated
 * live at the start line against the clock and the fetched weather, so the
 * line is pre-rendered but the choice of line is not.
 */
export type PhraseCondition =
  | "dawn" // before 07:00
  | "morning" // 07:00–11:00
  | "midday" // 11:00–15:00
  | "evening" // 15:00–19:00
  | "night" // after 19:00
  | "rain"
  | "hot" // feels like 31°C or above
  | "cool"; // feels like 20°C or below

export interface Phrase {
  id: string;
  category: PhraseCategory;
  text: string;
  /**
   * When this line is allowed to play. Required on "conditional" openers;
   * optional on ANY other phrase whose words assume a time of day or the
   * weather ("you complain about running in the evening?") — the pickers
   * skip it whenever the condition doesn't hold. An array means any-of.
   */
  condition?: PhraseCondition | PhraseCondition[];
  /** Only for "km_marker" phrases: which kilometre this line announces. */
  km?: number;
  /**
   * Only for "progress_km" / "progress_time": which preset target this line
   * belongs to (kilometres or minutes), and which checkpoint of it, as a whole
   * percent. Both are known up front, so the remaining distance or time is
   * baked into the recording instead of being read out by the device.
   */
  target?: number;
  mark?: number;
  /** For "wr_finish" / "hs_finish": whose record this line tells — matched
   *  against the runner's account gender (male is the default when unset). */
  wr?: "male" | "female";
}

export interface Persona {
  id: PersonaId;
  name: string;
  shortName: string; // for tight spaces (admin pickers)
  tagline: string;
  emoji: string;
  accent: string; // theme color
  positive: boolean; // encouraging vs scolding
  elevenLabsVoiceId: string;
  /** ElevenLabs playback speed (1.0 normal; API accepts ~0.7–1.2). */
  elevenLabsSpeed: number;
  /** Default playback level, 0–1. Every persona ships at full. */
  playbackVolume: number;
  // Fallback speechSynthesis tuning when no rendered audio is available
  tts: { rate: number; pitch: number; lang: string };
  // Prompt persona description used for live phrase generation
  stylePrompt: string;
}

export type MusicSource = "spotify" | "apple-music" | "apple-podcasts" | "none";

export interface RunStats {
  elapsedMs: number;
  distanceKm: number;
  paceSecPerKm: number | null; // current rolling pace
  avgPaceSecPerKm: number | null;
  speedNowKmh: number | null; // averaged over the last ~10s
  lastKmSpeedKmh: number | null; // moving average over the last full km
  avgSpeedKmh: number | null; // whole run
  splits: number[]; // ms per completed km
  route: { lat: number; lon: number; t?: number }[]; // GPS path; t = sec since start
  treadmill?: boolean; // time-target run: no GPS, speed or route
  targetMinutes?: number; // the duration goal, when running to time
  targetKm?: number; // the distance goal, when one was set
  targetPaceSec?: number; // the pace goal (sec/km), when one was set — outdoor only
  /** Wall-clock start (after any countdown) — elapsedMs excludes pauses, so
   *  run history needs both to show moving time AND total elapsed time. */
  startedAt?: number;
  wallElapsedMs?: number;
  /** Where the run happened (e.g. "Bishan"), from the in-run weather fetch. */
  locality?: string;
  /** City level (e.g. "Singapore") — what seeds/compares against home city. */
  city?: string;
  /**
   * How well iOS fed the tracker: sparse fix delivery (a locked phone in a
   * sleeve) is what makes a run read short, so the summary shows it rather
   * than leaving a drift against the watch unexplained.
   */
  gps?: {
    avgFixGapSec: number | null;
    maxFixGapSec: number;
    overCapSec: number; // run-seconds beyond the integrator's per-fix credit cap
    bridgedKm: number; // the correction's net effect vs the legacy engine
    startKm?: number; // Doppler-measured movement before the first accepted fix
  };
  /** Set when the runner adopted a device's distance over the app's. */
  confirmed?: { source: string; appDistanceKm: number; at: number };
}
