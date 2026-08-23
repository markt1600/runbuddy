import type { PhraseCategory } from "./types";

// Which phrase categories can be topped up by the generator, and what each one
// actually is. Shared so the admin screen and the expand endpoint can't drift
// apart about either question.

/**
 * Categories the generator can add to. The ones left out are structural rather
 * than creative: their contents are fixed by position or by a field the model
 * has no way to fill in.
 */
export const EXPANDABLE_CATEGORIES: PhraseCategory[] = [
  "intro",
  "start",
  "encourage",
  "pace_up",
  "pace_down",
  "milestone",
  "anecdote",
  "finish",
  "paused",
  "resumed",
  "auto_paused",
  "auto_resumed",
  "loitering",
  "pace_lead",
  "chat",
  "progress",
  "target_hit",
];

/** Why the rest are closed, shown in the admin listing. */
export const FIXED_CATEGORY_REASON: Partial<Record<PhraseCategory, string>> = {
  conditional: "one per weather / time-of-day condition",
  countdown: "exactly two: the ten- and five-second marks",
  km_marker: "one per kilometre",
  progress_km: "one per target and checkpoint",
  progress_time: "one per target and checkpoint",
  wr_finish: "one per target and record holder — the times are baked into the words",
  hs_finish: "one per target and record holder — the times are baked into the words",
  pr: "generated live — the record and both times come from the run",
  summary: "written live from your actual numbers, never from the library",
};

/** What to write, per category, when topping a bank up. */
export const CATEGORY_BRIEF: Partial<Record<PhraseCategory, string>> = {
  intro: "an opening monologue delivered at the start line, 30 to 45 words, that sets the tone and launches them into the run",
  start: "a short line for the moment the run actually begins",
  encourage: "periodic motivation delivered mid-run",
  pace_up: "the runner has SLOWED DOWN — call it out and get them moving again",
  pace_down: "the runner has SPED UP — react to it and get them to hold the pace",
  milestone: "a kilometre was just completed — generic, so never name a specific kilometre number",
  anecdote: "a surprising fact, story or nugget about running, fitness, food or life",
  finish: "the run has just ended and this is your sign-off",
  paused: "the runner just paused the run by hand",
  resumed: "the runner just resumed after pausing by hand",
  auto_paused: "the app paused itself because they stopped moving — a SHORT status report, under 15 words, because the phone is in an arm sleeve and they cannot see the screen",
  auto_resumed: "the app restarted the clock because they moved off again — SHORT, under 15 words",
  loitering: "they have been standing still far too long and you are needling them about it — these play after several milder ones, so go further than you otherwise would",
  pace_lead: "a lead-in that ends mid-sentence so a spoken duration can follow it, like \"and that last kilometre took you…\" — it must trail off, never complete the thought",
  chat: "a reply for when the runner says something to you mid-run and nothing better is available",
  progress: "they crossed a checkpoint on the way to a target — generic, so never name a distance, a time or a percentage",
  target_hit: "they just reached the target they set out to do",
};
