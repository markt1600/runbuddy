// The two plans, shared by the server (which enforces them) and the client
// (which stops asking for what it won't get).
//
//   free — everything that plays from the rendered library: the start, km
//          markers and splits, checkpoints, pause and resume, the openers,
//          record moments, duo mode's scripted reactions, cheers read word
//          for word, the run card, friends. Nothing improvised, nothing
//          personal (no name, age, history or weather in the coaching).
//   full — plus everything that goes through the model: improvised colour
//          and encouragement, the personal touches, duo banter pieces,
//          replies when you talk to your trainer, the closing comment on the
//          card, and cheers the trainer embellishes.
//
// Until the App Store subscription exists every account is on "full" (the
// server default); a profile can still be pinned to either plan from Admin.

export type Plan = "free" | "full";

export const PLANS: Plan[] = ["free", "full"];

export function isPlan(v: unknown): v is Plan {
  return v === "free" || v === "full";
}

/** Whether the plan may call the model (live lines, replies, banter). */
export function planAllowsGenerated(plan: Plan): boolean {
  return plan === "full";
}

export const PLAN_LABEL: Record<Plan, string> = {
  free: "Free — pre-rendered lines only",
  full: "Full — improvised lines, your name and stats in the coaching, duo banter, replies when you talk to your trainer",
};
