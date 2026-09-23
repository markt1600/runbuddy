"use client";

import { useEffect, useState } from "react";
import { PERSONAS, PERSONA_LIST } from "@/lib/personas";
import {
  adminPinHeaders,
  allPhrasesFor,
  expandLibrary,
  getPhraseUrl,
  getPhraseRenderedAt,
  getVoiceSpeed,
  getVoiceVolume,
  libraryFlags,
  lifetimeStats,
  loadLibraryState,
  paceFigureStatus,
  playPhrase,
  renderPaceFigures,
  reRenderPersona,
  renderMissingPhrases,
  reRenderPhrase,
  reRenderStale,
  renderedCount,
  renderedUrlsFor,
  isPhraseStale,
  isPromoted,
  promotedPhrases,
  stalePhrases,
  saveVoiceSpeed,
  saveVoiceVolume,
  setClipLoudness,
  storeAdminPin,
  type GenerationProgress,
} from "@/lib/voiceLibrary";
import {
  measureFiles,
  measureLoudness,
  meanDb,
  quietThresholdDb,
  referenceLevelToFitAll,
  sampleUrls,
  suggestedVolume,
  type LoudnessReading,
} from "@/lib/loudness";
import { EXPANDABLE_CATEGORIES, FIXED_CATEGORY_REASON } from "@/lib/phraseCategories";
import { formatElapsed, formatPace } from "@/lib/geo";
import RunDetailScreen from "./RunDetailScreen";
import type { PersonaId, PhraseCategory } from "@/lib/types";

const CATEGORY_LABELS: Record<PhraseCategory, string> = {
  intro: "Start-line intros",
  start: "Run starts",
  encourage: "Encouragement",
  pace_up: "Pace up (too slow)",
  pace_down: "Pace down (flying)",
  milestone: "Km milestones (generic)",
  km_marker: "Km markers (one per km)",
  pace_lead: "Pace lead-ins",
  anecdote: "Anecdotes & facts",
  finish: "Finishes",
  paused: "Paused",
  resumed: "Resumed",
  conditional: "Weather & time-of-day openers",
  countdown: "Delayed start countdown",
  auto_paused: "Auto-pause announcements",
  auto_resumed: "Auto-resume announcements",
  loitering: "Standing around too long",
  chat: "Chat replies",
  summary: "Run summaries",
  progress: "Target progress (generic)",
  progress_km: "Distance-target checkpoints",
  progress_time: "Time-target checkpoints",
  target_hit: "Target reached",
  wr_finish: "World-record moments",
  hs_finish: "High-school-record moments",
  pr: "Personal-record moments",
  duo_react: "Duo reactions",
  pace_figure: "Pace figures (split read-outs)",
};

const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as PhraseCategory[];

/** Phrases written per tap. Small enough to judge the results before adding more. */
const EXPAND_BATCH = 5;

interface Props {
  onBack: () => void;
}

interface AdminUser {
  uid: string;
  name: string;
  email?: string;
  picture?: string;
  firstSeen: number;
  lastSeen: number;
  runCount: number;
}

interface AdminRun {
  id: string;
  startedAt: number;
  distanceKm: number;
  movingSec: number;
  wallSec: number;
  personaId: string;
  treadmill?: boolean;
  targetMinutes?: number;
  targetKm?: number;
  targetPaceSec?: number;
}

/** What the runner set out to do, from the run's saved configuration. */
function targetLabel(run: AdminRun): string {
  if (run.treadmill && run.targetMinutes) return `${run.targetMinutes} min target (treadmill)`;
  if (run.targetKm) return `${run.targetKm} km target`;
  if (run.targetPaceSec) {
    const m = Math.floor(run.targetPaceSec / 60);
    const s = run.targetPaceSec % 60;
    return `${m}:${s.toString().padStart(2, "0")} /km target`;
  }
  return "free run";
}

export default function AdminScreen({ onBack }: Props) {
  const [lock, setLock] = useState<"checking" | "locked" | "unlocked">("checking");
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);
  const [personaId, setPersonaId] = useState<PersonaId>("ahbeng");
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [renderingFigures, setRenderingFigures] = useState(false);
  const [expanding, setExpanding] = useState<PhraseCategory | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // "Re-render these": a pasted id list for the cases the stale check cannot
  // see — audio cut before hash tracking has no provenance, so a reworded
  // phrase from that era is reported current and only a named list reaches it.
  const [idList, setIdList] = useState("");
  const [speeds, setSpeeds] = useState<Record<PersonaId, number>>(
    () =>
      Object.fromEntries(
        PERSONA_LIST.map((p) => [p.id, p.elevenLabsSpeed])
      ) as Record<PersonaId, number>
  );
  const [savingSpeed, setSavingSpeed] = useState<PersonaId | null>(null);
  const [volumes, setVolumes] = useState<Record<PersonaId, number>>(
    () =>
      Object.fromEntries(PERSONA_LIST.map((p) => [p.id, p.playbackVolume])) as Record<
        PersonaId,
        number
      >
  );
  const [savingVolume, setSavingVolume] = useState<PersonaId | null>(null);
  // Measured loudness of each trainer's rendered audio (a sample per trainer),
  // and the reference every suggestion is normalised against.
  const [loud, setLoud] = useState<Partial<Record<PersonaId, LoudnessReading>>>({});
  const [measuring, setMeasuring] = useState<{ persona: PersonaId; done: number; total: number } | null>(
    null
  );
  const LEVEL_REFERENCE: PersonaId = "ahbeng";
  const LEVEL_SAMPLE = 12;
  // Per-trainer level check: every synthesized file measured, the quiet
  // outliers re-rendered, before/after reported.
  // Kept as typed: clamping on every keystroke turned "30" into 5 then 50
  // (clearing the field read as 0 and snapped to the default; the first digit
  // snapped to the minimum). The number is tidied when the field is left or
  // the check runs.
  const [checkPctText, setCheckPctText] = useState("20");
  const checkPct = Math.min(80, Math.max(5, Number(checkPctText) || 20));
  const [check, setCheck] = useState<{
    persona: PersonaId;
    phase: "measuring" | "rendering" | "done";
    done: number;
    total: number;
    measured: number;
    avgDb: number;
    thresholdDb: number;
    results: {
      id: string;
      category: string;
      before: number;
      after: number | null;
      /** Why `after` is missing: the store kept serving the old bytes. */
      stale?: boolean;
    }[];
  } | null>(null);
  const [redoing, setRedoing] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [usersNote, setUsersNote] = useState<string | null>(null);
  const [openUser, setOpenUser] = useState<AdminUser | null>(null);
  const [userRuns, setUserRuns] = useState<AdminRun[] | null>(null);
  // A run opened from the admin list — the runner's own detail view, read-only.
  const [openRun, setOpenRun] = useState<AdminRun | null>(null);
  const [, bump] = useState(0); // re-render as the registry mutates
  const refresh = () => bump((n) => n + 1);

  useEffect(() => {
    // PIN gate: no ADMIN_PIN on the server → open; else try the session's
    // stored pin, else ask.
    void (async () => {
      try {
        const res = await fetch("/api/admin/verify");
        const { required } = await res.json();
        if (!required) return setLock("unlocked");
        const stored = adminPinHeaders()["x-admin-pin"];
        if (stored) {
          const check = await fetch("/api/admin/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pin: stored }),
          });
          if (check.ok) return setLock("unlocked");
        }
        setLock("locked");
      } catch {
        setLock("locked");
      }
    })();
    void fetch("/api/admin/users")
      .then(async (res) => {
        if (res.ok) return res.json();
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      })
      .then((data: { users: AdminUser[] }) => setUsers(data.users))
      .catch((err) => setUsersNote(err instanceof Error ? err.message : "unavailable"));
    void loadLibraryState(true).then(() => {
      setReady(true);
      setSpeeds(
        Object.fromEntries(PERSONA_LIST.map((p) => [p.id, getVoiceSpeed(p.id)])) as Record<
          PersonaId,
          number
        >
      );
      setVolumes(
        Object.fromEntries(PERSONA_LIST.map((p) => [p.id, getVoiceVolume(p.id)])) as Record<
          PersonaId,
          number
        >
      );
      refresh();
    });
  }, []);

  const onSaveSpeed = async (id: PersonaId) => {
    setSavingSpeed(id);
    setNotice(null);
    try {
      await saveVoiceSpeed(id, speeds[id]);
      setNotice(
        `✓ ${PERSONAS[id].name} voice speed saved (${speeds[id].toFixed(2)}×). ` +
          "Re-render to apply it to existing audio."
      );
    } catch (err) {
      setNotice(`⚠ ${err instanceof Error ? err.message : "save failed"}`);
    } finally {
      setSavingSpeed(null);
    }
  };

  const onSaveVolume = async (id: PersonaId) => {
    setSavingVolume(id);
    setNotice(null);
    try {
      await saveVoiceVolume(id, volumes[id]);
      setNotice(
        `✓ ${PERSONAS[id].name} level saved (${Math.round(volumes[id] * 100)}%). ` +
          "Applies on your next run — no re-render needed."
      );
    } catch (err) {
      setNotice(`⚠ ${err instanceof Error ? err.message : "save failed"}`);
    } finally {
      setSavingVolume(null);
    }
  };

  // Level check for ONE trainer: measure every synthesized file (real actor
  // recordings are never touched), find the ones at least `checkPct` percent
  // quieter than the trainer's average, re-render those, and measure the new
  // files so the report shows what the re-render actually did. A voice that
  // renders a soft line softly will come back soft — the report says so
  // rather than hiding it.
  const onLevelCheck = async () => {
    const pid = personaId;
    const items = allPhrasesFor(pid)
      .map((p) => ({ id: p.id, category: p.category, url: getPhraseUrl(pid, p.id) }))
      .filter((x): x is { id: string; category: PhraseCategory; url: string } =>
        !!x.url && !isPromoted(pid, x.id)
      );
    if (items.length === 0) {
      setNotice(`⚠ ${persona.shortName} has no synthesized audio to check.`);
      return;
    }
    setNotice(null);
    setCheck({
      persona: pid,
      phase: "measuring",
      done: 0,
      total: items.length,
      measured: 0,
      avgDb: NaN,
      thresholdDb: NaN,
      results: [],
    });
    let levels: Record<string, { db: number; sha: string }>;
    try {
      // Always fresh bytes for the "before" pass: a browser-cached copy from
      // before an earlier re-render would make the report lie twice.
      levels = await measureFiles(
        items,
        (done, total) => setCheck((c) => (c ? { ...c, done, total } : c)),
        { bust: true }
      );
    } catch (err) {
      setCheck(null);
      setNotice(`⚠ ${err instanceof Error ? err.message : "couldn't measure"}`);
      return;
    }
    const finite = Object.values(levels)
      .map((r) => r.db)
      .filter((d) => isFinite(d));
    const avgDb = meanDb(finite);
    const thresholdDb = quietThresholdDb(avgDb, checkPct);
    // Persist every reading: the run screen lifts the far-too-soft clips at
    // play time from exactly this map, so a check that ends without a
    // re-render still improves the next run.
    const saveReadings = async (files: Record<string, number>, merge: boolean) => {
      const clean = Object.fromEntries(
        Object.entries(files).filter(([, db]) => isFinite(db))
      );
      setClipLoudness(pid, avgDb, clean);
      try {
        await fetch("/api/library/loudness", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...adminPinHeaders() },
          body: JSON.stringify({ persona: pid, avgDb, files: clean, merge }),
        });
      } catch {
        /* the next check writes it again */
      }
    };
    await saveReadings(
      Object.fromEntries(Object.entries(levels).map(([id, r]) => [id, r.db])),
      false
    );
    const quiet = items.filter((x) => isFinite(levels[x.id]?.db) && levels[x.id].db <= thresholdDb);
    const base = {
      persona: pid,
      done: 0,
      total: quiet.length,
      measured: finite.length,
      avgDb,
      thresholdDb,
    };
    if (quiet.length === 0) {
      setCheck({ ...base, phase: "done", results: [] });
      return;
    }
    if (
      !window.confirm(
        `${quiet.length} of ${finite.length} ${persona.shortName} phrases are ${checkPct}% or more ` +
          `quieter than the average (${avgDb.toFixed(1)} dB; cut-off ${thresholdDb.toFixed(1)} dB). ` +
          "Re-render them now? This spends ElevenLabs credits. Real recordings are excluded."
      )
    ) {
      setCheck({
        ...base,
        phase: "done",
        results: quiet.map((x) => ({ id: x.id, category: x.category, before: levels[x.id].db, after: null })),
      });
      return;
    }
    const results: NonNullable<typeof check>["results"] = [];
    setCheck({ ...base, phase: "rendering", results });
    for (const x of quiet) {
      let after: number | null = null;
      let stale = false;
      try {
        await reRenderPhrase(pid, x.id);
        const url = getPhraseUrl(pid, x.id) ?? x.url;
        // The store overwrites in place and can go on serving the previous
        // bytes for a short while after the put returns. Measuring those
        // would report the OLD level as "after" — the exact same number,
        // which is what happened in the field. Poll until the digest
        // changes, and give up honestly rather than report a stale figure.
        const before = levels[x.id].sha;
        for (let attempt = 0; attempt < 15; attempt++) {
          const re = await measureFiles([{ id: x.id, url }], undefined, { bust: true });
          const r = re[x.id];
          if (r && r.sha && r.sha !== before) {
            after = isFinite(r.db) ? r.db : null;
            break;
          }
          await new Promise((res) => setTimeout(res, 3000));
        }
        if (after === null) stale = true;
      } catch {
        after = null;
      }
      results.push({ id: x.id, category: x.category, before: levels[x.id].db, after, stale });
      // The server dropped this clip's reading when it re-rendered; put the
      // new one back (or leave it absent if the bytes never showed up).
      if (after !== null) await saveReadings({ [x.id]: after }, true);
      setCheck({ ...base, phase: "rendering", done: results.length, results: [...results] });
      refresh();
    }
    setCheck({ ...base, phase: "done", done: results.length, results: [...results] });
    refresh();
  };

  // Decode a spread of each trainer's rendered files and take their speech
  // loudness, so the level sliders can be set from evidence: the suggestion
  // for every other trainer is the level that lands their average where the
  // reference's average sits at ITS current slider position — so moving the
  // reference slider moves every suggestion with it.
  const onMeasureLevels = async () => {
    setNotice(null);
    const next: Partial<Record<PersonaId, LoudnessReading>> = {};
    for (const p of PERSONA_LIST) {
      const urls = sampleUrls(renderedUrlsFor(p.id), LEVEL_SAMPLE);
      if (urls.length === 0) continue;
      setMeasuring({ persona: p.id, done: 0, total: urls.length });
      try {
        next[p.id] = await measureLoudness(urls, (done, total) =>
          setMeasuring({ persona: p.id, done, total })
        );
      } catch {
        /* this trainer stays unmeasured */
      }
      setLoud({ ...next });
    }
    setMeasuring(null);
    const n = Object.keys(next).length;
    setNotice(
      n === 0
        ? "⚠ Couldn't decode any rendered audio — is anything rendered?"
        : `✓ Measured ${n} trainer${n === 1 ? "" : "s"}, ${LEVEL_SAMPLE} files each. ` +
          `Suggestions are relative to ${PERSONAS[LEVEL_REFERENCE].shortName}'s slider.`
    );
  };

  // Re-render a single phrase, for wording that changed after it was voiced.
  const onRedoPhrase = async (id: string) => {
    if (
      isPromoted(personaId, id) &&
      !window.confirm(
        `${id} is a REAL actor recording promoted from the studio. Re-rendering replaces ` +
          "it with synthesized audio. (The take stays in the studio — you can re-promote " +
          "it later.) Continue?"
      )
    ) {
      return;
    }
    setRedoing(id);
    setNotice(null);
    try {
      await reRenderPhrase(personaId, id);
      setNotice(`✓ Re-rendered ${id}`);
    } catch (err) {
      setNotice(`⚠ ${err instanceof Error ? err.message : "render failed"}`);
    } finally {
      setRedoing(null);
      refresh();
    }
  };

  const submitPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError(false);
    const res = await fetch("/api/admin/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: pinInput }),
    });
    if (res.ok) {
      storeAdminPin(pinInput);
      setLock("unlocked");
    } else {
      setPinError(true);
      setPinInput("");
    }
  };

  const flags = libraryFlags();
  const persona = PERSONAS[personaId];
  const phrases = allPhrasesFor(personaId);
  const life = lifetimeStats();
  const lifeTotal = life.prerendered + life.live + life.synth;
  const hitRate = lifeTotal > 0 ? Math.round((life.prerendered / lifeTotal) * 100) : null;
  const busy =
    expanding !== null || progress?.state === "generating" || progress?.state === "checking";

  const onRenderMissing = async (only?: PersonaId) => {
    setNotice(null);
    await renderMissingPhrases((p) => {
      setProgress(p);
      refresh();
    }, only);
    refresh();
  };

  const recordedHere = promotedPhrases(personaId);

  const paceFigures = paceFigureStatus(personaId);
  const onRenderPaceFigures = async () => {
    setNotice(null);
    setRenderingFigures(true);
    try {
      await renderPaceFigures(personaId, (p) => {
        setProgress(p);
        refresh();
      });
    } finally {
      setRenderingFigures(false);
      refresh();
    }
  };

  const onReRender = async () => {
    const count = allPhrasesFor(personaId).length;
    const recordedWarning =
      recordedHere.length > 0
        ? `\n\n⚠ ${recordedHere.length} of them are REAL actor recordings promoted from ` +
          "the studio — this replaces them with synthesized audio. (Takes stay saved in " +
          "the studio, so you can re-promote them later.) To keep them, use " +
          "“Re-render generated only” instead."
        : "";
    if (
      !window.confirm(
        `Re-render ALL ${count} ${persona.name} phrases with the current voice? ` +
          "This overwrites existing audio and spends ElevenLabs credits." +
          recordedWarning
      )
    )
      return;
    setNotice(null);
    await reRenderPersona(personaId, (p) => {
      setProgress(p);
      refresh();
    });
    refresh();
  };

  // The persona has a real actor: refresh only the synthesized phrases
  // (voice ID changed, new phrases added, etc.) and leave every promoted
  // actor take exactly as recorded.
  const onReRenderGenerated = async () => {
    const count = allPhrasesFor(personaId).length - recordedHere.length;
    if (
      !window.confirm(
        `Re-render the ${count} generated ${persona.name} phrases with the current voice, ` +
          `keeping all ${recordedHere.length} actor recordings untouched? ` +
          "This spends ElevenLabs credits."
      )
    )
      return;
    setNotice(null);
    await reRenderPersona(
      personaId,
      (p) => {
        setProgress(p);
        refresh();
      },
      { skipPromoted: true }
    );
    refresh();
  };

  // Phrases whose wording was edited after they were voiced — the file exists,
  // so "render missing" skips them and the old audio would play forever.
  const staleHere = stalePhrases(personaId);
  const staleAll = stalePhrases();

  // Bulk re-render never touches a real actor recording: an outdated take is
  // told about and left in place. Replacing one with synthesized audio is a
  // deliberate per-phrase act (the ↻ button, which asks first).
  const onRenderStale = async (only?: PersonaId) => {
    const list = stalePhrases(only);
    const recorded = list.filter((s) => isPromoted(s.persona, s.id));
    const count = list.length - recorded.length;
    const keptNote =
      recorded.length > 0
        ? `\n\n🎙 ${recorded.length} of the outdated phrase${recorded.length === 1 ? " is a" : "s are"} ` +
          "REAL actor recording" + (recorded.length === 1 ? "" : "s") + " — " +
          (recorded.length === 1 ? "it stays" : "they stay") +
          " as recorded and will NOT be re-rendered. A recording that says the old " +
          "words needs a new take from the studio; to replace one with synthesized " +
          "audio instead, use its own ↻ button."
        : "";
    if (count === 0) {
      setNotice(
        `🎙 All ${recorded.length} outdated ${only ? persona.shortName + " " : ""}phrases are real ` +
          "actor recordings — nothing re-rendered. Re-record them in the studio, or replace one " +
          "with synthesized audio via its own ↻ button."
      );
      return;
    }
    if (
      !window.confirm(
        `Re-render ${count} outdated phrase${count === 1 ? "" : "s"}` +
          `${only ? ` for ${persona.name}` : " across all trainers"}? ` +
          "This spends ElevenLabs credits." +
          keptNote
      )
    )
      return;
    setNotice(null);
    await reRenderStale(
      (p) => {
        setProgress(p);
        refresh();
      },
      only,
      { skipPromoted: true }
    );
    if (recorded.length > 0) {
      setNotice(
        `✓ Re-rendered ${count}. ${recorded.length} recorded take${recorded.length === 1 ? "" : "s"} ` +
          "left as is — still marked outdated until re-recorded."
      );
    }
    refresh();
  };

  const onRenderList = async () => {
    const known = new Set(allPhrasesFor(personaId).map((p) => p.id));
    const ids = [...new Set(idList.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
    const unknown = ids.filter((id) => !known.has(id));
    const list = ids.filter((id) => known.has(id));
    if (list.length === 0) {
      setNotice(`⚠ No ${persona.shortName} phrase ids recognised in that list.`);
      return;
    }
    const promotedHit = list.filter((id) => isPromoted(personaId, id));
    if (
      !window.confirm(
        `Re-render ${list.length} ${persona.shortName} phrase${list.length === 1 ? "" : "s"} by id?` +
          (unknown.length > 0 ? ` (${unknown.length} unrecognised id${unknown.length === 1 ? "" : "s"} skipped.)` : "") +
          (promotedHit.length > 0
            ? ` WARNING: ${promotedHit.length} of these are REAL actor recordings and will be replaced by synthesized audio.`
            : "") +
          " This spends ElevenLabs credits."
      )
    )
      return;
    setNotice(null);
    let done = 0;
    let failed = 0;
    setProgress({ state: "generating", done, total: list.length });
    for (const id of list) {
      try {
        await reRenderPhrase(personaId, id);
        done++;
      } catch {
        failed++;
      }
      setProgress({ state: "generating", done, total: list.length });
      refresh();
    }
    setProgress({ state: "done", done, total: list.length });
    setNotice(
      `✓ Re-rendered ${done} of ${list.length}` +
        (failed > 0 ? ` — ${failed} failed` : "") +
        (unknown.length > 0 ? ` — skipped unknown: ${unknown.join(", ")}` : "")
    );
    if (failed === 0) setIdList("");
    refresh();
  };

  const onExpandCategory = async (cat: PhraseCategory) => {
    setNotice(null);
    setExpanding(cat);
    try {
      const fresh = await expandLibrary(
        personaId,
        EXPAND_BATCH,
        (p) => {
          setProgress(p);
          refresh();
        },
        cat
      );
      setNotice(
        `✓ Added ${fresh.length} new ${persona.shortName} "${CATEGORY_LABELS[cat]}" phrases`
      );
    } catch (err) {
      setNotice(`⚠ ${err instanceof Error ? err.message : "generation failed"}`);
    } finally {
      setExpanding(null);
      refresh();
    }
  };

  if (lock !== "unlocked") {
    return (
      <div className="fade-in">
        <div className="admin-topbar">
          <button className="back-link" onClick={onBack}>
            ‹ Back
          </button>
          <h1 className="admin-title">Admin</h1>
        </div>
        {lock === "checking" ? (
          <div className="admin-notice">Checking access…</div>
        ) : (
          <form className="card pin-gate" onSubmit={submitPin}>
            <div className="pin-emoji">🔒</div>
            <div className="pin-title">Enter admin PIN</div>
            <input
              className="pin-input"
              type="password"
              inputMode="numeric"
              autoFocus
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              placeholder="PIN"
            />
            {pinError && <div className="admin-notice bad">Wrong PIN — try again</div>}
            <button className="cta" type="submit" disabled={pinInput.length === 0}>
              Unlock
            </button>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div className="admin-topbar">
        <button className="back-link" onClick={onBack}>
          ‹ Back
        </button>
        <h1 className="admin-title">Admin</h1>
      </div>

      <div className="section-header">Server Config</div>
      <div className="card config-card">
        <div className={`config-row ${flags.elevenlabs ? "ok" : "bad"}`}>
          {flags.elevenlabs ? "✓" : "✕"} ElevenLabs API key
        </div>
        <div className={`config-row ${flags.blob ? "ok" : "bad"}`}>
          {flags.blob ? "✓" : "✕"} Vercel Blob store
          {!flags.blob && (
            <span className="config-hint">Storage → Create Database → Blob, then redeploy</span>
          )}
        </div>
        {!flags.statusReached && (
          <div className="config-row bad">✕ Server unreachable (running without API routes?)</div>
        )}
      </div>

      <div className="section-header">
        Users{users !== null && <span className="cat-count">{users.length}</span>}
      </div>
      {openUser && openRun ? (
        // The user's run exactly as they see it — map, splits, card, GPS
        // diagnostics — minus owner actions (conform, delete, Health).
        <RunDetailScreen
          run={openRun}
          readOnly
          apiBase={`/api/admin/users/${openUser.uid}/runs`}
          onBack={() => setOpenRun(null)}
          onDeleted={() => setOpenRun(null)}
          cardBgSrc={null}
        />
      ) : openUser ? (
        <div className="card" style={{ padding: "12px 14px" }}>
          <button className="back-link" onClick={() => { setOpenUser(null); setUserRuns(null); }}>
            ‹ All users
          </button>
          <div className="admin-user-head">
            <span className="admin-user-name">{openUser.name}</span>
            {openUser.email && <span className="admin-user-email">{openUser.email}</span>}
          </div>
          {userRuns === null ? (
            <div className="home-empty">Loading runs…</div>
          ) : userRuns.length === 0 ? (
            <div className="home-empty">No saved runs.</div>
          ) : (
            userRuns.map((run) => {
              const persona = PERSONAS[run.personaId as PersonaId];
              const pace =
                !run.treadmill && run.distanceKm > 0 ? run.movingSec / run.distanceKm : null;
              return (
                <button
                  className="admin-run-row admin-run-open"
                  key={run.id}
                  onClick={() => setOpenRun(run)}
                >
                  <div className="admin-run-line">
                    <span className="admin-run-date">
                      {new Date(run.startedAt).toLocaleDateString(undefined, {
                        day: "numeric",
                        month: "short",
                        year: "2-digit",
                      })}{" "}
                      {new Date(run.startedAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className="admin-run-persona">
                      {persona ? `${persona.emoji} ${persona.shortName}` : run.personaId}
                    </span>
                  </div>
                  <div className="admin-run-line">
                    <span className="admin-run-figures">
                      {run.treadmill
                        ? formatElapsed(run.movingSec * 1000)
                        : `${run.distanceKm.toFixed(2)} km · ${formatElapsed(run.movingSec * 1000)} · ${formatPace(pace)}/km`}
                    </span>
                    <span className="admin-run-target">{targetLabel(run)}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      ) : (
        <div className="card" style={{ padding: users?.length ? 0 : "12px 14px" }}>
          {usersNote ? (
            <div className="home-empty">{usersNote}</div>
          ) : users === null ? (
            <div className="home-empty">Loading users…</div>
          ) : users.length === 0 ? (
            <div className="home-empty">
              Nobody has signed in since the user registry went live — profiles are
              written at sign-in, so existing accounts appear on their next login.
            </div>
          ) : (
            users.map((u) => (
              <button
                className="admin-user-row"
                key={u.uid}
                onClick={() => {
                  setOpenUser(u);
                  setUserRuns(null);
                  void fetch(`/api/admin/users/${u.uid}`)
                    .then((res) => (res.ok ? res.json() : Promise.reject()))
                    .then((data: { runs: AdminRun[] }) => setUserRuns(data.runs))
                    .catch(() => setUserRuns([]));
                }}
              >
                <span className="admin-user-name">{u.name}</span>
                <span className="admin-user-email">{u.email ?? "no email"}</span>
                <span className="admin-user-meta">
                  {u.runCount} run{u.runCount === 1 ? "" : "s"} · last active{" "}
                  {new Date(u.lastSeen).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                  })}
                </span>
              </button>
            ))
          )}
        </div>
      )}

      <div className="section-header">Persona</div>
      <div className="segmented compact">
        {PERSONA_LIST.map((p) => (
          <button
            key={p.id}
            className={personaId === p.id ? "active" : ""}
            onClick={() => setPersonaId(p.id)}
          >
            {p.emoji}
            <br />
            {p.shortName}
          </button>
        ))}
      </div>

      <div className="section-header">Voice Library</div>
      <div className="card" style={{ padding: 14 }}>
        <div className="admin-lib-stats">
          {PERSONA_LIST.map((p) => {
            const done = renderedCount(p.id);
            const total = allPhrasesFor(p.id).length;
            return (
              <span key={p.id} className={done === total ? "full" : done === 0 ? "empty" : ""}>
                {p.emoji} {done}/{total}
              </span>
            );
          })}
        </div>
        {staleAll.length > 0 && (
          <div className="stale-banner">
            <div className="stale-head">
              ⚠ {staleAll.length} phrase{staleAll.length === 1 ? "" : "s"} reworded since
              {staleAll.length === 1 ? " it was" : " they were"} voiced
            </div>
            <div className="stale-sub">
              The audio still says the old words. Look for the “old” tag in the phrase list
              below.
            </div>
            {staleHere.length > 0 && (
              <button
                className="cta"
                style={{ marginTop: 10 }}
                disabled={busy}
                onClick={() => onRenderStale(personaId)}
              >
                Re-render {staleHere.length} outdated {persona.shortName} phrase
                {staleHere.length === 1 ? "" : "s"}
              </button>
            )}
            {staleAll.length > staleHere.length && (
              <button
                className="cta secondary"
                style={{ marginTop: 10 }}
                disabled={busy}
                onClick={() => onRenderStale()}
              >
                Re-render all {staleAll.length} outdated — every trainer
              </button>
            )}
          </div>
        )}
        <button
          className="cta"
          style={{ marginTop: 12 }}
          disabled={busy}
          onClick={() => onRenderMissing(personaId)}
        >
          {progress?.state === "generating"
            ? `Rendering… ${progress.done}/${progress.total}`
            : `Render missing ${persona.shortName} phrases`}
        </button>
        <button
          className="cta secondary"
          style={{ marginTop: 10 }}
          disabled={busy}
          onClick={() => onRenderMissing()}
        >
          Render missing — all personas
        </button>
        {/* The split figures live outside the library: their own count, their
            own button, and never part of "missing" — so an actor's promoted
            takes are never in the same batch as 780 numbers. */}
        <div className="card" style={{ marginTop: 12, padding: "12px 16px" }}>
          <div className="switch-text">
            Pace figures · {paceFigures.rendered}/{paceFigures.total} rendered
            <span className="switch-sub">
              The split after the pace lead-in, in {persona.shortName}&apos;s own voice: every
              second from 3:00 to 15:59 per km (&ldquo;Five minutes, twelve seconds per
              kilometre.&rdquo;). Until a figure is rendered the device voice reads it, as
              before. Not in studio scripts, the editor or the level check, and rendering
              them never touches a recorded take.
            </span>
          </div>
          <button
            className="cta secondary"
            style={{ marginTop: 10 }}
            disabled={busy || paceFigures.rendered >= paceFigures.total}
            onClick={onRenderPaceFigures}
          >
            {progress?.state === "generating" && renderingFigures
              ? `Rendering figures… ${progress.done}/${progress.total}`
              : paceFigures.rendered >= paceFigures.total
                ? `All ${paceFigures.total} figures rendered`
                : `Render ${paceFigures.total - paceFigures.rendered} missing ${persona.shortName} figures`}
          </button>
        </div>
        {recordedHere.length > 0 && (
          <button
            className="cta secondary"
            style={{ marginTop: 10 }}
            disabled={busy}
            onClick={onReRenderGenerated}
          >
            Re-render generated only (keep {recordedHere.length} recorded)
          </button>
        )}
        <button
          className="cta secondary"
          style={{ marginTop: 10 }}
          disabled={busy}
          onClick={onReRender}
        >
          Re-render ALL {persona.shortName} phrases (voice changed)
        </button>
        <details className="render-list" style={{ marginTop: 12 }}>
          <summary>Level check — find and re-render {persona.shortName}&apos;s quiet phrases…</summary>
          <div className="stale-sub" style={{ marginTop: 6 }}>
            Measures every synthesized {persona.shortName} file (real recordings are never touched),
            finds the ones at least this much quieter than the trainer&apos;s average, re-renders
            them, and reports the level before and after. A line that reads softly by nature
            may come back soft — the report will show it.
          </div>
          <div className="level-check-row">
            <label>
              Quieter than average by
              <input
                type="number"
                inputMode="numeric"
                min={5}
                max={80}
                step={5}
                value={checkPctText}
                onChange={(e) => setCheckPctText(e.target.value)}
                onBlur={() => setCheckPctText(String(checkPct))}
              />
              % <em>({quietThresholdDb(0, checkPct).toFixed(1)} dB)</em>
            </label>
            <button
              className="cta secondary"
              disabled={busy || (check !== null && check.phase !== "done")}
              onClick={() => void onLevelCheck()}
            >
              {check && check.phase === "measuring"
                ? `Measuring… ${check.done}/${check.total}`
                : check && check.phase === "rendering"
                  ? `Re-rendering… ${check.done}/${check.total}`
                  : `🔍 Check ${persona.shortName}'s levels`}
            </button>
          </div>
          {check && check.phase === "done" && check.persona === personaId && (
            <div className="level-report">
              <div className="stale-sub">
                {check.measured} files measured · average {check.avgDb.toFixed(1)} dB · cut-off{" "}
                {check.thresholdDb.toFixed(1)} dB ·{" "}
                {check.results.length === 0
                  ? "nothing under the cut-off 🎉"
                  : check.results.some((r) => r.after !== null)
                    ? `${check.results.filter((r) => r.after !== null).length} re-rendered`
                    : `${check.results.length} under the cut-off, not re-rendered`}
              </div>
              {check.results.length > 0 && (
                <table>
                  <thead>
                    <tr>
                      <th>Phrase</th>
                      <th>Before</th>
                      <th>After</th>
                      <th>Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {check.results.map((r) => {
                      const stillQuiet = r.after !== null && r.after <= check.thresholdDb;
                      return (
                        <tr key={r.id} className={stillQuiet ? "still-quiet" : ""}>
                          <td>
                            <code>{r.id}</code> <span className="gen-hint">{r.category}</span>
                          </td>
                          <td>{r.before.toFixed(1)} dB</td>
                          <td>{r.after === null ? "—" : `${r.after.toFixed(1)} dB`}</td>
                          <td>
                            {r.after === null
                              ? r.stale
                                ? "re-rendered, but the store kept serving the old bytes for 45 s — run the check again later to see the new level"
                                : "not re-rendered"
                              : `${r.after - r.before >= 0 ? "+" : ""}${(r.after - r.before).toFixed(1)} dB` +
                                (stillQuiet ? " · still quiet" : "")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {check.results.some((r) => r.after !== null && r.after <= check.thresholdDb) && (
                <div className="stale-sub" style={{ marginTop: 6 }}>
                  &quot;Still quiet&quot; means the fresh render came back under the cut-off too —
                  the voice reads that line softly by nature. Rewording it, or a different take of
                  the emotion in the text, changes that; re-rendering again usually doesn&apos;t.
                </div>
              )}
            </div>
          )}
        </details>
        <details className="render-list" style={{ marginTop: 12 }}>
          <summary>Re-render specific {persona.shortName} phrases by id…</summary>
          <div className="stale-sub" style={{ marginTop: 6 }}>
            For audio the “old” check can’t see — phrases voiced before hash tracking carry no
            provenance, so a rewording of one never shows as outdated. Paste ids separated by
            spaces, commas or new lines.
          </div>
          <textarea
            value={idList}
            onChange={(e) => setIdList(e.target.value)}
            placeholder="al-enc-4 al-pu-1 al-km-2 …"
            rows={3}
            style={{ width: "100%", marginTop: 8, font: "inherit", fontSize: 13 }}
          />
          <button
            className="cta secondary"
            style={{ marginTop: 8 }}
            disabled={busy || idList.trim().length === 0}
            onClick={() => void onRenderList()}
          >
            Re-render listed phrases
          </button>
        </details>
        {progress?.state === "generating" && (
          <div className="gen-bar" style={{ marginTop: 12 }}>
            <div
              className="gen-bar-fill"
              style={{
                width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%`,
              }}
            />
          </div>
        )}
        {progress?.state === "done" && (
          <div className="admin-notice ok">✓ Library fully rendered</div>
        )}
        {(progress?.state === "error" || progress?.state === "unavailable") && (
          <div className="admin-notice bad">⚠ {progress.message}</div>
        )}
        {notice && (
          <div className={`admin-notice ${notice.startsWith("✓") ? "ok" : "bad"}`}>{notice}</div>
        )}
      </div>

      <div className="section-header">Voice Speed</div>
      <div className="card" style={{ padding: "6px 14px" }}>
        {PERSONA_LIST.map((p) => (
          <div className="speed-row" key={p.id}>
            <span className="speed-name">
              {p.emoji} {p.shortName}
            </span>
            <input
              type="range"
              min={0.7}
              max={1.2}
              step={0.05}
              value={speeds[p.id]}
              onChange={(e) =>
                setSpeeds((s) => ({ ...s, [p.id]: Number(e.target.value) }))
              }
            />
            <span className="speed-value">{speeds[p.id].toFixed(2)}×</span>
            <button
              className="open-pill"
              disabled={savingSpeed !== null || speeds[p.id] === getVoiceSpeed(p.id)}
              onClick={() => onSaveSpeed(p.id)}
            >
              {savingSpeed === p.id ? "…" : "Save"}
            </button>
          </div>
        ))}
        <div className="gen-hint" style={{ padding: "2px 0 10px" }}>
          1.00× is the voice&apos;s natural pace; 1.20× is ElevenLabs&apos; max. Saved speed
          applies to live phrases immediately — hit Re-render to redo existing audio.
        </div>

        <div className="section-header" style={{ marginTop: 6 }}>
          Playback level
        </div>
        <div className="level-tools">
          <button
            className="open-pill"
            disabled={measuring !== null || busy}
            onClick={() => void onMeasureLevels()}
          >
            {measuring
              ? `Measuring ${PERSONAS[measuring.persona].shortName}… ${measuring.done}/${measuring.total}`
              : Object.keys(loud).length > 0
                ? "🔊 Measure again"
                : "🔊 Measure levels"}
          </button>
          <span className="gen-hint">
            Decodes {LEVEL_SAMPLE} rendered files per trainer and reads their speech loudness.
            Suggestions match everyone to {PERSONAS[LEVEL_REFERENCE].shortName} at his current
            slider — move his slider and the suggestions follow.
          </span>
        </div>
        {(() => {
          // When some voices want more than the slider allows, say so once,
          // with the reference level that would let everyone fit.
          const cappedNames = PERSONA_LIST.filter((p) => {
            if (p.id === LEVEL_REFERENCE) return false;
            const s = suggestedVolume(loud, LEVEL_REFERENCE, volumes[LEVEL_REFERENCE], p.id, 0.4, 4);
            return s !== null && s.capped && s.ideal > 4;
          }).map((p) => p.shortName);
          if (cappedNames.length === 0) return null;
          const fit = referenceLevelToFitAll(loud, LEVEL_REFERENCE, 4);
          return (
            <div className="stale-banner" style={{ marginTop: 8 }}>
              <div className="stale-head">
                ⚠ {cappedNames.join(", ")} {cappedNames.length === 1 ? "wants" : "want"} more than
                400% to match {PERSONAS[LEVEL_REFERENCE].shortName}
              </div>
              <div className="stale-sub">
                400% is the slider&apos;s cap, not the right level — at 400% they will still be
                softer than {PERSONAS[LEVEL_REFERENCE].shortName}. Either bring{" "}
                {PERSONAS[LEVEL_REFERENCE].shortName} down
                {fit !== null ? ` to ${Math.round(fit * 100)}% or below` : ""} so everyone fits,
                or leave it and accept the gap. The &quot;wants&quot; figure on each row is the
                uncapped number.
              </div>
              {fit !== null && fit < volumes[LEVEL_REFERENCE] && (
                <button
                  className="level-use"
                  style={{ marginTop: 8, marginLeft: 0 }}
                  onClick={() => setVolumes((v) => ({ ...v, [LEVEL_REFERENCE]: fit }))}
                >
                  set {PERSONAS[LEVEL_REFERENCE].shortName} to {Math.round(fit * 100)}%
                </button>
              )}
            </div>
          );
        })()}
        {PERSONA_LIST.map((p) => {
          const reading = loud[p.id];
          const suggest =
            p.id === LEVEL_REFERENCE
              ? null
              : suggestedVolume(loud, LEVEL_REFERENCE, volumes[LEVEL_REFERENCE], p.id, 0.4, 4);
          return (
          <div className="speed-row" key={p.id}>
            <span className="speed-name">
              {p.emoji} {p.shortName}
            </span>
            <input
              type="range"
              min={0.4}
              max={4}
              step={0.05}
              value={volumes[p.id]}
              onChange={(e) =>
                setVolumes((v) => ({ ...v, [p.id]: Number(e.target.value) }))
              }
            />
            <span className="speed-value">{Math.round(volumes[p.id] * 100)}%</span>
            <button
              className="open-pill"
              disabled={savingVolume !== null || volumes[p.id] === getVoiceVolume(p.id)}
              onClick={() => onSaveVolume(p.id)}
            >
              {savingVolume === p.id ? "…" : "Save"}
            </button>
            {reading && (
              <span className="level-measured" title={`${reading.files} files decoded${reading.failed ? `, ${reading.failed} failed` : ""}`}>
                {isFinite(reading.dbfs) ? `${reading.dbfs.toFixed(1)} dB` : "—"}
                {p.id === LEVEL_REFERENCE ? (
                  <em> · reference</em>
                ) : suggest !== null ? (
                  <>
                    {" · suggest "}
                    <strong>{Math.round(suggest.volume * 100)}%</strong>
                    {suggest.capped && (
                      <em className="level-capped">
                        {" "}
                        (capped — wants {Math.round(suggest.ideal * 100)}%
                        {suggest.ideal > 4 ? ", still softer than " + PERSONAS[LEVEL_REFERENCE].shortName : ""})
                      </em>
                    )}
                    {Math.abs(suggest.volume - volumes[p.id]) >= 0.05 && (
                      <button
                        className="level-use"
                        onClick={() => setVolumes((v) => ({ ...v, [p.id]: suggest.volume }))}
                      >
                        use
                      </button>
                    )}
                  </>
                ) : null}
              </span>
            )}
          </div>
          );
        })}
        <div className="gen-hint" style={{ padding: "2px 0 10px" }}>
          Every voice ships at 100%. Above 100% the native app amplifies the audio itself,
          up to 400% through a soft limiter — use it to lift a voice that renders quiet
          (Cassie). On top of that, any clip the level check found more than 50% below its
          trainer&apos;s average is lifted on its own at play time (1.5× the trainer&apos;s level,
          up to 500%). Browser playback still caps at 100%. Applies on your next run, no re-render needed. &quot;use&quot; only moves the
          slider — press Save to keep it.
        </div>
      </div>

      <div className="section-header">Lifetime Stats</div>
      <div className="stat-grid">
        <div className="stat-cell">
          <div className="stat-value">{lifeTotal}</div>
          <div className="stat-label">Lines spoken</div>
        </div>
        <div className="stat-cell">
          <div className="stat-value">{hitRate === null ? "—" : `${hitRate}%`}</div>
          <div className="stat-label">Pre-rendered hit rate</div>
        </div>
        <div className="stat-cell">
          <div className="stat-value">{life.live}</div>
          <div className="stat-label">Improvised (AI)</div>
        </div>
        <div className="stat-cell">
          <div className="stat-value">{life.synth}</div>
          <div className="stat-label">Robo-voice fallback</div>
        </div>
      </div>

      <div className="section-header">
        {persona.emoji} {persona.name} — {phrases.length} phrases
      </div>

      {!ready && <div className="admin-notice">Loading library…</div>}

      {CATEGORY_ORDER.map((cat) => {
        const pool = phrases.filter((p) => p.category === cat);
        if (pool.length === 0) return null;
        return (
          <div key={cat}>
            <div className="section-header cat-header">
              <span>
                {CATEGORY_LABELS[cat]} · {pool.length}
              </span>
              {EXPANDABLE_CATEGORIES.includes(cat) ? (
                <button
                  className="cat-add"
                  disabled={busy}
                  onClick={() => onExpandCategory(cat)}
                >
                  {expanding === cat ? "writing…" : `+ ${EXPAND_BATCH} new`}
                </button>
              ) : (
                <span className="cat-fixed" title={FIXED_CATEGORY_REASON[cat]}>
                  fixed set
                </span>
              )}
            </div>
            <div className="card">
              {pool.map((phrase) => {
                const rendered = !!getPhraseUrl(personaId, phrase.id);
                const recordedAt = getPhraseRenderedAt(personaId, phrase.id);
                const isAI = phrase.id.startsWith("xg-");
                const stale = isPhraseStale(personaId, phrase.id);
                return (
                  <div className={`phrase-row${stale ? " stale" : ""}`} key={phrase.id}>
                    <button
                      className="phrase-play"
                      aria-label="Play phrase"
                      onClick={() => playPhrase(persona, phrase)}
                    >
                      ▶
                    </button>
                    <span className="phrase-text">{phrase.text}</span>
                    <span className={`phrase-badge ${rendered ? "ok" : ""}`}>
                      {rendered ? (isPromoted(personaId, phrase.id) ? "🎙 REC" : "MP3") : "TTS"}
                    </span>
                    {recordedAt && (
                      <span className="phrase-date" title={recordedAt.toLocaleString()}>
                        {recordedAt.toLocaleDateString(undefined, {
                          day: "numeric",
                          month: "short",
                          year: "2-digit",
                        })}
                      </span>
                    )}
                    {isAI && <span className="phrase-badge ai">AI</span>}
                    {stale && (
                      <span
                        className="phrase-badge stale"
                        title="The wording changed after this was voiced — the MP3 still says the old line"
                      >
                        old
                      </span>
                    )}
                    <button
                      className={`phrase-redo${stale ? " urgent" : ""}`}
                      aria-label="Re-render this phrase"
                      title="Re-render just this phrase"
                      disabled={busy || redoing !== null}
                      onClick={() => onRedoPhrase(phrase.id)}
                    >
                      {redoing === phrase.id ? "…" : "↻"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div style={{ height: 32 }} />
    </div>
  );
}
