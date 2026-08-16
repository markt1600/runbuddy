export type PersonaId = "ahbeng" | "coach" | "flirty" | "loanshark";

export type PhraseCategory =
  | "intro" // ~10s opening monologue at the start line
  | "start"
  | "encourage" // periodic motivation (positive or negative depending on persona)
  | "pace_up" // runner slowed down
  | "pace_down" // runner sped up / praise pace
  | "milestone" // each km
  | "anecdote" // facts, stories, nuggets
  | "finish"
  | "paused"
  | "resumed"
  | "chat" // canned push-to-talk replies when offline
  | "summary" // post-run closing comment (generated only)
  | "progress" // crossing a fraction of the target distance
  | "target_hit"; // the target distance was reached

export interface Phrase {
  id: string;
  category: PhraseCategory;
  text: string;
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
  route: { lat: number; lon: number }[]; // GPS path of the run
}
