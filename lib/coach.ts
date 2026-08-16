import { phrasesFor } from "./phrases";
import type { Persona, Phrase, PhraseCategory, RunStats } from "./types";
import type { VoiceEngine } from "./audio";
import type { RunEnvironment } from "./enviro";

// CoachEngine — decides WHAT the trainer says and WHEN.
// tick() is called ~1x/second by the run screen with fresh stats.

const ENCOURAGE_GAP_MS: [number, number] = [50_000, 95_000];
const ANECDOTE_GAP_MS: [number, number] = [180_000, 300_000];
const PACE_COOLDOWN_MS = 120_000;
const FRESH_ANECDOTE_CHANCE = 0.5; // odds an anecdote slot asks the API for new material
const FRESH_MILESTONE_CHANCE = 0.5; // odds a km marker gets a live stat-aware callout
const FRESH_ENCOURAGE_CHANCE = 0.25; // odds regular encouragement is freshly generated

function formatPaceShort(secPerKm: number | null): string | undefined {
  if (secPerKm === null || !isFinite(secPerKm) || secPerKm > 30 * 60) return undefined;
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function between([a, b]: [number, number]) {
  return a + Math.random() * (b - a);
}

export class CoachEngine {
  private persona: Persona;
  private voice: VoiceEngine;
  private used = new Set<string>();
  private rendered = new Set<string>(); // phrase ids with a pre-rendered mp3
  private nextEncourageAt = 0;
  private nextAnecdoteAt = 0;
  private lastPaceEventAt = 0;
  private lastKmAnnounced = 0;
  private disposed = false;
  private env: RunEnvironment | null = null;

  constructor(persona: Persona, voice: VoiceEngine) {
    this.persona = persona;
    this.voice = voice;
    void this.loadManifest();
  }

  /** Weather + locality, fetched by the run screen once GPS locks on. */
  setEnvironment(env: RunEnvironment) {
    this.env = env;
  }

  /** Everything the generator might want to weave into a line. */
  private buildContext(stats: RunStats, extra: Record<string, unknown> = {}) {
    const pace = stats.paceSecPerKm;
    return {
      distanceKm: Number(stats.distanceKm.toFixed(2)),
      elapsedMin: Math.round(stats.elapsedMs / 60000),
      localTime: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      paceMinPerKm: formatPaceShort(pace),
      avgPaceMinPerKm: formatPaceShort(stats.avgPaceSecPerKm),
      speedKmh: pace ? Number((3600 / pace).toFixed(1)) : undefined,
      locality: this.env?.locality ?? undefined,
      weather: this.env?.tempC
        ? `${this.env.weatherDesc ?? "unknown"}, ${this.env.tempC}°C` +
          (this.env.feelsLikeC && this.env.feelsLikeC !== this.env.tempC
            ? ` (feels like ${this.env.feelsLikeC}°C)`
            : "")
        : undefined,
      ...extra,
    };
  }

  private async loadManifest() {
    try {
      const res = await fetch(`/audio/${this.persona.id}/manifest.json`);
      if (res.ok) {
        const ids: string[] = await res.json();
        ids.forEach((id) => this.rendered.add(id));
      }
    } catch {
      // No rendered library yet — speech synthesis carries the whole show.
    }
  }

  private pick(category: PhraseCategory): Phrase | null {
    const pool = phrasesFor(this.persona.id, category);
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
    const url = this.rendered.has(phrase.id)
      ? `/audio/${this.persona.id}/${phrase.id}.mp3`
      : undefined;
    this.voice.say(phrase.text, url);
  }

  onRunStart() {
    const now = Date.now();
    this.nextEncourageAt = now + between(ENCOURAGE_GAP_MS);
    this.nextAnecdoteAt = now + between(ANECDOTE_GAP_MS);
    this.sayFromLibrary("start");
  }

  onPause() {
    this.sayFromLibrary("paused");
  }

  onResume() {
    const now = Date.now();
    this.nextEncourageAt = now + between(ENCOURAGE_GAP_MS) / 2;
    this.sayFromLibrary("resumed");
  }

  onFinish(stats: RunStats) {
    this.sayFromLibrary("finish");
    const km = stats.distanceKm.toFixed(2);
    const mins = Math.round(stats.elapsedMs / 60000);
    this.voice.say(`${km} kilometres in about ${mins} minutes.`);
  }

  tick(stats: RunStats) {
    if (this.disposed || this.voice.speaking) return;
    const now = Date.now();

    // 1. Kilometre milestones (highest priority). Half the time we ask the
    // server for a live, stat-aware callout ("4K down in Bishan, 6:10 pace,
    // in this rain somemore…"); otherwise library phrase + spoken stats.
    const km = Math.floor(stats.distanceKm);
    if (km > this.lastKmAnnounced) {
      this.lastKmAnnounced = km;
      if (Math.random() < FRESH_MILESTONE_CHANCE) {
        void this.sayFresh("milestone", stats, { kmMarker: km });
      } else {
        this.sayFromLibrary("milestone");
        const pace = stats.avgPaceSecPerKm;
        if (pace) {
          const m = Math.floor(pace / 60);
          const s = Math.round(pace % 60);
          this.voice.say(
            `That's ${km} kilometre${km > 1 ? "s" : ""}. Average pace ${m} ${s} per kilometre.`
          );
        }
      }
      this.nextEncourageAt = now + between(ENCOURAGE_GAP_MS);
      return;
    }

    // 2. Pace reactions
    if (
      now - this.lastPaceEventAt > PACE_COOLDOWN_MS &&
      stats.paceSecPerKm !== null &&
      stats.avgPaceSecPerKm !== null &&
      stats.elapsedMs > 180_000
    ) {
      const ratio = stats.paceSecPerKm / stats.avgPaceSecPerKm;
      if (ratio > 1.18) {
        this.lastPaceEventAt = now;
        this.sayFromLibrary("pace_up");
        return;
      }
      if (ratio < 0.85) {
        this.lastPaceEventAt = now;
        this.sayFromLibrary("pace_down");
        return;
      }
    }

    // 3. Anecdotes / nuggets
    if (now >= this.nextAnecdoteAt) {
      this.nextAnecdoteAt = now + between(ANECDOTE_GAP_MS);
      if (Math.random() < FRESH_ANECDOTE_CHANCE) {
        void this.sayFresh("anecdote", stats);
      } else {
        this.sayFromLibrary("anecdote");
      }
      return;
    }

    // 4. Regular encouragement / scolding
    if (now >= this.nextEncourageAt) {
      this.nextEncourageAt = now + between(ENCOURAGE_GAP_MS);
      if (Math.random() < FRESH_ENCOURAGE_CHANCE) {
        void this.sayFresh("encourage", stats);
      } else {
        this.sayFromLibrary("encourage");
      }
    }
  }

  /** Ask the server for a freshly generated phrase (Claude + ElevenLabs). Silent on failure. */
  private async sayFresh(
    category: PhraseCategory,
    stats: RunStats,
    extra: Record<string, unknown> = {}
  ) {
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
      if (!res.ok) throw new Error(String(res.status));
      const data: { text: string; audioBase64?: string } = await res.json();
      const url = data.audioBase64 ? `data:audio/mpeg;base64,${data.audioBase64}` : undefined;
      this.voice.say(data.text, url);
    } catch {
      this.sayFromLibrary(category); // library always has our back
    }
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
