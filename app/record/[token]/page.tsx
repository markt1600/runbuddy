"use client";

import { use, useEffect, useRef, useState } from "react";
import { WavRecorder, toWav, encodeMp3, bytesToBase64 } from "@/lib/studioAudio";

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
  items: { id: string; kind: "phrase" | "read"; text: string; title?: string }[];
  recorded: string[];
  takeUrls: Record<string, string>;
  openFlags: { itemId: string; note: string | null }[];
  pvcState: string;
  pvcAttempts: number;
}

const MAX_SECONDS = 120;
const SILENCE_PEAK = 0.02;
const CLIP_PEAK = 0.99;

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
  const takeRef = useRef<{ wav: Blob; peak: number; seconds: number } | null>(null);
  const recStartRef = useRef(0);
  const [elapsed, setElapsed] = useState(0);

  // captcha stage
  const [capState, setCapState] = useState<"idle" | "recording" | "review" | "done">("idle");
  const [capNote, setCapNote] = useState<string | null>(null);
  const capTakeRef = useRef<{ samples: Float32Array; rate: number } | null>(null);
  const [capPreview, setCapPreview] = useState<string | null>(null);

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
            well, you&apos;ll receive payment to your PayNow ID.
          </div>
          <button className="booth-primary" disabled={!canSign} onClick={() => void sign()}>
            Agree &amp; start recording
          </button>
          {licNote && <div className="booth-warn">{licNote}</div>}
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
        await rec.start(setLevel);
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
  const done = new Set(view.recorded);
  const flags = new Map(view.openFlags.map((f) => [f.itemId, f.note]));
  const doneCount = view.items.filter((it) => done.has(it.id) && !flags.has(it.id)).length;

  const startTake = async () => {
    setWarn(null);
    try {
      const rec = new WavRecorder();
      await rec.start(setLevel);
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
    takeRef.current = { wav, peak: cap.peak, seconds: cap.seconds };
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(wav));
    if (cap.peak < SILENCE_PEAK) {
      setWarn("⚠ No audio detected — check your microphone and re-record.");
    } else if (cap.peak > CLIP_PEAK) {
      setWarn("⚠ The recording clipped (too loud) — move back from the mic and re-record.");
    } else if (cap.seconds < 0.8) {
      setWarn("⚠ That was very short — make sure you read the whole line.");
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
      // local bookkeeping instead of a full reload — keeps the flow fast
      setView((v) =>
        v
          ? {
              ...v,
              recorded: [...new Set([...v.recorded, item.id])],
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
      {view.openFlags.length > 0 && (
        <div className="booth-flags">
          🔁 {view.openFlags.length} item{view.openFlags.length === 1 ? "" : "s"} sent back for
          another take — they&apos;re marked below.
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
        Quiet room · same mic throughout · stay in character, big energy · no effects or
        noise reduction · sips of water between takes. Your progress saves as you go — you
        can close this page and come back with the same link.
      </div>
    </div>
  );
}
