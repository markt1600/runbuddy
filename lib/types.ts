export type PersonaId = "ahbeng" | "coach";

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
  | "chat"; // canned push-to-talk replies when offline

export interface Phrase {
  id: string;
  category: PhraseCategory;
  text: string;
}

export interface Persona {
  id: PersonaId;
  name: string;
  tagline: string;
  emoji: string;
  accent: string; // theme color
  positive: boolean; // encouraging vs scolding
  elevenLabsVoiceId: string;
  // Fallback speechSynthesis tuning when no rendered audio is available
  tts: { rate: number; pitch: number; lang: string };
  // Prompt persona description used for live phrase generation
  stylePrompt: string;
}

export type MusicSource = "spotify" | "apple-podcasts" | "none";

export interface RunStats {
  elapsedMs: number;
  distanceKm: number;
  paceSecPerKm: number | null; // current rolling pace
  avgPaceSecPerKm: number | null;
  splits: number[]; // ms per completed km
}
