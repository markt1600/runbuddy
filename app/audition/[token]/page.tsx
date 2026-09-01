"use client";

import { use, useEffect, useRef, useState } from "react";
import { WavRecorder, toWav, encodeMp3, bytesToBase64, dbfs } from "@/lib/studioAudio";

// The public audition page: one screen, one line. Read the character brief,
// leave your name and email, record the line IN CHARACTER, submit. No
// licence, no calibration ceremony — this is a casting call, not a session.

interface AuditionView {
  persona: string;
  personaName: string;
  brief: string;
  line: string;
}

const MAX_SECONDS = 45;
const SILENCE_PEAK = 0.02;

export default function AuditionPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [view, setView] = useState<AuditionView | null>(null);
  const [failed, setFailed] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [recState, setRecState] = useState<"idle" | "recording" | "review">("idle");
  const [level, setLevel] = useState(0);
  const [warn, setWarn] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const recRef = useRef<WavRecorder | null>(null);
  const takeRef = useRef<{ samples: Float32Array; rate: number } | null>(null);
  const recStartRef = useRef(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    void fetch(`/api/audition/${token}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: AuditionView) => setView(data))
      .catch(() => setFailed(true));
  }, [token]);

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
    takeRef.current = { samples: cap.samples, rate: cap.sampleRate };
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(toWav(cap.samples, cap.sampleRate)));
    if (cap.peak < SILENCE_PEAK) {
      setWarn("⚠ No audio detected — check your microphone and re-record.");
    } else if (cap.seconds < 2) {
      setWarn("⚠ That was very short — give the whole line, full energy.");
    } else if (dbfs(cap.rms) < -32) {
      setWarn("⚠ Quite quiet — get closer to the mic and give it more.");
    }
    setRecState("review");
  };

  const submit = async () => {
    const take = takeRef.current;
    if (!take || submitting) return;
    setSubmitting(true);
    setWarn(null);
    try {
      const mp3 = encodeMp3(take.samples, take.rate, 112);
      const res = await fetch(`/api/audition/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          mp3Base64: bytesToBase64(mp3),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "failed");
      setSubmitted(true);
    } catch (err) {
      setWarn(`⚠ ${err instanceof Error ? err.message : "Submission failed — try again"}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (failed) {
    return (
      <div className="booth">
        <h1>Link not found</h1>
        <p>This audition link isn&apos;t valid. Please check with whoever sent it to you.</p>
      </div>
    );
  }
  if (!view) return <div className="booth"><p>Loading…</p></div>;

  if (submitted) {
    return (
      <div className="booth">
        <h1>Audition in 🎬</h1>
        <p className="booth-sub">
          Thanks, {name.trim() || "friend"} — your {view.personaName} audition has been
          submitted.
        </p>
        <div className="booth-note">
          We listen to every audition. If yours is a fit, we&apos;ll be in touch at your email
          with the full paid recording session. Good luck!
        </div>
      </div>
    );
  }

  const ready =
    name.trim().length >= 2 && /@.+\./.test(email) && recState === "review" && !!takeRef.current;

  return (
    <div className="booth">
      <h1>Audition: {view.personaName}</h1>
      <p className="booth-sub">
        One line, in character, full commitment. Read the brief, then make us believe it.
      </p>

      <div className="booth-brief">{view.brief}</div>

      <div className="booth-form">
        <label>
          Your name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        </label>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </label>
      </div>

      <div className="booth-read-title">🎬 Your line — big energy, own it:</div>
      <div className="booth-phrase long">{view.line}</div>
      <div className="booth-note">
        Feel free to make it yours — an extra lah, your own flourish — as long as it stays
        this character. Quiet room, phone or laptop mic is fine. Re-record as many times as
        you like before submitting.
      </div>

      <div className="booth-meter"><div style={{ width: `${Math.min(100, level * 130)}%` }} /></div>

      {recState === "recording" ? (
        <button className="booth-record recording" onClick={() => void stopTake()}>
          ⏹ Stop · {elapsed.toFixed(0)}s
        </button>
      ) : (
        <button className="booth-record" onClick={() => void startTake()}>
          ● {recState === "review" ? "Re-record" : "Record your audition"}
        </button>
      )}

      {recState === "review" && previewUrl && (
        <div className="booth-review">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls src={previewUrl} />
          <button className="booth-primary" disabled={!ready || submitting} onClick={() => void submit()}>
            {submitting ? "Submitting…" : "🎬 Submit audition"}
          </button>
          {!ready && (
            <div className="booth-warn">Fill in your name and email above to submit.</div>
          )}
        </div>
      )}
      {warn && <div className="booth-warn">{warn}</div>}

      <div className="booth-tips">
        By submitting, you agree we may keep and review this recording for casting purposes.
        It won&apos;t be published or used in any product.
      </div>
    </div>
  );
}
