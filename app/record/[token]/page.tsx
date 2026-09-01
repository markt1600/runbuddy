"use client";

import { use, useEffect, useRef, useState } from "react";
import { WavRecorder, toWav, encodeMp3, dbfs } from "@/lib/studioAudio";
import { STUDIO_BRIEFS, EMBELLISH_NOTE } from "@/lib/studioReads";
import type { PersonaId } from "@/lib/types";

// The actor's recording booth. The token in the URL is the whole identity:
// license first (name, email, PayNow, the agreement), then the phrase bank
// and long reads, one big red button at a time, resumable across visits.
// When the admin opens verification, a final stage records the ElevenLabs
// voice captcha without the actor ever needing an ElevenLabs account.

interface SessionView {
  persona: string;
  personaName: string;
  label: string;
  licensed: boolean;
  licenseText: string;
  licenseVersion: string;
  feeSgd: number;
  deadlineAt: number;
  estimateHours: { low: number; high: number };
  items: { id: string; kind: "phrase" | "read"; text: string; title?: string }[];
  recorded: string[];
  takeUrls: Record<string, string>;
  openFlags: { itemId: string; note: string | null }[];
  pvcState: string;
  pvcAttempts: number;
  submittedAt: number;
}

const MAX_SECONDS = 120;
const SILENCE_PEAK = 0.02;
const CLIP_PEAK = 0.99;

// Calibration targets, from ElevenLabs' PVC guidance: speech around
// −23…−18 dB RMS with true peaks below −3 dB, over a quiet noise floor.
const CAL_TEXT =
  "This is my microphone check for the Run Buddy voice session. I am speaking at the same " +
  "volume and energy I will use for every recording today. One, two, three, four, five. " +
  "The quick brown fox jumps over the lazy dog, and the race starts at six in the morning " +
  "by the sea. If my levels look good, I will keep everything exactly like this.";
const CAL_KEY = (token: string) => `runbuddy-cal-${token}`;
const BRIEF_KEY = (token: string) => `runbuddy-brief-${token}`;

const fmtDeadline = (at: number) =>
  new Date(at).toLocaleDateString("en-SG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
const daysLeft = (at: number) => Math.ceil((at - Date.now()) / 86_400_000);

/** Shown on every visit — the contract's hard completion date. */
function DeadlineBanner({ at }: { at: number }) {
  if (!at) return null;
  const d = daysLeft(at);
  return (
    <div className={`booth-deadline${d < 3 ? " urgent" : ""}`}>
      ⏰ Deadline: <strong>{fmtDeadline(at)}</strong>
      {d >= 0
        ? ` — ${d === 0 ? "today" : `${d} day${d === 1 ? "" : "s"} left`}. All recordings must be 100% completed and submitted by then.`
        : " — PASSED. Contact us immediately."}
    </div>
  );
}

export default function RecordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [view, setView] = useState<SessionView | null>(null);
  const [failed, setFailed] = useState(false);

  // license form
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [paynow, setPaynow] = useState("");
  const [paynow2, setPaynow2] = useState("");
  const [agree, setAgree] = useState(false);
  const [licNote, setLicNote] = useState<string | null>(null);

  // recording state
  const [idx, setIdx] = useState(0);
  const [recState, setRecState] = useState<"idle" | "recording" | "review">("idle");
  const [level, setLevel] = useState(0);
  const [warn, setWarn] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const recRef = useRef<WavRecorder | null>(null);
  const takeRef = useRef<{
    wav: Blob;
    samples: Float32Array;
    rate: number;
    peak: number;
    seconds: number;
  } | null>(null);
  const recStartRef = useRef(0);
  const [elapsed, setElapsed] = useState(0);

  // microphone choice: laptops often carry several inputs and the browser's
  // default is a lottery. Enumerated once permission exists; the selection
  // feeds every recording on the page.
  const [mics, setMics] = useState<{ id: string; label: string }[]>([]);
  const [micId, setMicId] = useState<string>("");

  // character brief: read once per visit, right after the mic check — the
  // clone reproduces the average of every take, so the actor must be in
  // character from the very first line.
  const [briefDone, setBriefDone] = useState(false);

  // calibration: once per visit (a new visit can mean a new mic, room or
  // laptop, so it re-runs whenever the browser session is fresh)
  const [calDone, setCalDone] = useState(false);
  const [calStep, setCalStep] = useState<"room" | "level">("room");
  const [calBusy, setCalBusy] = useState(false);
  const [calVerdict, setCalVerdict] = useState<string | null>(null);
  const [calPass, setCalPass] = useState(false);
  const [calPreview, setCalPreview] = useState<string | null>(null);

  // finish & submit: a final listen-through of every take, then the hand-in
  const [reviewStage, setReviewStage] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitNote, setSubmitNote] = useState<string | null>(null);
  const [boothReopened, setBoothReopened] = useState(false);

  // captcha stage
  const [capState, setCapState] = useState<"idle" | "recording" | "review" | "done">("idle");
  const [capNote, setCapNote] = useState<string | null>(null);
  const capTakeRef = useRef<{ samples: Float32Array; rate: number } | null>(null);
  const [capPreview, setCapPreview] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(CAL_KEY(token)) === "1") setCalDone(true);
      if (sessionStorage.getItem(BRIEF_KEY(token)) === "1") setBriefDone(true);
    } catch {
      /* private mode — calibrate every visit, no harm */
    }
  }, [token]);

  // Ask for mic permission up front so device labels are readable, then list
  // the inputs. Re-runs on plug/unplug via devicechange.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        const inputs = devices
          .filter((d) => d.kind === "audioinput" && d.deviceId)
          .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
        setMics(inputs);
        setMicId((cur) => (cur && inputs.some((m) => m.id === cur) ? cur : inputs[0]?.id ?? ""));
      } catch {
        /* no device API — recording will use the default */
      }
    };
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        /* denied — labels stay generic, recording will re-ask */
      }
      await refresh();
    })();
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
    };
  }, []);

  const load = () => {
    void fetch(`/api/record/${token}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: SessionView) => {
        setView(data);
        // Land the actor on the first thing that needs doing: an open flag
        // first, else the first unrecorded item.
        const flagged = new Set(data.openFlags.map((f) => f.itemId));
        const done = new Set(data.recorded);
        const target = data.items.findIndex(
          (it) => flagged.has(it.id) || !done.has(it.id)
        );
        if (target >= 0) setIdx(target);
      })
      .catch(() => setFailed(true));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [token]);

  useEffect(() => {
    if (recState !== "recording") return;
    const t = setInterval(() => {
      const s = (Date.now() - recStartRef.current) / 1000;
      setElapsed(s);
      if (s >= MAX_SECONDS) void stopTake();
    }, 200);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recState]);

  if (failed) {
    return (
      <div className="booth">
        <h1>Link not found</h1>
        <p>This recording link isn&apos;t valid. Please check with whoever sent it to you.</p>
      </div>
    );
  }
  if (!view) return <div className="booth"><p>Loading…</p></div>;

  // ---- stage 1: license ----
  if (!view.licensed) {
    const canSign =
      name.trim().length >= 3 &&
      /@.+\./.test(email) &&
      paynow.trim().length >= 4 &&
      paynow.trim() === paynow2.trim() &&
      agree;
    const sign = async () => {
      setLicNote(null);
      try {
        const res = await fetch(`/api/record/${token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            typedName: name.trim(),
            email: email.trim(),
            paynowId: paynow.trim(),
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "failed");
        load();
      } catch (err) {
        setLicNote(`⚠ ${err instanceof Error ? err.message : "Couldn't sign — try again"}`);
      }
    };
    return (
      <div className="booth">
        <h1>Run Buddy Voice Session</h1>
        <p className="booth-sub">
          Recording as <strong>{view.personaName}</strong> · {view.label}
        </p>
        <div className="booth-note">
          📋 This session covers {view.items.length} recordings and typically takes{" "}
          <strong>
            about {view.estimateHours.low}–{view.estimateHours.high} hours
          </strong>{" "}
          of focused work. You can split it across multiple sittings — your progress saves
          automatically.
        </div>
        <DeadlineBanner at={view.deadlineAt} />
        <div className="booth-license">{view.licenseText}</div>
        <div className="booth-form">
          <label>
            Full legal name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="As on your ID" />
          </label>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </label>
          <label>
            PayNow ID (mobile or NRIC/FIN)
            <input value={paynow} onChange={(e) => setPaynow(e.target.value)} placeholder="+65…" />
          </label>
          <label>
            Confirm PayNow ID
            <input value={paynow2} onChange={(e) => setPaynow2(e.target.value)} placeholder="Type it again" />
            {paynow2 && paynow.trim() !== paynow2.trim() && (
              <span className="booth-warn">PayNow IDs don&apos;t match</span>
            )}
          </label>
          <label className="booth-agree">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>I have read and agree to the licence above ({view.licenseVersion})</span>
          </label>
          <div className="booth-note">
            Once you finish recording, your work will be reviewed within 2 business days. If
            anything needs another take, we&apos;ll contact you at the email above; if all is
            well, you&apos;ll receive payment of{" "}
            <strong>SGD ${view.feeSgd.toFixed(2)}</strong> to your PayNow ID.
          </div>
          <button className="booth-primary" disabled={!canSign} onClick={() => void sign()}>
            Agree &amp; start recording
          </button>
          {licNote && <div className="booth-warn">{licNote}</div>}
        </div>
      </div>
    );
  }

  // ---- already submitted: land HERE, before any mic check ----
  // A returning actor whose work is in review shouldn't re-calibrate just to
  // see "you're done". Only choosing to re-record routes back through the
  // mic check and character brief. New flags from review make allComplete
  // false, which drops them into that same route automatically.
  const done = new Set(view.recorded);
  const flags = new Map(view.openFlags.map((f) => [f.itemId, f.note]));
  const doneCount = view.items.filter((it) => done.has(it.id) && !flags.has(it.id)).length;
  const allComplete = doneCount === view.items.length;

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitNote(null);
    try {
      const res = await fetch(`/api/record/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed");
      setView((v) => (v ? { ...v, submittedAt: data.submittedAt as number } : v));
      setReviewStage(false);
      setBoothReopened(false);
    } catch (err) {
      setSubmitNote(`⚠ ${err instanceof Error ? err.message : "Couldn't submit — try again"}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (allComplete && view.submittedAt > 0 && !boothReopened) {
    return (
      <div className="booth">
        <h1>Submitted 🎉</h1>
        <p className="booth-sub">
          All {view.items.length} recordings are in — submitted on{" "}
          <strong>{fmtDeadline(view.submittedAt)}</strong> and now in review.
        </p>
        <div className="booth-note">
          Your work will be reviewed within <strong>2 business days</strong>. If any takes need
          re-recording, we&apos;ll email you and they&apos;ll appear here marked 🔁 when you
          reopen this link. If everything checks out, you&apos;ll receive your payment of{" "}
          <strong>SGD ${view.feeSgd.toFixed(2)}</strong> to your PayNow ID. Thank you!
        </div>
        <div className="booth-tips">
          Not happy with a take?{" "}
          <button
            className="booth-mic-change"
            onClick={() => {
              setBoothReopened(true);
              setReviewStage(true);
            }}
          >
            Re-record &amp; re-submit
          </button>{" "}
          — you&apos;ll go through the mic check again first, and submitting again restarts
          the 2-business-day review clock on your newest takes.
        </div>
      </div>
    );
  }

  // ---- calibration: room noise, then speaking level, once per visit ----
  if (!calDone) {
    const runRoomCheck = async () => {
      setCalBusy(true);
      setCalVerdict(null);
      try {
        const rec = new WavRecorder();
        await rec.start(setLevel, micId || undefined);
        await new Promise((r) => setTimeout(r, 3000));
        const cap = await rec.stop();
        const noiseDb = dbfs(cap.rms);
        if (noiseDb > -45) {
          setCalVerdict(
            `⚠ Room noise is high (${noiseDb.toFixed(0)} dB). Turn off fans and aircon, close windows, and try again — a noisy floor bakes into every take.`
          );
        } else {
          setCalVerdict(`✓ Nice and quiet (${noiseDb.toFixed(0)} dB noise floor).`);
          setTimeout(() => {
            setCalVerdict(null);
            setCalStep("level");
          }, 1200);
        }
      } catch {
        setCalVerdict("⚠ Couldn't reach the microphone — check browser permissions.");
      } finally {
        setCalBusy(false);
      }
    };
    const startLevelCheck = async () => {
      setCalVerdict(null);
      setCalPass(false);
      try {
        const rec = new WavRecorder();
        await rec.start(setLevel, micId || undefined);
        recRef.current = rec;
        setCalBusy(true);
      } catch {
        setCalVerdict("⚠ Couldn't reach the microphone.");
      }
    };
    const stopLevelCheck = async () => {
      const rec = recRef.current;
      if (!rec) return;
      recRef.current = null;
      const cap = await rec.stop();
      setCalBusy(false);
      if (calPreview) URL.revokeObjectURL(calPreview);
      setCalPreview(URL.createObjectURL(toWav(cap.samples, cap.sampleRate)));
      const rmsDb = dbfs(cap.rms);
      const peakDb = dbfs(cap.peak);
      if (cap.peak < SILENCE_PEAK) {
        setCalVerdict("⚠ No audio detected — check that the right microphone is selected.");
      } else if (peakDb > -1.5) {
        setCalVerdict(
          `⚠ Clipping (peak ${peakDb.toFixed(1)} dB). Move a hand-width further from the mic, or lower the input gain, and run the check again.`
        );
      } else if (rmsDb < -30) {
        setCalVerdict(
          `⚠ Too quiet (average ${rmsDb.toFixed(0)} dB — target −23 to −18). Move closer to the mic or raise the input gain, and run the check again.`
        );
      } else if (rmsDb > -12) {
        setCalVerdict(
          `⚠ Very hot (average ${rmsDb.toFixed(0)} dB — target −23 to −18). Back off slightly or lower the gain, and run the check again.`
        );
      } else {
        setCalVerdict(
          `✓ Levels look great (average ${rmsDb.toFixed(0)} dB, peak ${peakDb.toFixed(1)} dB). Listen back — if it sounds clean, lock everything in and don't touch mic or gain again today.`
        );
        setCalPass(true);
      }
    };
    const acceptCal = () => {
      try {
        sessionStorage.setItem(CAL_KEY(token), "1");
      } catch {
        /* fine */
      }
      setCalDone(true);
    };
    return (
      <div className="booth">
        <h1>Mic check</h1>
        {mics.length > 0 && (
          <label className="booth-mic">
            Microphone
            <select
              value={micId}
              onChange={(e) => {
                setMicId(e.target.value);
                // A different mic invalidates everything measured so far.
                setCalStep("room");
                setCalVerdict(null);
                setCalPass(false);
                setCalPreview(null);
              }}
            >
              {mics.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </label>
        )}
        {calStep === "room" ? (
          <>
            <p className="booth-sub">
              Step 1 of 2 — room noise. Sit exactly where you&apos;ll record, then press the
              button and stay <strong>completely silent for three seconds</strong>.
            </p>
            <div className="booth-meter"><div style={{ width: `${Math.min(100, level * 130)}%` }} /></div>
            <button className="booth-record" disabled={calBusy} onClick={() => void runRoomCheck()}>
              {calBusy ? "Listening…" : "🤫 Check room noise"}
            </button>
          </>
        ) : (
          <>
            <p className="booth-sub">
              Step 2 of 2 — speaking level. Read this paragraph at the{" "}
              <strong>same volume and energy you&apos;ll use for every take</strong>:
            </p>
            <div className="booth-phrase long">{CAL_TEXT}</div>
            <div className="booth-meter"><div style={{ width: `${Math.min(100, level * 130)}%` }} /></div>
            {calBusy ? (
              <button className="booth-record recording" onClick={() => void stopLevelCheck()}>⏹ Stop</button>
            ) : (
              <button className="booth-record" onClick={() => void startLevelCheck()}>● Record the check</button>
            )}
            {calPreview && !calBusy && (
              <div className="booth-review">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <audio controls src={calPreview} />
                {calPass && (
                  <button className="booth-primary" onClick={acceptCal}>
                    ✓ Sounds clean — start recording
                  </button>
                )}
              </div>
            )}
          </>
        )}
        {calVerdict && <div className={calVerdict.startsWith("✓") ? "booth-note" : "booth-warn"}>{calVerdict}</div>}
        <div className="booth-tips">
          Once your levels pass, keep everything fixed for the whole session: same seat, same
          distance to the mic, same gain. If you come back another day, this check runs again.
        </div>
      </div>
    );
  }

  // ---- character brief: who you are, before the first take ----
  if (!briefDone) {
    const acceptBrief = () => {
      try {
        sessionStorage.setItem(BRIEF_KEY(token), "1");
      } catch {
        /* fine */
      }
      setBriefDone(true);
    };
    return (
      <div className="booth">
        <h1>Know your character</h1>
        <p className="booth-sub">
          Levels are set. Last thing before the first take: you&apos;re recording as{" "}
          <strong>{view.personaName}</strong> — take a minute with this, then stay in this
          character for every single line.
        </p>
        <div className="booth-brief">
          {STUDIO_BRIEFS[view.persona as PersonaId] ??
            "Big energy, full commitment, same character on every take."}
        </div>
        <div className="booth-note">🎨 {EMBELLISH_NOTE}</div>
        <button className="booth-primary" onClick={acceptBrief}>
          Got it — I&apos;m in character
        </button>
        <div className="booth-tips">
          This brief shows once per visit. If you come back tomorrow, read it again before
          recording — the voice clone averages every take, so a half-hearted day drags the
          whole voice down.
        </div>
      </div>
    );
  }

  // ---- captcha stage (opened by the admin when the clone is ready) ----
  if (view.pvcState === "verify" && capState !== "done") {
    const startCap = async () => {
      setCapNote(null);
      try {
        const rec = new WavRecorder();
        await rec.start(setLevel, micId || undefined);
        recRef.current = rec;
        setCapState("recording");
      } catch {
        setCapNote("⚠ Couldn't reach the microphone.");
      }
    };
    const stopCap = async () => {
      const rec = recRef.current;
      if (!rec) return;
      const cap = await rec.stop();
      capTakeRef.current = { samples: cap.samples, rate: cap.sampleRate };
      setCapPreview(URL.createObjectURL(toWav(cap.samples, cap.sampleRate)));
      setCapState("review");
    };
    const submitCap = async () => {
      const take = capTakeRef.current;
      if (!take) return;
      setCapNote("Submitting…");
      try {
        const mp3 = encodeMp3(take.samples, take.rate, 192);
        const res = await fetch(`/api/record/${token}/captcha`, {
          method: "POST",
          headers: { "Content-Type": "audio/mpeg" },
          body: new Blob([mp3.buffer as ArrayBuffer], { type: "audio/mpeg" }),
        });
        const data = await res.json();
        if (data.verified) {
          setCapState("done");
        } else {
          setCapNote(`⚠ Not verified (attempt ${data.attempts}): ${data.error ?? ""} — try again, matching the tone of your recordings.`);
          setCapState("idle");
        }
      } catch {
        setCapNote("⚠ Submission failed — try again.");
      }
    };
    return (
      <div className="booth">
        <h1>Verify your voice</h1>
        <p className="booth-sub">
          One last step: read the lines below out loud, in the same voice and energy as your
          recordings, on the same microphone. You have limited attempts, so listen back before
          submitting.
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="booth-captcha" src={`/api/record/${token}/captcha`} alt="Text to read aloud" />
        <div className="booth-meter"><div style={{ width: `${Math.min(100, level * 130)}%` }} /></div>
        {capState === "recording" ? (
          <button className="booth-record recording" onClick={() => void stopCap()}>⏹ Stop</button>
        ) : (
          <button className="booth-record" onClick={() => void startCap()}>● Record</button>
        )}
        {capState === "review" && capPreview && (
          <div className="booth-review">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio controls src={capPreview} />
            <button className="booth-primary" onClick={() => void submitCap()}>Submit this take</button>
          </div>
        )}
        {capNote && <div className="booth-warn">{capNote}</div>}
      </div>
    );
  }
  if (capState === "done") {
    return (
      <div className="booth">
        <h1>All done 🎉</h1>
        <p>Voice verified. Thank you — that&apos;s everything we need.</p>
      </div>
    );
  }

  // ---- stage 2: the booth ----
  const item = view.items[idx];

  // ---- final listen-through before the hand-in ----
  if (reviewStage && allComplete) {
    return (
      <div className="booth">
        <h1>Review your takes</h1>
        <p className="booth-sub">
          One last pass: every recording is listed below. Listen to anything you want to
          double-check, re-record what bothers you, then submit at the bottom.
        </p>
        <div className="booth-takes">
          {view.items.map((it, i) => (
            <div key={it.id} className="booth-take-row">
              <div className="booth-take-info">
                <span className="booth-take-num">{i + 1}</span>
                <span className="booth-take-text">
                  {it.kind === "read" ? `📖 ${it.title}` : it.text}
                </span>
              </div>
              {view.takeUrls[it.id] && (
                /* eslint-disable-next-line jsx-a11y/media-has-caption */
                <audio controls preload="none" src={view.takeUrls[it.id]} />
              )}
              <button
                className="booth-mic-change"
                onClick={() => {
                  setIdx(i);
                  setReviewStage(false);
                  setRecState("idle");
                  setWarn(null);
                }}
              >
                ● Re-record this one
              </button>
            </div>
          ))}
        </div>
        <div className="booth-note booth-submit">
          {view.submittedAt > 0
            ? "Submitting again replaces your previous submission — we always review your newest takes."
            : "Submitting hands everything in and starts the 2-business-day review."}
          <button className="booth-primary" disabled={submitting} onClick={() => void submit()}>
            {submitting
              ? "Submitting…"
              : view.submittedAt > 0
                ? "✓ Re-submit for review"
                : "✓ Submit all recordings for review"}
          </button>
          {submitNote && <div className="booth-warn">{submitNote}</div>}
        </div>
        <div className="booth-tips">
          <button className="booth-mic-change" onClick={() => setReviewStage(false)}>
            ‹ Back to the booth
          </button>
        </div>
      </div>
    );
  }

  const startTake = async () => {
    setWarn(null);
    try {
      const rec = new WavRecorder();
      await rec.start(setLevel, micId || undefined);
      recRef.current = rec;
      recStartRef.current = Date.now();
      setElapsed(0);
      setRecState("recording");
    } catch {
      setWarn("⚠ Couldn't reach the microphone — check browser permissions.");
    }
  };

  const stopTake = async () => {
    const rec = recRef.current;
    if (!rec) return;
    recRef.current = null;
    const cap = await rec.stop();
    const wav = toWav(cap.samples, cap.sampleRate);
    takeRef.current = {
      wav,
      samples: cap.samples,
      rate: cap.sampleRate,
      peak: cap.peak,
      seconds: cap.seconds,
    };
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(wav));
    if (cap.peak < SILENCE_PEAK) {
      setWarn("⚠ No audio detected — check your microphone and re-record.");
    } else if (cap.peak > CLIP_PEAK) {
      setWarn("⚠ The recording clipped (too loud) — move back from the mic and re-record.");
    } else if (cap.seconds < 0.8) {
      setWarn("⚠ That was very short — make sure you read the whole line.");
    } else if (dbfs(cap.rms) < -32) {
      setWarn("⚠ Quieter than your mic check — same distance and energy as calibration, please.");
    }
    setRecState("review");
  };

  const acceptTake = async () => {
    const take = takeRef.current;
    if (!take || uploading) return;
    setUploading(true);
    try {
      const res = await fetch(`/api/record/${token}/take/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "audio/wav" },
        body: take.wav,
      });
      if (!res.ok) throw new Error();
      if (item.kind === "read") {
        // Long reads feed the voice clone, which wants a small file: encode a
        // 192k MP3 twin here on the actor's machine. Best-effort — if it
        // fails, the clone builder falls back to the WAV.
        try {
          const mp3 = encodeMp3(take.samples, take.rate, 192);
          await fetch(`/api/record/${token}/take/${item.id}`, {
            method: "PUT",
            headers: { "Content-Type": "audio/mpeg" },
            body: new Blob([mp3.buffer as ArrayBuffer], { type: "audio/mpeg" }),
          });
        } catch {
          /* WAV fallback covers it */
        }
      }
      // local bookkeeping instead of a full reload — keeps the flow fast. The
      // object URL keeps the review listing playing THIS take, not a stale fetch.
      const localUrl = URL.createObjectURL(take.wav);
      setView((v) =>
        v
          ? {
              ...v,
              recorded: [...new Set([...v.recorded, item.id])],
              takeUrls: { ...v.takeUrls, [item.id]: localUrl },
              openFlags: v.openFlags.filter((f) => f.itemId !== item.id),
            }
          : v
      );
      setRecState("idle");
      setWarn(null);
      if (idx < view.items.length - 1) setIdx(idx + 1);
    } catch {
      setWarn("⚠ Upload failed — check your connection and try Use take again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="booth">
      <div className="booth-top">
        <span>
          {view.personaName} · {doneCount}/{view.items.length} recorded
        </span>
        <progress value={doneCount} max={view.items.length} />
      </div>
      <DeadlineBanner at={view.deadlineAt} />
      {view.openFlags.length > 0 && (
        <div className="booth-flags">
          🔁 {view.openFlags.length} item{view.openFlags.length === 1 ? "" : "s"} sent back for
          another take — they&apos;re marked below.
        </div>
      )}
      {allComplete && (
        <div className="booth-note booth-submit">
          🎉 That&apos;s every item recorded. Next step: a final listen-through, then the
          hand-in{view.submittedAt > 0 ? " (you re-opened after submitting — submit again so we review your newest takes)" : ""}.
          <button className="booth-primary" onClick={() => setReviewStage(true)}>
            ✓ Review all takes &amp; submit
          </button>
        </div>
      )}

      <div className="booth-nav">
        <button disabled={idx === 0} onClick={() => { setIdx(idx - 1); setRecState("idle"); setWarn(null); }}>
          ‹ Prev
        </button>
        <span className="booth-count">
          {idx + 1} / {view.items.length}
          {done.has(item.id) && !flags.has(item.id) ? " ✓" : ""}
          {flags.has(item.id) ? " 🔁" : ""}
        </span>
        <button
          disabled={idx >= view.items.length - 1}
          onClick={() => { setIdx(idx + 1); setRecState("idle"); setWarn(null); }}
        >
          Next ›
        </button>
      </div>

      {item.kind === "read" && <div className="booth-read-title">📖 Long read: {item.title}</div>}
      {flags.has(item.id) && (
        <div className="booth-flag-note">
          🔁 Please record this one again{flags.get(item.id) ? ` — ${flags.get(item.id)}` : ""}.
        </div>
      )}
      <div className={`booth-phrase${item.kind === "read" ? " long" : ""}`}>{item.text}</div>

      <div className="booth-meter"><div style={{ width: `${Math.min(100, level * 130)}%` }} /></div>

      {recState === "recording" ? (
        <button className="booth-record recording" onClick={() => void stopTake()}>
          ⏹ Stop · {elapsed.toFixed(0)}s
        </button>
      ) : (
        <button className="booth-record" onClick={() => void startTake()}>
          ● {recState === "review" || done.has(item.id) ? "Re-record" : "Record"}
        </button>
      )}

      {recState === "review" && previewUrl && (
        <div className="booth-review">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls src={previewUrl} />
          <button className="booth-primary" disabled={uploading} onClick={() => void acceptTake()}>
            {uploading ? "Uploading…" : "✓ Use this take & next"}
          </button>
        </div>
      )}
      {recState === "idle" && done.has(item.id) && view.takeUrls[item.id] && (
        <div className="booth-review">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls src={view.takeUrls[item.id]} />
        </div>
      )}
      {warn && <div className="booth-warn">{warn}</div>}

      <div className="booth-tips">
        🎙 {mics.find((m) => m.id === micId)?.label ?? "Default microphone"}{" "}
        <button
          className="booth-mic-change"
          onClick={() => {
            // Changing mics means re-calibrating — send them back through it.
            try {
              sessionStorage.removeItem(CAL_KEY(token));
            } catch {
              /* fine */
            }
            setCalDone(false);
            setCalStep("room");
            setCalVerdict(null);
            setCalPass(false);
          }}
        >
          change mic / re-check levels
        </button>
        <br />
        Quiet room · same mic throughout · stay in character, big energy · no effects or
        noise reduction · sips of water between takes. Your progress saves as you go — you
        can close this page and come back with the same link.
      </div>
    </div>
  );
}
