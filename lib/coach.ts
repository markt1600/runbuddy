import { allPhrasesFor, getPhraseUrl, getVoiceVolume, renderedCount } from "./voiceLibrary";
import type { Persona, Phrase, PhraseCategory, PhraseCondition, RunStats } from "./types";
import { vibrate, type VoiceEngine } from "./audio";
import type { RunEnvironment } from "./enviro";
import type { RunHistoryDigest } from "./history";
import { hsFinishMs, wrFinishMs } from "./records";
import { PERSONAS } from "./personas";
import type { PersonaId } from "./types";

// CoachEngine — decides WHAT the trainer says and WHEN.
// tick() is called ~1x/second by the run screen with fresh stats.

const ENCOURAGE_GAP_MS: [number, number] = [50_000, 95_000];
const ANECDOTE_GAP_MS: [number, number] = [180_000, 300_000];
const PACE_COOLDOWN_MS = 120_000;
// Target-pace mode: how far off the target counts as "off it". The dead band
// between the two keeps a marginal runner from being praised and scolded on
// alternating checks; being 2 min in is enough for the rolling pace to mean
// something (vs 3 min for the self-relative comparison, which needs an
// average worth deviating from).
const PACE_TARGET_SLOW = 1.04; // >4% over target pace = too slow
const PACE_TARGET_GOOD = 1.0; // at or under target = on pace
const PACE_TARGET_MIN_ELAPSED_MS = 120_000;
// Fractions of the target distance that earn a callout. The requested
// checkpoints, then a tighter run-in over the last stretch.
const PROGRESS_MARKS = [0.1, 0.25, 1 / 3, 0.5, 2 / 3, 0.75, 0.9, 0.94, 0.97, 0.99, 1];

const FRESH_ANECDOTE_CHANCE = 0.5; // odds an anecdote slot asks the API for new material
const FRESH_ENCOURAGE_CHANCE = 0.25; // odds regular encouragement is freshly generated
// Pace reactions fire often, so a finite bank starts repeating inside one run
// however deep it is. Some of them come from the API instead.
const FRESH_PACE_CHANCE = 0.35;

// How long a stop is allowed to run before the trainer starts commenting on it,
// and how often they come back to it. Scaled by the chatter setting like
// everything else.
const LOITER_FIRST_MS = 45_000;
const LOITER_REPEAT_MS: [number, number] = [40_000, 70_000];

/** "23:41" / "1:02:07" — how an effort time reads aloud in a prompt. */
function formatEffort(sec: number): string {
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
    : `${m}:${s.toString().padStart(2, "0")}`;
}

function formatPaceShort(secPerKm: number | null): string | undefined {
  if (secPerKm === null || !isFinite(secPerKm) || secPerKm > 30 * 60) return undefined;
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function between([a, b]: [number, number]) {
  return a + Math.random() * (b - a);
}

/** Who's running — from their account profile, when they're signed in. */
export interface RunnerInfo {
  name?: string;
  age?: number;
  heightCm?: number;
  weightKg?: number;
  gender?: "female" | "male";
  /** Travel mode compares this against the GPS city mid-run. */
  homeCity?: string;
}

/** Highest kilometre with a pre-rendered marker phrase. Beyond it we improvise. */
const MAX_KM_MARKER = 21;

/**
 * The one thing that can't be pre-rendered, written out so the device voice
 * reads it as a duration rather than two bare numbers.
 */
function spokenDuration(totalSec: number): string {
  let m = Math.floor(totalSec / 60);
  let s = Math.round(totalSec % 60);
  if (s === 60) {
    m += 1;
    s = 0;
  }
  const mins = `${m} minute${m === 1 ? "" : "s"}`;
  const secs = `${s} second${s === 1 ? "" : "s"}`;
  if (m === 0) return secs;
  if (s === 0) return mins;
  return `${mins} ${secs}`;
}

export class CoachEngine {
  private persona: Persona;
  private voice: VoiceEngine;
  private used = new Set<string>();
  private nextEncourageAt = 0;
  private nextAnecdoteAt = 0;
  private lastPaceEventAt = 0;
  private lastKmAnnounced = 0;
  private disposed = false;
  private env: RunEnvironment | null = null;
  private chattiness = 1.0;
  private targetKm = 0;
  private targetMin = 0;
  private targetPaceSec = 0;
  private progressDone = new Set<number>();
  private openerDone = false;
  private pausedSince = 0;
  private nextLoiterAt = 0;
  private loiterLevel = 0;
  private runner: RunnerInfo | null = null;
  private history: RunHistoryDigest | null = null;
  private recordTold = new Set<"wr" | "hs">();
  /** Stored PRs from the account's history, and which have been beaten aloud. */
  private prs: { targetKm: number; sec: number; startedAt: number }[] | null = null;
  private prTold = new Set<number>();
  private cameoAt = 0; // when the second trainer barges in (0 = not scheduled)
  private cameoStarted = false;
  private nowPlaying: string | null = null;

  constructor(
    persona: Persona,
    voice: VoiceEngine,
    chattiness = 1.0,
    targetKm = 0,
    targetMin = 0,
    targetPaceSec = 0
  ) {
    this.persona = persona;
    this.voice = voice;
    this.chattiness = Math.min(2, Math.max(0.5, chattiness));
    this.targetKm = targetKm > 0 ? targetKm : 0;
    this.targetMin = targetMin > 0 ? targetMin : 0;
    this.targetPaceSec = targetPaceSec > 0 ? targetPaceSec : 0;
  }

  /** Treadmill (time-target) runs: checkpoints come off the clock. */
  private announceTimeProgress(stats: RunStats): boolean {
    const totalMs = this.targetMin * 60_000;
    const frac = stats.elapsedMs / totalMs;
    const next = PROGRESS_MARKS.find((m) => !this.progressDone.has(m) && frac >= m);
    if (next === undefined) return false;
    PROGRESS_MARKS.filter((m) => m <= next).forEach((m) => this.progressDone.add(m));

    if (next >= 1) {
      this.sayFromLibrary("target_hit");
      return true;
    }

    const remainingSec = Math.max(0, (totalMs - stats.elapsedMs) / 1000);
    if (!this.sayTargetCheckpoint("progress_time", this.targetMin, next)) {
      // Not a preset target (or not rendered yet) — generic line plus the
      // figures in the device voice.
      const left =
        remainingSec < 90
          ? `${Math.max(10, Math.round(remainingSec / 10) * 10)} seconds to go.`
          : `${Math.round(remainingSec / 60)} minutes to go.`;
      this.sayFromLibrary("progress");
      this.voice.say(
        `${Math.round(next * 100)} percent of your ${this.targetMin} minutes. ${left}`
      );
    }
    void this.fetchFresh("progress", stats, {
      targetMinutes: this.targetMin,
      progressPercent: Math.round(next * 100),
      remainingMinutes: Number((remainingSec / 60).toFixed(1)),
      treadmill: true,
    }).then((line) => {
      if (line && !this.disposed) this.voice.say(line.text, line.url);
    });
    return true;
  }

  /**
   * Fires once per checkpoint on the way to the target: the fractions the
   * runner asked for, then a tighter run-in as the finish approaches.
   * Returns true when something was said this tick.
   */
  private announceTargetProgress(stats: RunStats): boolean {
    const frac = stats.distanceKm / this.targetKm;
    const next = PROGRESS_MARKS.find((m) => !this.progressDone.has(m) && frac >= m);
    if (next === undefined) return false;

    // Everything at or below the crossed mark is now spent — prevents a burst
    // of back-to-back callouts if GPS delivers a big jump.
    PROGRESS_MARKS.filter((m) => m <= next).forEach((m) => this.progressDone.add(m));

    const remainingKm = Math.max(0, this.targetKm - stats.distanceKm);

    // The target landing on a whole kilometre would otherwise be announced twice.
    this.lastKmAnnounced = Math.max(this.lastKmAnnounced, Math.floor(stats.distanceKm));

    if (next >= 1) {
      this.sayFromLibrary("target_hit");
      return true;
    }

    if (!this.sayTargetCheckpoint("progress_km", this.targetKm, next)) {
      // Not a preset target (or not rendered yet) — generic line plus the
      // figures in the device voice.
      this.sayFromLibrary("progress");
      const left =
        remainingKm < 0.2
          ? `${Math.max(50, Math.round((remainingKm * 1000) / 10) * 10)} metres to go.`
          : `${remainingKm.toFixed(1)} kilometres to go.`;
      this.voice.say(`${Math.round(next * 100)} percent of your ${this.targetKm} K. ${left}`);
    }
    void this.fetchFresh("progress", stats, {
      targetKm: this.targetKm,
      progressPercent: Math.round(next * 100),
      remainingKm: Number(remainingKm.toFixed(2)),
    }).then((line) => {
      if (line && !this.disposed) this.voice.say(line.text, line.url);
    });
    return true;
  }

  /** Gap until the next scheduled interjection, scaled by the chatter setting. */
  private gap(range: [number, number]): number {
    return between(range) / this.chattiness;
  }

  /**
   * Retune mid-run. Rescaling whatever is already pending is the point: turning
   * the dial up should be audible soon, not after the interjection that was
   * already scheduled under the old setting finally comes round.
   */
  setChattiness(v: number) {
    const next = Math.min(2, Math.max(0.5, v));
    if (next === this.chattiness) return;
    const now = Date.now();
    const ratio = this.chattiness / next; // chattier => shorter remaining wait
    this.nextEncourageAt = now + Math.max(0, this.nextEncourageAt - now) * ratio;
    this.nextAnecdoteAt = now + Math.max(0, this.nextAnecdoteAt - now) * ratio;
    this.chattiness = next;
  }

  /** Weather + locality, fetched by the run screen once GPS locks on. */
  setEnvironment(env: RunEnvironment) {
    this.env = env;
  }

  /**
   * Mid-run trainer swap. Run state (records told, PRs beaten, checkpoints
   * crossed) survives — it belongs to the run, not the voice. The newcomer
   * announces themselves with one of their start lines; whatever the old
   * trainer had queued is dropped so the handover is clean.
   */
  setPersona(persona: Persona) {
    if (persona.id === this.persona.id || this.disposed) return;
    this.persona = persona;
    this.voice.setPersona(persona);
    this.voice.clearPending();
    this.sayFromLibrary("start");
  }

  /** The account's best 1/5/10km efforts, mined from history (lib/efforts). */
  setPersonalRecords(prs: { targetKm: number; sec: number; startedAt: number }[] | null) {
    this.prs = prs;
  }

  /**
   * Called each tick with the run's rolling best efforts: the first moment
   * one dips under the stored PR, the coach celebrates — once per distance
   * per run, with a haptic, in a live-generated line. Beating it "by a
   * clear second" filters float jitter at the boundary.
   */
  checkPersonalRecords(efforts: { targetKm: number; sec: number }[], stats: RunStats) {
    if (!this.prs || this.disposed) return;
    for (const e of efforts) {
      if (this.prTold.has(e.targetKm)) continue;
      const pr = this.prs.find((p) => p.targetKm === e.targetKm);
      if (!pr || e.sec >= pr.sec - 1) continue;
      this.prTold.add(e.targetKm);
      vibrate([60, 80, 60, 80, 120]);
      void this.fetchFresh("pr", stats, {
        prDistanceKm: e.targetKm,
        prNewTime: formatEffort(e.sec),
        prOldTime: formatEffort(pr.sec),
        prDaysAgo: Math.max(0, Math.round((Date.now() - pr.startedAt) / 86_400_000)),
      }).then((line) => {
        if (line && !this.disposed) this.voice.say(line.text, line.url);
      });
    }
  }

  /** Signed-in runner's profile — folded into every improvised line's context. */
  setRunner(runner: RunnerInfo | null) {
    this.runner = runner && Object.keys(runner).length > 0 ? runner : null;
  }

  /** What the runner has done before — so the trainer can actually remember. */
  setHistory(history: RunHistoryDigest | null) {
    this.history = history;
  }

  /** The runner's current Spotify track ("Song — Artist"), when connected. */
  setNowPlaying(track: string | null) {
    this.nowPlaying = track;
  }

  /** Library size + how much of it has pre-rendered ElevenLabs audio. */
  libraryStats() {
    return {
      total: allPhrasesFor(this.persona.id).length,
      rendered: renderedCount(this.persona.id),
    };
  }

  /** Everything the generator might want to weave into a line. */
  private buildContext(stats: RunStats, extra: Record<string, unknown> = {}) {
    const pace = stats.paceSecPerKm;
    const who = this.runner
      ? {
          runnerName: this.runner.name,
          runnerAge: this.runner.age,
          runnerHeightCm: this.runner.heightCm,
          runnerWeightKg: this.runner.weightKg,
          runnerGender: this.runner.gender,
        }
      : {};
    const past = this.history ? { runnerHistory: this.history } : {};
    const tune = this.nowPlaying ? { nowPlaying: this.nowPlaying } : {};
    // Travel mode: the GPS says a different city from the account's home
    // city — the live-generation prompt leans into running-as-a-visitor.
    const away =
      this.env?.city &&
      this.runner?.homeCity &&
      this.env.city.trim().toLowerCase() !== this.runner.homeCity.trim().toLowerCase()
        ? {
            travelCity: this.env.city,
            travelCountry: this.env.country ?? undefined,
            homeCity: this.runner.homeCity,
          }
        : {};
    // Treadmill runs have no GPS — omit distance, pace, speed and place so the
    // model never invents them.
    if (this.targetMin > 0) {
      return {
        ...who,
        ...past,
        ...tune,
        elapsedMin: Math.round(stats.elapsedMs / 60000),
        localTime: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        treadmill: true,
        targetMinutes: this.targetMin,
        ...extra,
      };
    }
    return {
      ...who,
      ...past,
      ...tune,
      distanceKm: Number(stats.distanceKm.toFixed(2)),
      elapsedMin: Math.round(stats.elapsedMs / 60000),
      localTime: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      paceMinPerKm: formatPaceShort(pace),
      avgPaceMinPerKm: formatPaceShort(stats.avgPaceSecPerKm),
      targetPaceMinPerKm:
        this.targetPaceSec > 0 ? formatPaceShort(this.targetPaceSec) : undefined,
      speedKmh:
        stats.speedNowKmh !== null
          ? Number(stats.speedNowKmh.toFixed(1))
          : pace
            ? Number((3600 / pace).toFixed(1))
            : undefined,
      locality: this.env?.locality ?? undefined,
      ...away,
      weather: this.env?.tempC
        ? `${this.env.weatherDesc ?? "unknown"}, ${this.env.tempC}°C` +
          (this.env.feelsLikeC && this.env.feelsLikeC !== this.env.tempC
            ? ` (feels like ${this.env.feelsLikeC}°C)`
            : "")
        : undefined,
      ...extra,
    };
  }


  /** Does this phrase's time-of-day / weather condition hold right now? */
  private conditionOk(p: Phrase): boolean {
    if (!p.condition) return true;
    const now = this.currentConditions();
    return Array.isArray(p.condition)
      ? p.condition.some((c) => now.includes(c))
      : now.includes(p.condition);
  }

  private pick(category: PhraseCategory): Phrase | null {
    const pool = allPhrasesFor(this.persona.id, category).filter((p) => this.conditionOk(p));
    if (pool.length === 0) return null;
    const fresh = pool.filter((p) => !this.used.has(p.id));
    const source = fresh.length > 0 ? fresh : pool;
    if (fresh.length === 0) pool.forEach((p) => this.used.delete(p.id)); // recycle
    const phrase = source[Math.floor(Math.random() * source.length)];
    this.used.add(phrase.id);
    return phrase;
  }

  private sayFromLibrary(category: PhraseCategory) {
    const phrase = this.pick(category);
    if (!phrase) return;
    this.voice.say(phrase.text, getPhraseUrl(this.persona.id, phrase.id));
  }

  onRunStart() {
    const now = Date.now();
    this.nextEncourageAt = now + this.gap(ENCOURAGE_GAP_MS);
    this.nextAnecdoteAt = now + this.gap(ANECDOTE_GAP_MS);
    // Once per run, somewhere in minutes 5–12, a second trainer barges in.
    // Not scaled by chattiness — it's the run's one set-piece.
    this.cameoAt = now + (5 + Math.random() * 7) * 60_000;

    // ~10s intro at the start line. Prefer a freshly generated one (never the
    // same twice), but don't leave the runner in silence: if the API hasn't
    // answered within 2.5s, fall back to the library rotation and let the
    // stale response die quietly.
    const zeroStats: RunStats = {
      elapsedMs: 0,
      distanceKm: 0,
      paceSecPerKm: null,
      avgPaceSecPerKm: null,
      speedNowKmh: null,
      lastKmSpeedKmh: null,
      avgSpeedKmh: null,
      splits: [],
      route: [],
    };
    const fresh = this.fetchFresh("intro", zeroStats);
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), 2500));
    void Promise.race([fresh, timeout]).then((winner) => {
      if (this.disposed) return;
      if (winner) this.voice.say(winner.text, winner.url);
      else this.sayIntroFromLibrary();
    });
  }

  /**
   * A checkpoint on one of the preset targets. Both the target and the
   * fraction are known up front, so the remaining distance or time is exact
   * and lives in the recording — nothing here falls through to the device
   * voice. Returns false for a target we have no line for, so the caller can
   * fall back to reading the figures out.
   */
  private sayTargetCheckpoint(
    category: "progress_km" | "progress_time",
    target: number,
    fraction: number
  ): boolean {
    // Marks are stored as whole percents: 1/3 and 2/3 would never survive a
    // float comparison.
    const mark = Math.round(fraction * 100);
    const phrase = allPhrasesFor(this.persona.id, category).find(
      (p) => p.target === target && p.mark === mark
    );
    if (!phrase) return false;
    this.voice.say(phrase.text, getPhraseUrl(this.persona.id, phrase.id));
    return true;
  }

  /**
   * Announce the kilometre just completed. Each number has its own pre-rendered
   * line, so "seven kilometres" is spoken by the persona rather than by the
   * device. Past the rendered range it degrades to a generic milestone line
   * plus the bare number.
   */
  private sayKmMarker(km: number) {
    const marker = allPhrasesFor(this.persona.id, "km_marker").find((p) => p.km === km);
    if (marker) {
      this.voice.say(marker.text, getPhraseUrl(this.persona.id, marker.id));
      return;
    }
    this.sayFromLibrary("milestone");
    this.voice.say(`${km} kilometres.`);
  }

  /**
   * How long the kilometre that just finished took. The recorded split is the
   * truth — it already excludes paused time — but the coach ticks on its own
   * timer and the split lands on a GPS update, so on the odd tick it isn't in
   * yet and the tracker's rolling last-kilometre average stands in.
   */
  private lastKmPaceSec(stats: RunStats, km: number): number | null {
    const split = stats.splits[km - 1];
    let sec: number | null = null;
    if (typeof split === "number" && split > 0) sec = split / 1000;
    else if (stats.lastKmSpeedKmh && stats.lastKmSpeedKmh > 0)
      sec = 3600 / stats.lastKmSpeedKmh;
    // Anything slower than 30 min/km means the data is wrong, not the runner.
    return sec !== null && sec > 60 && sec < 30 * 60 ? sec : null;
  }

  /** Everything true about right now that a pre-rendered line could key off. */
  private currentConditions(): PhraseCondition[] {
    const out: PhraseCondition[] = [];
    const desc = this.env?.weatherDesc?.toLowerCase() ?? "";
    if (/rain|drizzle|shower|thunder/.test(desc)) out.push("rain");
    const feels = this.env?.feelsLikeC ?? this.env?.tempC ?? null;
    if (feels !== null && feels >= 31) out.push("hot");
    if (feels !== null && feels <= 20) out.push("cool");
    const h = new Date().getHours();
    out.push(
      h < 7 ? "dawn" : h < 11 ? "morning" : h < 15 ? "midday" : h < 19 ? "evening" : "night"
    );
    return out;
  }

  /**
   * One pre-rendered line, chosen live: an early start, the afternoon heat,
   * the rain you decided to run in anyway. Weather and time-of-day lines are
   * pooled together and picked from at random, so a hot rainy morning doesn't
   * always open the same way.
   */
  private sayConditionalOpener() {
    const conditions = this.currentConditions();
    const pool = allPhrasesFor(this.persona.id, "conditional").filter((p) =>
      Array.isArray(p.condition)
        ? p.condition.some((c) => conditions.includes(c))
        : p.condition !== undefined && conditions.includes(p.condition)
    );
    if (pool.length === 0) return;
    const phrase = pool[Math.floor(Math.random() * pool.length)];
    this.voice.say(phrase.text, getPhraseUrl(this.persona.id, phrase.id));
  }

  /**
   * Delayed start marks. The library bank is written in order — [10 seconds,
   * 5 seconds] — so the caller passes the index, and it comes out in the
   * persona's own voice like everything else.
   */
  sayCountdown(index: number) {
    const pool = allPhrasesFor(this.persona.id, "countdown");
    const phrase = pool[index];
    if (!phrase) return;
    this.voice.say(phrase.text, getPhraseUrl(this.persona.id, phrase.id));
  }

  /** Round-robin through the intro monologues, persisted across runs. */
  private sayIntroFromLibrary() {
    const pool = allPhrasesFor(this.persona.id, "intro").filter((p) => this.conditionOk(p));
    if (pool.length === 0) {
      this.sayFromLibrary("start");
      return;
    }
    const key = `runbuddy-intro-${this.persona.id}`;
    let idx = 0;
    try {
      idx = (parseInt(localStorage.getItem(key) ?? "0", 10) || 0) % pool.length;
      localStorage.setItem(key, String((idx + 1) % pool.length));
    } catch {
      idx = Math.floor(Math.random() * pool.length);
    }
    const phrase = pool[idx];
    this.voice.say(phrase.text, getPhraseUrl(this.persona.id, phrase.id));
  }

  onPause() {
    this.beginPause();
    this.sayFromLibrary("paused");
  }

  onResume() {
    this.endPause();
    this.sayFromLibrary("resumed");
  }

  /**
   * The app paused itself because the runner stopped moving. Announce it —
   * the phone is in an arm sleeve and the frozen clock is invisible from there.
   */
  onAutoPause() {
    this.beginPause();
    this.sayFromLibrary("auto_paused");
  }

  onAutoResume() {
    this.endPause();
    this.sayFromLibrary("auto_resumed");
  }

  private beginPause() {
    const now = Date.now();
    this.pausedSince = now;
    this.loiterLevel = 0;
    this.nextLoiterAt = now + LOITER_FIRST_MS / this.chattiness;
  }

  private endPause() {
    const now = Date.now();
    this.pausedSince = 0;
    this.nextEncourageAt = now + this.gap(ENCOURAGE_GAP_MS) / 2;
  }

  /**
   * Called every second while the run is paused, however it got paused. Stand
   * around long enough and the trainer starts having opinions about it — each
   * one a step further along their persona's escalation.
   */
  tickPaused(stats: RunStats) {
    if (this.disposed || this.voice.busy || this.pausedSince === 0) return;
    const now = Date.now();
    if (now < this.nextLoiterAt) return;

    const stoppedSec = Math.round((now - this.pausedSince) / 1000);
    this.nextLoiterAt = now + this.gap(LOITER_REPEAT_MS);
    const level = this.loiterLevel++;

    // The library lines are written mildest-first, so walking the index is the
    // escalation. Once past the end of the bank, ask for something fresh.
    const pool = allPhrasesFor(this.persona.id, "loitering");
    if (level < pool.length) {
      const phrase = pool[level];
      this.voice.say(phrase.text, getPhraseUrl(this.persona.id, phrase.id));
      return;
    }
    void this.sayFresh("loitering", stats, { pausedSeconds: stoppedSec });
  }

  onFinish() {
    // The run is over: whatever mid-run chatter is still waiting its turn
    // (an anecdote, a pace nudge, a km line) is stale the moment the button
    // is pressed — drop it, let the line already speaking finish, and make
    // the sign-off the only thing left in the queue. Disposing right after
    // slams the door on every in-flight async (a cameo script landing late,
    // a milestone colour line resolving) so nothing new can slip in behind
    // it; the summary screen's closing comment plays through its own player.
    this.voice.clearPending();
    // Library only. The numeric recap that used to follow had no pre-rendered
    // audio by definition, so it always came out in the robotic fallback voice
    // — as the last thing you heard. The summary screen says the same numbers
    // straight after, in-persona and properly voiced, and the card shows them.
    this.sayFromLibrary("finish");
    this.dispose();
  }

  tick(stats: RunStats) {
    // `busy` covers anything still queued, not just what's audible right now —
    // so scheduled interjections wait their turn instead of stacking up.
    if (this.disposed || this.voice.busy) return;
    const now = Date.now();

    // 0a. The condition-keyed opener, once, as soon as the intro has finished
    // speaking. Waits briefly for the weather to land, then goes with the time
    // of day alone rather than missing the start of the run entirely.
    if (
      !this.openerDone &&
      stats.elapsedMs > 12_000 &&
      (this.env !== null || stats.elapsedMs > 40_000)
    ) {
      this.openerDone = true;
      this.sayConditionalOpener();
      return;
    }

    // 0a½. The cameo kicks off its API round-trip in the background — nothing
    // is spoken until the finished script arrives, so no return here. Fired
    // from tick so it can't land mid-pause.
    if (this.cameoAt > 0 && !this.cameoStarted && now >= this.cameoAt) {
      this.cameoStarted = true;
      void this.playCameo(stats);
    }

    // 0b. Target progress takes priority over everything else.
    if (this.targetMin > 0) {
      // Treadmill: no GPS, so distance and pace cues below don't apply —
      // only clock checkpoints, encouragement and anecdotes.
      if (this.announceTimeProgress(stats)) return;
      this.tickAmbient(stats, now);
      return;
    }
    if (this.targetKm > 0 && this.announceTargetProgress(stats)) return;

    // 0c. Record moments, each once per run, preset distance targets only —
    // the record holder matched to the runner's account gender, male when
    // unset. Two kinds: the US high-school record holder's LITERAL race time
    // at this distance (5 and 10 km only), and the elapsed time where the
    // marathon WR holder's record pace would finish this target. On a male
    // 10K the schoolboy pips the world-record holder by two seconds — both
    // lines fire, back to back, which is exactly the joke.
    if (this.targetKm > 0) {
      const g = this.runner?.gender === "female" ? "female" : "male";
      const moments: ["hs" | "wr", number | null][] = [
        ["hs", hsFinishMs(g, this.targetKm)],
        ["wr", wrFinishMs(g, this.targetKm)],
      ];
      for (const [kind, atMs] of moments) {
        if (atMs === null || this.recordTold.has(kind) || stats.elapsedMs < atMs) continue;
        this.recordTold.add(kind); // never re-check, even when no line exists
        const phrase = allPhrasesFor(
          this.persona.id,
          kind === "hs" ? "hs_finish" : "wr_finish"
        ).find((p) => p.target === this.targetKm && p.wr === g);
        if (phrase) {
          // A record moment is the run's fireworks — announce it to the wrist
          // too (real haptics in the shell, silent elsewhere).
          vibrate([60, 80, 60, 80, 120]);
          this.voice.say(phrase.text, getPhraseUrl(this.persona.id, phrase.id));
          return;
        }
      }
    }

    // 1. Kilometre milestones (highest priority). The callout itself is
    // library-only so it lands instantly; improvised colour commentary
    // ("4K down in Bishan, in this rain somemore…") is layered on top when
    // the API answers, and stays silent when it doesn't.
    const km = Math.floor(stats.distanceKm);
    if (km > this.lastKmAnnounced) {
      this.lastKmAnnounced = km;
      this.sayKmMarker(km);
      // The split for the kilometre just finished — not the whole-run average,
      // so it tells you how the last kilometre actually went. Only the figure
      // itself falls through to the device voice; the sentence around it is
      // pre-rendered.
      const lastKmSec = this.lastKmPaceSec(stats, km);
      if (lastKmSec !== null) {
        this.sayFromLibrary("pace_lead");
        this.voice.say(spokenDuration(lastKmSec));
      }
      void this.fetchFresh("milestone", stats, {
        kmMarker: km,
        lastKmPaceMinPerKm: lastKmSec !== null ? formatPaceShort(lastKmSec) : undefined,
      }).then((color) => {
        if (color && !this.disposed) this.voice.say(color.text, color.url);
      });
      this.nextEncourageAt = now + this.gap(ENCOURAGE_GAP_MS);
      return;
    }

    // 2. Pace reactions. With a target pace set, the yardstick is the target
    // and the coach checks in every cooldown — good pace or pick it up,
    // whichever is true right now. Without one, only a real deviation from
    // the runner's own average earns a comment.
    if (this.targetPaceSec > 0) {
      if (
        now - this.lastPaceEventAt > PACE_COOLDOWN_MS &&
        stats.paceSecPerKm !== null &&
        stats.elapsedMs > PACE_TARGET_MIN_ELAPSED_MS
      ) {
        const ratio = stats.paceSecPerKm / this.targetPaceSec;
        // Inside the dead band (0–4% over): say nothing, check again shortly —
        // half the cooldown, so a marginal stretch resolves quickly.
        if (ratio > PACE_TARGET_SLOW) {
          this.lastPaceEventAt = now;
          if (Math.random() < FRESH_PACE_CHANCE) void this.sayFresh("pace_up", stats);
          else this.sayFromLibrary("pace_up");
          return;
        }
        if (ratio <= PACE_TARGET_GOOD) {
          this.lastPaceEventAt = now;
          if (Math.random() < FRESH_PACE_CHANCE) void this.sayFresh("pace_down", stats);
          else this.sayFromLibrary("pace_down");
          return;
        }
        this.lastPaceEventAt = now - PACE_COOLDOWN_MS / 2;
      }
    } else if (
      now - this.lastPaceEventAt > PACE_COOLDOWN_MS &&
      stats.paceSecPerKm !== null &&
      stats.avgPaceSecPerKm !== null &&
      stats.elapsedMs > 180_000
    ) {
      const ratio = stats.paceSecPerKm / stats.avgPaceSecPerKm;
      if (ratio > 1.18) {
        this.lastPaceEventAt = now;
        if (Math.random() < FRESH_PACE_CHANCE) void this.sayFresh("pace_up", stats);
        else this.sayFromLibrary("pace_up");
        return;
      }
      if (ratio < 0.85) {
        this.lastPaceEventAt = now;
        if (Math.random() < FRESH_PACE_CHANCE) void this.sayFresh("pace_down", stats);
        else this.sayFromLibrary("pace_down");
        return;
      }
    }

    this.tickAmbient(stats, now);
  }

  /** Anecdotes and periodic encouragement — the cues that need no GPS. */
  private tickAmbient(stats: RunStats, now: number) {
    if (now >= this.nextAnecdoteAt) {
      this.nextAnecdoteAt = now + this.gap(ANECDOTE_GAP_MS);
      if (Math.random() < FRESH_ANECDOTE_CHANCE) {
        void this.sayFresh("anecdote", stats);
      } else {
        this.sayFromLibrary("anecdote");
      }
      return;
    }

    if (now >= this.nextEncourageAt) {
      this.nextEncourageAt = now + this.gap(ENCOURAGE_GAP_MS);
      if (Math.random() < FRESH_ENCOURAGE_CHANCE) {
        void this.sayFresh("encourage", stats);
      } else {
        this.sayFromLibrary("encourage");
      }
    }
  }

  /**
   * The run's set-piece: a second trainer barges in and the two argue about
   * the runner's live numbers — a fresh four-line script every run, each line
   * voiced by its own speaker. Waits for a quiet moment before queueing so
   * all four lines fit the voice queue intact, and vanishes silently on any
   * failure — a cameo that half-happens is worse than none.
   */
  private async playCameo(stats: RunStats) {
    const others = (Object.keys(PERSONAS) as PersonaId[]).filter(
      (id) => id !== this.persona.id
    );
    const cameoId = others[Math.floor(Math.random() * others.length)];
    try {
      const res = await fetch("/api/cameo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona: this.persona.id,
          cameo: cameoId,
          context: this.buildContext(stats),
        }),
      });
      if (!res.ok) return;
      const data: { lines: { persona: PersonaId; text: string; audioBase64: string }[] } =
        await res.json();
      if (this.disposed || !data.lines?.length) return;
      // Let whatever is playing finish: the queue holds exactly four entries,
      // so queueing into a busy moment would clip the skit's opening.
      const waitStart = Date.now();
      while (this.voice.busy && Date.now() - waitStart < 45_000) {
        await new Promise((r) => setTimeout(r, 300));
        if (this.disposed) return;
      }
      if (this.disposed) return;
      for (const line of data.lines.slice(0, 4)) {
        const name = PERSONAS[line.persona]?.shortName ?? "";
        // Each line at its OWN speaker's admin level — without this, the
        // guest's lines play at the host persona's setting.
        this.voice.say(
          `${name}: ${line.text}`,
          `data:audio/mpeg;base64,${line.audioBase64}`,
          getVoiceVolume(line.persona)
        );
      }
    } catch {
      /* no keys, offline, model hiccup — the run just proceeds cameo-less */
    }
  }

  /** Fetch a freshly generated phrase (Claude + ElevenLabs). Null on any failure. */
  private async fetchFresh(
    category: PhraseCategory,
    stats: RunStats,
    extra: Record<string, unknown> = {}
  ): Promise<{ text: string; url?: string } | null> {
    try {
      const res = await fetch("/api/phrase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona: this.persona.id,
          category,
          context: this.buildContext(stats, extra),
        }),
      });
      if (!res.ok) return null;
      const data: { text: string; audioBase64?: string } = await res.json();
      return {
        text: data.text,
        url: data.audioBase64 ? `data:audio/mpeg;base64,${data.audioBase64}` : undefined,
      };
    } catch {
      return null;
    }
  }

  /** Speak a freshly generated phrase, falling back to the library. */
  private async sayFresh(
    category: PhraseCategory,
    stats: RunStats,
    extra: Record<string, unknown> = {}
  ) {
    const fresh = await this.fetchFresh(category, stats, extra);
    if (this.disposed) return;
    if (fresh) this.voice.say(fresh.text, fresh.url);
    else this.sayFromLibrary(category); // library always has our back
  }

  /** Push-to-talk: send what the runner said, speak the reply. */
  async respondTo(userSpeech: string, stats: RunStats) {
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona: this.persona.id,
          message: userSpeech,
          context: this.buildContext(stats),
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data: { text: string; audioBase64?: string } = await res.json();
      const url = data.audioBase64 ? `data:audio/mpeg;base64,${data.audioBase64}` : undefined;
      this.voice.say(data.text, url);
    } catch {
      this.sayFromLibrary("chat");
    }
  }

  dispose() {
    this.disposed = true;
  }
}
