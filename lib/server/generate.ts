import Anthropic from "@anthropic-ai/sdk";
import { PERSONAS } from "../personas";
import { readVoiceSettings } from "./voiceSettings";
import type { PersonaId } from "../types";

// Server-side helpers: write a line in-persona with Claude (Sonnet 5), voice it
// with ElevenLabs. Both degrade gracefully — the client falls back to its local
// library / on-device TTS.

export interface PhraseContext {
  distanceKm?: number;
  elapsedMin?: number;
  localTime?: string;
  kmMarker?: number; // whole kilometres completed
  paceMinPerKm?: string; // current pace, e.g. "6:24"
  avgPaceMinPerKm?: string;
  lastKmPaceMinPerKm?: string; // split for the kilometre just finished
  targetPaceMinPerKm?: string; // the pace the runner set out to hold
  speedKmh?: number;
  locality?: string; // where the runner is, e.g. "Bishan"
  weather?: string; // e.g. "partly cloudy, 29°C (feels like 33°C)"
  targetKm?: number;
  progressPercent?: number;
  remainingKm?: number;
  /** A moment hint for duo banter, e.g. "the runner just slowed down". */
  paceNote?: string;
  pausedSeconds?: number; // how long they've been standing still
  // Treadmill (time-target) runs
  treadmill?: boolean;
  targetMinutes?: number;
  remainingMinutes?: number;
  /** The runner's current Spotify track, e.g. "Running Up That Hill — Kate Bush" */
  nowPlaying?: string;
  // Travel mode: GPS puts the run in a different city from the account's home
  travelCity?: string; // e.g. "Tokyo"
  travelCountry?: string; // e.g. "Japan"
  homeCity?: string; // e.g. "Singapore"
  // Signed-in runner's account profile — self-reported on the account screen
  runnerName?: string;
  runnerAge?: number;
  runnerHeightCm?: number;
  runnerWeightKg?: number;
  runnerGender?: string;
  // Their saved run history, digested client-side (see lib/history.ts)
  runnerHistory?: {
    totalRuns?: number;
    daysSinceLast?: number;
    lastRunKm?: number;
    lastRunPace?: string;
    longestKm?: number;
    bestPace?: string;
    bestPaceKm?: number;
    runsLast30Days?: number;
  };
}

/**
 * Who the runner is, when they're signed in and told us. Kept separate from
 * the live stats so the prompt can frame it as seasoning, not data to recite.
 */
function runnerLines(context: PhraseContext): string {
  const bits = [
    context.runnerName ? `their name is ${context.runnerName}` : null,
    context.runnerGender === "female" || context.runnerGender === "male"
      ? `they are ${context.runnerGender}`
      : null,
    context.runnerAge !== undefined ? `they are ${context.runnerAge} years old` : null,
    context.runnerHeightCm !== undefined ? `${context.runnerHeightCm} cm tall` : null,
    context.runnerWeightKg !== undefined ? `${context.runnerWeightKg} kg` : null,
  ].filter(Boolean);
  if (bits.length === 0) return "";
  return (
    `\n\nAbout the runner: ${bits.join(", ")}. Use this for the occasional personal ` +
    "touch — address them by name sometimes, or let their age or build colour a remark " +
    "in your persona's style. Never recite these numbers back as a list, and never " +
    "mention their weight in a way that would sting outside your persona's usual teasing."
  );
}

/**
 * What they've done before this run. Framed as memory, not a scoreboard: the
 * point is the trainer noticing — a comeback after a quiet week, pace near a
 * personal best — one observation at most, never a stats recital.
 */
function historyLines(context: PhraseContext): string {
  const h = context.runnerHistory;
  if (!h || !h.totalRuns) return "";
  const bits = [
    `${h.totalRuns} runs saved with you before this one`,
    h.daysSinceLast !== undefined
      ? h.daysSinceLast === 0
        ? "their last run was earlier today"
        : h.daysSinceLast === 1
          ? "their last run was yesterday"
          : `their last run was ${h.daysSinceLast} days ago`
      : null,
    h.lastRunKm !== undefined
      ? `last run: ${h.lastRunKm} km${h.lastRunPace ? ` at ${h.lastRunPace} min/km` : ""}`
      : null,
    h.longestKm !== undefined ? `longest ever: ${h.longestKm} km` : null,
    h.bestPace
      ? `best average pace: ${h.bestPace} min/km` +
        (h.bestPaceKm !== undefined ? `, set on a ${h.bestPaceKm} km run` : "")
      : null,
    h.runsLast30Days !== undefined ? `${h.runsLast30Days} runs in the last 30 days` : null,
  ].filter(Boolean);
  // A short-run pace held up against a long run reads as nagging with an
  // unfair yardstick — the model needs telling, or it does exactly that.
  const fairPace =
    h.bestPace && h.bestPaceKm !== undefined && context.targetKm !== undefined &&
    context.targetKm > h.bestPaceKm * 1.5
      ? " Their best pace was set on a much shorter run than today's — it is NOT a fair " +
        "benchmark for today's distance. You may nod to it at most once as motivation, " +
        "but never measure today's pace against it; judge today's effort on its own " +
        "terms for this distance."
      : "";
  return (
    `\n\nTheir running history with you: ${bits.join("; ")}. You remember this — ` +
    "bring it up when it's genuinely relevant (a long gap since the last run, beating " +
    "their usual distance, pace near their best), at most one observation per line, " +
    "in your persona's voice. Never recite the history as a list. When you compare " +
    "pace to a past run, only compare against runs of similar distance — a pace from " +
    "a much shorter run is not a fair yardstick for a longer one." +
    fairPace
  );
}

/**
 * Travel mode: the run is happening away from the account's home city. The
 * coach gets to be a tour guide in character — but only some of the time,
 * so a week's holiday doesn't turn every line into a landmark tour.
 */
function travelLines(context: PhraseContext): string {
  if (!context.travelCity) return "";
  const place = context.travelCountry
    ? `${context.travelCity}, ${context.travelCountry}`
    : context.travelCity;
  return (
    `\n\nTRAVEL MODE: they are away from home (${context.homeCity ?? "their usual city"}) — ` +
    `this run is in ${place}. Lean into it for SOME lines: name-drop ${context.travelCity} ` +
    "itself, its famous streets, landmarks, food, climate or running culture, the way a " +
    "local coach showing a visitor around would — all filtered through your persona. " +
    "Never invent specifics you aren't sure of; the city's famous basics are plenty."
  );
}

function contextLines(context: PhraseContext): string {
  if (context.treadmill) {
    const lines = [
      "The runner is on a TREADMILL indoors — there is no GPS, so you do not know " +
        "their distance, pace, speed or location. Never mention any of those.",
      context.targetMinutes ? `Goal: ${context.targetMinutes} minutes` : null,
      context.elapsedMin !== undefined ? `Elapsed: ${context.elapsedMin} minutes` : null,
      context.progressPercent !== undefined
        ? `They have completed ${context.progressPercent}% of the time`
        : null,
      context.remainingMinutes !== undefined
        ? `Remaining: ${context.remainingMinutes} minutes`
        : null,
      context.pausedSeconds !== undefined
        ? `They have been stopped, not moving, for ${context.pausedSeconds} seconds`
        : null,
      context.localTime ? `Local time: ${context.localTime}` : null,
      context.nowPlaying
        ? `Playing in their ears right now: ${context.nowPlaying} — react to the music ` +
          "only occasionally, when it's genuinely funny or apt"
        : null,
    ].filter(Boolean);
    return `\n\nLive run stats:\n${lines.join("\n")}${runnerLines(context)}${historyLines(context)}`;
  }
  const lines = [
    context.locality ? `Location: running through ${context.locality}` : null,
    context.weather ? `Weather right now: ${context.weather}` : null,
    context.distanceKm !== undefined ? `Distance covered: ${context.distanceKm} km` : null,
    context.targetKm !== undefined ? `Today's goal distance: ${context.targetKm} km` : null,
    context.kmMarker ? `Just completed kilometre number ${context.kmMarker}` : null,
    context.elapsedMin !== undefined ? `Elapsed: ${context.elapsedMin} minutes` : null,
    context.paceMinPerKm ? `Current pace: ${context.paceMinPerKm} min/km` : null,
    context.avgPaceMinPerKm ? `Average pace: ${context.avgPaceMinPerKm} min/km` : null,
    context.targetPaceMinPerKm
      ? `They set out to hold a target pace of ${context.targetPaceMinPerKm} min/km — ` +
        "judge their pace against that, not against their average"
      : null,
    context.lastKmPaceMinPerKm
      ? `Pace for the kilometre they just finished: ${context.lastKmPaceMinPerKm} min/km`
      : null,
    context.speedKmh !== undefined ? `Current speed: ${context.speedKmh} km/h` : null,
    context.paceNote ? `This exact moment: ${context.paceNote}` : null,
    context.pausedSeconds !== undefined
      ? `They have been stopped, not moving, for ${context.pausedSeconds} seconds`
      : null,
    context.localTime ? `Local time: ${context.localTime}` : null,
    context.nowPlaying
      ? `Playing in their ears right now: ${context.nowPlaying} — react to the music ` +
        "only occasionally, when it's genuinely funny or apt"
      : null,
  ].filter(Boolean);
  const stats = lines.length ? `\n\nLive run stats:\n${lines.join("\n")}` : "";
  return `${stats}${runnerLines(context)}${historyLines(context)}${travelLines(context)}`;
}

export async function generateLine(
  persona: PersonaId,
  instruction: string,
  context: PhraseContext
): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }
  const client = new Anthropic();
  const p = PERSONAS[persona];

  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 300,
    output_config: { effort: "low" },
    system:
      `${p.stylePrompt}\n\n` +
      "You speak to a runner mid-run through their earphones. You are given live run stats — " +
      "weave the most interesting one or two of them naturally into what you say (the weather, " +
      "where they are, their pace or speed, which kilometre they just hit) so it feels like you " +
      "are really there watching them. Don't recite all the stats. Respond with ONE spoken line " +
      "of at most 45 words. No stage directions, no quotes, no emoji — just the words to be " +
      "spoken aloud.",
    messages: [
      {
        role: "user",
        content: `${instruction}${contextLines(context)}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("generation declined");
  }
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join(" ")
    .trim();
  if (!text) throw new Error("empty generation");
  return text;
}

export interface CameoLine {
  persona: PersonaId;
  text: string;
}

/**
 * Parse the model's A:/B: script into speaker-tagged lines. Exported for the
 * unit test — the parser is where a formatting drift would silently eat the
 * whole cameo. A = the runner's own trainer, B = the one barging in. Capped
 * at 4 lines: the client voice queue holds exactly that many.
 */
export function parseCameoScript(
  raw: string,
  primary: PersonaId,
  cameo: PersonaId,
  max = 4
): CameoLine[] {
  const lines: CameoLine[] = [];
  for (const line of raw.split("\n")) {
    const m = line.trim().match(/^([AB]):\s*(.+)$/);
    if (m && m[2].trim()) {
      lines.push({ persona: m[1] === "A" ? primary : cameo, text: m[2].trim() });
    }
  }
  return lines.slice(0, max);
}

/**
 * A one-off mid-run skit: another trainer barges in and the two argue —
 * about the runner's live numbers, whose methods work, whether the runner
 * is being coddled. Freshly written every run; never from a library.
 */
export async function generateCameo(
  primary: PersonaId,
  cameo: PersonaId,
  context: PhraseContext
): Promise<CameoLine[]> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }
  const client = new Anthropic();
  const pA = PERSONAS[primary];
  const pB = PERSONAS[cameo];

  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 500,
    output_config: { effort: "low" },
    system:
      "You write a short comic interruption for a live running-coach app set in Singapore. " +
      "The runner is mid-run, listening through earphones.\n\n" +
      `CHARACTER A — the runner's trainer today (${pA.name}): ${pA.stylePrompt}\n\n` +
      `CHARACTER B — another trainer from the same app, barging into the session (${pB.name}): ${pB.stylePrompt}\n\n` +
      "Write EXACTLY 4 spoken lines, alternating in this order: B, A, B, A. " +
      "B interrupts the run out of nowhere; the two get into a FRIENDLY argument — about the " +
      "runner's live stats below, whose coaching works better, or whether the runner is being " +
      "pushed hard enough. Ground at least two of the lines in the actual stats. Both stay " +
      "fully in character and it stays good-natured — the runner should finish it grinning. " +
      "At most 18 words per line, under 80 words total. No stage directions, no quotes, no emoji.\n" +
      "Format strictly, nothing before or after:\n" +
      "B: <line>\nA: <line>\nB: <line>\nA: <line>",
    messages: [
      {
        role: "user",
        content: `The runner, mid-run, right now:${contextLines(context)}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("generation declined");
  const raw = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const lines = parseCameoScript(raw, primary, cameo);
  if (lines.length < 2) throw new Error("cameo script unparseable");
  return lines;
}

/**
 * How the duo-mode pair relate to each other — the comedy engine. Keyed by
 * "a+b" in the order the client sends them; one pair today, data-driven so
 * the next pair is a prompt away.
 */
const DUO_DYNAMICS: Record<string, string> = {
  "ahbeng+ahlian":
    "Ah Beng and Ah Lian are co-trainers and lifelong sparring partners — equals from the " +
    "same kopitiam universe, zero patience with each other, bickering like siblings who " +
    "would never admit they respect each other. He thinks her ex-boyfriend comparisons " +
    "baby the runner; she thinks his scolding is all volume and no technique. Permanent " +
    "sore points: her useless ex, his kopitiam bragging, whose army 2.4km time was better, " +
    "and who the aunties at the market actually listen to. Genders, never mixed up: HER ex " +
    "is a man (he/him); Ah Beng is a straight man, so any ex of HIS is a woman (she/her, " +
    "'my ex-girlfriend').",
};

export type DuoKind = "duet" | "argument" | "banter";

/**
 * Duo mode's live set pieces. A duet: the two trainers talk to each other
 * ABOUT the runner for a few lines while the runner eavesdrops. An argument:
 * a proper 10–12 line blow-up that starts on the runner's numbers, derails
 * into their own feud, and snaps back together behind the runner at the end.
 */
export async function generateDuo(
  a: PersonaId,
  b: PersonaId,
  kind: DuoKind,
  context: PhraseContext
): Promise<CameoLine[]> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }
  const client = new Anthropic();
  const pA = PERSONAS[a];
  const pB = PERSONAS[b];
  const dynamic =
    DUO_DYNAMICS[`${a}+${b}`] ?? DUO_DYNAMICS[`${b}+${a}`] ?? "";

  const task =
    kind === "banter"
      ? "Write EXACTLY 2 spoken lines — one from each trainer, either may start. A quick " +
        "exchange between the TWO OF THEM about the runner's current numbers or effort — " +
        "the runner is eavesdropping and is not addressed. One observation, one riposte. " +
        "At most 16 words per line. No stage directions, no quotes, no emoji.\n" +
        "Format strictly, nothing before or after, e.g.:\n" +
        "A: <line>\nB: <line>"
      : kind === "duet"
      ? "Write EXACTLY 3 spoken lines, alternating A, B, A. The two trainers talk to EACH " +
        "OTHER about the runner — the runner is eavesdropping through their earphones and " +
        "is never addressed until the final line, which turns to the runner and pushes them " +
        "on. Ground at least two lines in the live stats below. " +
        "At most 18 words per line. No stage directions, no quotes, no emoji.\n" +
        "Format strictly, nothing before or after:\n" +
        "A: <line>\nB: <line>\nA: <line>"
      : "Write EXACTLY 12 spoken lines, alternating strictly A, B, A, B and so on. The two " +
        "trainers get into a proper ARGUMENT: it starts about the runner's live stats below, " +
        "derails into ONE of their personal sore points, escalates comically through the " +
        "middle — each line topping the last — and in the FINAL TWO lines they abruptly " +
        "re-unite behind the runner and push them on together. Ground at least three lines " +
        "in the actual stats. Comic, never genuinely nasty; both fully in character. " +
        "At most 18 words per line. No stage directions, no quotes, no emoji.\n" +
        "Format strictly, nothing before or after, one line per row:\n" +
        "A: <line>\nB: <line>\n(continue alternating for all 12 lines)";

  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: kind === "argument" ? 1200 : 400,
    output_config: { effort: "low" },
    system:
      "You write live comic dialogue for a two-trainer running-coach app set in Singapore. " +
      "The runner is mid-run, listening through earphones. BOTH trainers are coaching this " +
      "run together.\n\n" +
      `CHARACTER A (${pA.name}): ${pA.stylePrompt}\n\n` +
      `CHARACTER B (${pB.name}): ${pB.stylePrompt}\n\n` +
      (dynamic ? `THEIR RELATIONSHIP: ${dynamic}\n\n` : "") +
      task,
    messages: [
      {
        role: "user",
        content: `The runner, mid-run, right now:${contextLines(context)}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("generation declined");
  const raw = response.content
    .filter((bl) => bl.type === "text")
    .map((bl) => bl.text)
    .join("\n");
  const max = kind === "banter" ? 2 : kind === "duet" ? 3 : 12;
  const lines = parseCameoScript(raw, a, b, max);
  if (lines.length < (kind === "argument" ? 8 : 2)) throw new Error("duo script unparseable");
  return lines;
}

/**
 * A friend's shoutout, delivered by the runner's trainer with permission to
 * embellish: the trainer announces who it's from and lands the message's
 * meaning in their own voice. Verbatim delivery never comes through here —
 * that's a fixed template, so the words stay exactly the sender's.
 */
export async function generateShoutoutLine(
  persona: PersonaId,
  fromName: string,
  text: string
): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  const client = new Anthropic();
  const p = PERSONAS[persona];
  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 250,
    output_config: { effort: "low" },
    system:
      `${p.stylePrompt}\n\n` +
      "Mid-run, a FRIEND of the runner has sent them a message through the app, and you " +
      "are delivering it. Announce clearly that this is a message from that friend (use " +
      "the friend's name), then deliver the message — you may embellish it warmly and in " +
      "your own style, but every point the friend made must survive intact, and you must " +
      "never invent things the friend didn't say. One spoken utterance, at most 55 words. " +
      "No stage directions, no quotes around the whole line, no emoji.",
    messages: [
      {
        role: "user",
        content: `The friend's name: ${fromName}\nTheir message: ${text}`,
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("generation declined");
  const line = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join(" ")
    .trim();
  if (!line) throw new Error("empty shoutout line");
  return line;
}

/** Voice ID resolution: env var first, then the default in lib/personas.ts. */
export function voiceIdFor(persona: PersonaId): string {
  const envName = `ELEVENLABS_VOICE_${persona.toUpperCase()}`;
  return process.env[envName] || PERSONAS[persona].elevenLabsVoiceId;
}

export async function renderVoiceBuffer(
  persona: PersonaId,
  text: string
): Promise<Buffer | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return null;
  const voiceId = voiceIdFor(persona);
  const settings = await readVoiceSettings();
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.8,
          style: 0.6,
          speed: settings[persona].speed,
          // Explicit: omitted, quieter-natured voices (Cassie) render
          // noticeably softer than the rest — a cameo where one side of the
          // argument is barely audible.
          use_speaker_boost: true,
        },
      }),
    }
  );
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

export async function renderVoice(persona: PersonaId, text: string): Promise<string | null> {
  const buf = await renderVoiceBuffer(persona, text);
  return buf ? buf.toString("base64") : null;
}
