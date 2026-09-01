"use client";

import { useCallback, useEffect, useState } from "react";
import { PERSONA_LIST } from "@/lib/personas";
import { decodeToMono, encodeMp3, bytesToBase64 } from "@/lib/studioAudio";
import type { PersonaId } from "@/lib/types";

// The voice studio — a desktop admin console kept OUT of the app: create
// actor sessions, review takes against the current library audio, flag items
// for re-record, promote approved takes into the live library, and drive the
// ElevenLabs professional clone (upload, verification, training). Same
// Google-account gate as the app admin plus the same PIN.

interface SessionRow {
  id: string;
  label: string;
  persona: PersonaId;
  createdAt: number;
  takeCount: number;
  itemTotal?: number;
  feeSgd?: number;
  deadlineAt?: number;
  license?: {
    typedName: string;
    email: string;
    paynowId: string;
    feeSgd?: number;
    at: number;
    version: string;
  };
  pvc?: { voiceId?: string; state: string; attempts?: number; note?: string };
  flags?: { itemId: string; note?: string; at: number }[];
}

interface ReviewItem {
  id: string;
  kind: "phrase" | "read";
  text: string;
  title?: string;
  takeUrl: string | null;
  takeAt: string | null;
  libUrl: string | null;
}

const PIN_KEY = "runbuddy-studio-pin";

export default function StudioPage() {
  const [me, setMe] = useState<{ user: { name: string } | null; isAdmin?: boolean } | null>(null);
  const [pin, setPin] = useState("");
  const [pinOk, setPinOk] = useState(false);
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [open, setOpen] = useState<{ session: SessionRow; items: ReviewItem[] } | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [newPersona, setNewPersona] = useState<PersonaId>("ahbeng");
  const [newFee, setNewFee] = useState("");
  const [newDeadline, setNewDeadline] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [pvcStatus, setPvcStatus] = useState<string | null>(null);

  const headers = useCallback(
    (): Record<string, string> => ({
      "Content-Type": "application/json",
      "x-admin-pin": pin,
    }),
    [pin]
  );

  useEffect(() => {
    void fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setMe(data ?? { user: null }))
      .catch(() => setMe({ user: null }));
    try {
      const saved = sessionStorage.getItem(PIN_KEY);
      if (saved) {
        setPin(saved);
        setPinOk(true);
      }
    } catch {
      /* fine */
    }
  }, []);

  const loadSessions = useCallback(() => {
    void fetch("/api/studio/sessions", { headers: headers() })
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data: { sessions: SessionRow[] }) => setSessions(data.sessions))
      .catch((status) => {
        if (status === 403) {
          setPinOk(false);
          try {
            sessionStorage.removeItem(PIN_KEY);
          } catch {
            /* fine */
          }
        }
        setSessions([]);
      });
  }, [headers]);

  useEffect(() => {
    if (pinOk && me?.isAdmin) loadSessions();
  }, [pinOk, me, loadSessions]);

  if (!me) return <div className="studio"><p>Loading…</p></div>;
  if (!me.user || me.isAdmin === false) {
    return (
      <div className="studio">
        <h1>Run Buddy Studio</h1>
        <p>
          Admin sign-in required.{" "}
          <a href="/api/auth/login">Sign in with Google</a> (then come back to /studio).
        </p>
      </div>
    );
  }
  if (!pinOk) {
    return (
      <div className="studio">
        <h1>Run Buddy Studio</h1>
        <p>Enter the admin PIN.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            try {
              sessionStorage.setItem(PIN_KEY, pin);
            } catch {
              /* fine */
            }
            setPinOk(true);
          }}
        >
          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Admin PIN"
          />
          <button type="submit">Unlock</button>
        </form>
      </div>
    );
  }

  const createSession = async () => {
    setNote(null);
    try {
      const res = await fetch("/api/studio/sessions", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          label: newLabel,
          persona: newPersona,
          feeSgd: Number(newFee),
          // End of the chosen day, Singapore time.
          deadlineAt: Date.parse(`${newDeadline}T23:59:59+08:00`),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "failed");
      setNewLabel("");
      setNewFee("");
      setNewDeadline("");
      loadSessions();
    } catch (err) {
      setNote(`⚠ ${err instanceof Error ? err.message : "create failed"}`);
    }
  };

  const openSession = async (id: string) => {
    setNote(null);
    setOpen(null);
    setApproved(new Set());
    setPvcStatus(null);
    try {
      const res = await fetch(`/api/studio/sessions/${id}`, { headers: headers() });
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as { session: SessionRow; items: ReviewItem[] };
      setOpen(data);
      setApproved(new Set(data.items.filter((i) => i.kind === "phrase" && i.takeUrl).map((i) => i.id)));
    } catch (err) {
      setNote(`⚠ ${err instanceof Error ? err.message : "load failed"}`);
    }
  };

  const flag = async (itemId: string, on: boolean) => {
    if (!open) return;
    const noteText = on ? prompt("Note for the actor (optional):") ?? "" : "";
    await fetch(`/api/studio/sessions/${open.session.id}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ action: on ? "flag" : "unflag", itemId, note: noteText }),
    }).catch(() => {});
    void openSession(open.session.id);
  };

  const promote = async () => {
    if (!open) return;
    const targets = open.items.filter((i) => approved.has(i.id) && i.takeUrl && i.kind === "phrase");
    setBusy(`Promoting 0/${targets.length}…`);
    let doneCount = 0;
    const failed: string[] = [];
    let batch: { phraseId: string; mp3Base64: string }[] = [];
    let batchBytes = 0;
    const flush = async () => {
      if (batch.length === 0) return;
      const res = await fetch("/api/studio/promote", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ sessionId: open.session.id, items: batch }),
      });
      const data = res.ok ? await res.json() : { done: [], failed: batch.map((b) => ({ phraseId: b.phraseId })) };
      doneCount += (data.done ?? []).length;
      for (const f of data.failed ?? []) failed.push(f.phraseId);
      batch = [];
      batchBytes = 0;
      setBusy(`Promoting ${doneCount}/${targets.length}…`);
    };
    try {
      for (const item of targets) {
        const buf = await (await fetch(item.takeUrl!)).arrayBuffer();
        const { samples, sampleRate } = await decodeToMono(buf);
        const mp3 = encodeMp3(samples, sampleRate, 112);
        const b64 = bytesToBase64(mp3);
        if (batchBytes + b64.length > 2_800_000) await flush();
        batch.push({ phraseId: item.id, mp3Base64: b64 });
        batchBytes += b64.length;
      }
      await flush();
      setNote(
        failed.length === 0
          ? `✓ Promoted ${doneCount} takes into the live library — phones re-download them automatically`
          : `Promoted ${doneCount}; failed: ${failed.join(", ")}`
      );
    } catch (err) {
      setNote(`⚠ ${err instanceof Error ? err.message : "promotion failed"}`);
    } finally {
      setBusy(null);
    }
  };

  const pvcAction = async (action: string) => {
    if (!open) return;
    setBusy(action);
    setNote(null);
    try {
      const res = await fetch("/api/studio/pvc", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ action, sessionId: open.session.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed");
      if (action === "status") setPvcStatus(JSON.stringify(data.status, null, 1).slice(0, 2000));
      else void openSession(open.session.id);
    } catch (err) {
      setNote(`⚠ ${err instanceof Error ? err.message : "pvc failed"}`);
    } finally {
      setBusy(null);
    }
  };

  const pvcUpload = async () => {
    if (!open) return;
    const targets = open.items.filter((i) => i.takeUrl);
    setBusy(`Uploading clone samples 0/${targets.length}…`);
    let doneCount = 0;
    try {
      let batch: { name: string; mp3Base64: string }[] = [];
      let bytes = 0;
      const flush = async () => {
        if (batch.length === 0) return;
        const res = await fetch("/api/studio/pvc/upload", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ sessionId: open.session.id, files: batch }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "upload failed");
        doneCount += batch.length;
        batch = [];
        bytes = 0;
        setBusy(`Uploading clone samples ${doneCount}/${targets.length}…`);
      };
      for (const item of targets) {
        const buf = await (await fetch(item.takeUrl!)).arrayBuffer();
        const { samples, sampleRate } = await decodeToMono(buf);
        const mp3 = encodeMp3(samples, sampleRate, 192);
        const b64 = bytesToBase64(mp3);
        if (bytes + b64.length > 2_800_000) await flush();
        batch.push({ name: `${item.id}.mp3`, mp3Base64: b64 });
        bytes += b64.length;
      }
      await flush();
      await pvcAction("mark-uploaded");
      setNote(`✓ Uploaded ${doneCount} samples to the clone`);
    } catch (err) {
      setNote(`⚠ ${err instanceof Error ? err.message : "upload failed"}`);
    } finally {
      setBusy(null);
    }
  };

  const flaggedSet = new Set((open?.session.flags ?? []).map((f) => f.itemId));

  return (
    <div className="studio">
      <h1>Run Buddy Studio</h1>
      <p className="studio-sub">Voice sessions, take review, library promotion, clone pipeline.</p>
      {note && <div className="studio-note">{note}</div>}
      {busy && <div className="studio-note">⏳ {busy}</div>}

      {!open ? (
        <>
          <div className="studio-create">
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Actor label, e.g. John Tan"
            />
            <select value={newPersona} onChange={(e) => setNewPersona(e.target.value as PersonaId)}>
              {PERSONA_LIST.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input
              value={newFee}
              onChange={(e) => setNewFee(e.target.value)}
              placeholder="Fee (SGD)"
              inputMode="decimal"
              style={{ width: 110 }}
            />
            <input
              type="date"
              value={newDeadline}
              onChange={(e) => setNewDeadline(e.target.value)}
              title="Completion deadline (end of day, Singapore time)"
            />
            <button
              onClick={() => void createSession()}
              disabled={
                !newLabel.trim() ||
                !(Number(newFee) > 0) ||
                !(Date.parse(`${newDeadline}T23:59:59+08:00`) > Date.now())
              }
            >
              Create session
            </button>
          </div>
          <table className="studio-table">
            <thead>
              <tr><th>Actor</th><th>Persona</th><th>Fee</th><th>Deadline</th><th>Progress</th><th>License</th><th>Clone</th><th>Link</th><th></th></tr>
            </thead>
            <tbody>
              {(sessions ?? []).map((s) => (
                <tr key={s.id}>
                  <td><button className="studio-link" onClick={() => void openSession(s.id)}>{s.label}</button></td>
                  <td>{s.persona}</td>
                  <td>${(s.feeSgd ?? 0).toFixed(0)}</td>
                  <td>
                    {s.deadlineAt
                      ? new Date(s.deadlineAt).toLocaleDateString("en-SG", {
                          day: "numeric",
                          month: "short",
                        }) + (s.deadlineAt < Date.now() ? " ⚠" : "")
                      : "—"}
                  </td>
                  <td>
                    {s.takeCount}/{s.itemTotal ?? "?"}
                    {s.itemTotal ? ` (${Math.round((s.takeCount / s.itemTotal) * 100)}%)` : ""}
                  </td>
                  <td>{s.license ? `✓ ${s.license.typedName}` : "—"}</td>
                  <td>{s.pvc?.state ?? "—"}</td>
                  <td>
                    <button
                      className="studio-link"
                      onClick={() => void navigator.clipboard.writeText(`${location.origin}/record/${s.id}`)}
                    >
                      Copy link
                    </button>
                  </td>
                  <td>
                    <button
                      className="studio-link"
                      onClick={() => {
                        if (
                          confirm(
                            `Withdraw ${s.label}'s invitation? Their link stops working and all ${s.takeCount} uploaded takes are deleted. Promoted library audio is untouched.`
                          )
                        ) {
                          void fetch(`/api/studio/sessions/${s.id}`, {
                            method: "DELETE",
                            headers: headers(),
                          }).then(loadSessions);
                        }
                      }}
                    >
                      ✕ Delete
                    </button>
                  </td>
                </tr>
              ))}
              {sessions !== null && sessions.length === 0 && (
                <tr><td colSpan={9}>No sessions yet — create one above.</td></tr>
              )}
            </tbody>
          </table>
        </>
      ) : (
        <>
          <button className="studio-link" onClick={() => { setOpen(null); loadSessions(); }}>
            ‹ All sessions
          </button>
          <h2>
            {open.session.label} · {open.session.persona} · SGD $
            {(open.session.feeSgd ?? 0).toFixed(2)}{" "}
            <button
              className="studio-link"
              onClick={() => {
                const v = prompt(
                  open.session.license
                    ? "Fee (SGD) — note: they already signed at the old amount, this only affects future signings:"
                    : "Fee (SGD):",
                  String(open.session.feeSgd ?? "")
                );
                if (v && Number(v) > 0) {
                  void fetch(`/api/studio/sessions/${open.session.id}`, {
                    method: "POST",
                    headers: headers(),
                    body: JSON.stringify({ action: "fee", feeSgd: Number(v) }),
                  }).then(() => void openSession(open.session.id));
                }
              }}
            >
              edit
            </button>
            {" · ⏰ "}
            {open.session.deadlineAt
              ? new Date(open.session.deadlineAt).toLocaleDateString("en-SG", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })
              : "no deadline"}{" "}
            <button
              className="studio-link"
              onClick={() => {
                const v = prompt("Deadline (YYYY-MM-DD, end of day Singapore time):");
                const at = v ? Date.parse(`${v}T23:59:59+08:00`) : NaN;
                if (isFinite(at) && at > Date.now()) {
                  void fetch(`/api/studio/sessions/${open.session.id}`, {
                    method: "POST",
                    headers: headers(),
                    body: JSON.stringify({ action: "deadline", deadlineAt: at }),
                  }).then(() => void openSession(open.session.id));
                }
              }}
            >
              edit
            </button>
          </h2>
          {open.session.license && (
            <p className="studio-license">
              Signed: {open.session.license.typedName} · {open.session.license.email} · PayNow{" "}
              {open.session.license.paynowId} · SGD $
              {(open.session.license.feeSgd ?? 0).toFixed(2)} ·{" "}
              {new Date(open.session.license.at).toLocaleString()} ({open.session.license.version})
            </p>
          )}
          <div className="studio-actions">
            <button onClick={() => void promote()} disabled={!!busy}>
              ⬆ Promote {approved.size} approved takes
            </button>
            <button onClick={() => void pvcAction("create")} disabled={!!busy || !!open.session.pvc?.voiceId}>
              Create clone voice
            </button>
            <button onClick={() => void pvcUpload()} disabled={!!busy || !open.session.pvc?.voiceId}>
              Upload clone samples
            </button>
            <button onClick={() => void pvcAction("open-verify")} disabled={!!busy || !open.session.pvc?.voiceId}>
              Open actor verification
            </button>
            <button onClick={() => void pvcAction("train")} disabled={!!busy || !open.session.pvc?.voiceId}>
              Start training
            </button>
            <button onClick={() => void pvcAction("status")} disabled={!!busy || !open.session.pvc?.voiceId}>
              Clone status
            </button>
            <button onClick={() => void pvcAction("manual-verify")} disabled={!!busy || !open.session.pvc?.voiceId}>
              Request manual verification
            </button>
          </div>
          {open.session.pvc && (
            <p className="studio-license">
              Clone: {open.session.pvc.state}
              {open.session.pvc.voiceId ? ` · voice_id: ${open.session.pvc.voiceId} ` : ""}
              {open.session.pvc.voiceId && (
                <button
                  className="studio-link"
                  onClick={() =>
                    void navigator.clipboard.writeText(open.session.pvc?.voiceId ?? "")
                  }
                >
                  copy
                </button>
              )}
              {open.session.pvc.note ? ` · ${open.session.pvc.note}` : ""}
            </p>
          )}
          {open.session.pvc?.voiceId && (
            <p className="studio-license">
              To make this voice live once training finishes: set{" "}
              <code>ELEVENLABS_VOICE_{open.session.persona.toUpperCase()}</code> ={" "}
              <code>{open.session.pvc.voiceId}</code> in the Vercel environment, redeploy,
              then Re-render the persona in Admin — live phrases use it immediately, the
              pre-rendered pack after the re-render.
            </p>
          )}
          {pvcStatus && <pre className="studio-status">{pvcStatus}</pre>}
          <table className="studio-table">
            <thead>
              <tr><th>✓</th><th>Item</th><th>Actor take</th><th>Current library</th><th>Flag</th></tr>
            </thead>
            <tbody>
              {open.items.map((i) => (
                <tr key={i.id} className={flaggedSet.has(i.id) ? "flagged" : ""}>
                  <td>
                    {i.kind === "phrase" && i.takeUrl && (
                      <input
                        type="checkbox"
                        checked={approved.has(i.id)}
                        onChange={(e) => {
                          const next = new Set(approved);
                          if (e.target.checked) next.add(i.id);
                          else next.delete(i.id);
                          setApproved(next);
                        }}
                      />
                    )}
                  </td>
                  <td className="studio-text">
                    <strong>{i.id}</strong>
                    {i.title ? ` · ${i.title}` : ""} — {i.text.slice(0, 140)}
                    {i.text.length > 140 ? "…" : ""}
                  </td>
                  {/* eslint-disable jsx-a11y/media-has-caption */}
                  <td>{i.takeUrl ? <audio controls preload="none" src={i.takeUrl} /> : "—"}</td>
                  <td>{i.libUrl ? <audio controls preload="none" src={i.libUrl} /> : "—"}</td>
                  {/* eslint-enable jsx-a11y/media-has-caption */}
                  <td>
                    <button className="studio-link" onClick={() => void flag(i.id, !flaggedSet.has(i.id))}>
                      {flaggedSet.has(i.id) ? "Unflag" : "🔁 Flag"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
