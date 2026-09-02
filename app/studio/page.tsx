"use client";

import { useCallback, useEffect, useState } from "react";
import { PERSONA_LIST } from "@/lib/personas";
import { decodeToMono, encodeMp3, bytesToBase64 } from "@/lib/studioAudio";
import type { PersonaId } from "@/lib/types";

// The voice studio — a desktop admin console kept OUT of the app: create
// actor sessions, review takes against the current library audio, flag items
// for re-record, promote approved takes into the live library, and drive the
// ElevenLabs instant clone (built automatically at submission, rebuildable
// and ear-checkable here). Same Google-account gate as the app admin plus
// the same PIN.

interface SessionRow {
  id: string;
  label: string;
  persona: PersonaId;
  createdAt: number;
  takeCount: number;
  itemTotal?: number;
  submittedAt?: number;
  feeSgd?: number;
  currency?: "SGD" | "USD";
  payVia?: string;
  deadlineAt?: number;
  test?: boolean;
  cloneOnly?: boolean;
  license?: {
    typedName: string;
    email: string;
    paynowId: string;
    feeSgd?: number;
    currency?: "SGD" | "USD";
    payVia?: string;
    at: number;
    version: string;
  };
  pvc?: { voiceId?: string; state: string; attempts?: number; note?: string };
  flags?: { itemId: string; note?: string; at: number }[];
}

interface AuditionRow {
  call: { id: string; persona: PersonaId; createdAt: number };
  submissions: { id: string; name: string; email: string; at: number; audioUrl: string | null }[];
}

interface EditRow {
  id: string;
  label: string;
  persona: PersonaId;
  createdAt: number;
  submittedAt: number;
  pending: number;
  accepted: number;
  rejected: number;
}

interface EditItem {
  id: string;
  category: string;
  original: string;
  suggested: string;
  verdict: "accepted" | "rejected" | null;
}

/** Word-level track changes: deletions struck red, insertions green. */
function WordDiff({ from, to }: { from: string; to: string }) {
  const A = from.split(/\s+/);
  const B = to.split(/\s+/);
  const dp: number[][] = Array.from({ length: A.length + 1 }, () =>
    new Array<number>(B.length + 1).fill(0)
  );
  for (let i = A.length - 1; i >= 0; i--) {
    for (let j = B.length - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const parts: { type: "same" | "del" | "ins"; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) {
      parts.push({ type: "same", text: A[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      parts.push({ type: "del", text: A[i] });
      i++;
    } else {
      parts.push({ type: "ins", text: B[j] });
      j++;
    }
  }
  while (i < A.length) parts.push({ type: "del", text: A[i++] });
  while (j < B.length) parts.push({ type: "ins", text: B[j++] });
  return (
    <span className="phrase-diff">
      {parts.map((p, k) => (
        <span key={k}>
          {p.type === "same" && p.text}
          {p.type === "del" && <del>{p.text}</del>}
          {p.type === "ins" && <ins>{p.text}</ins>}{" "}
        </span>
      ))}
    </span>
  );
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
  const [newTest, setNewTest] = useState(false);
  const [newClone, setNewClone] = useState(false);
  const [newCurrency, setNewCurrency] = useState<"SGD" | "USD">("SGD");
  const [newPayMode, setNewPayMode] = useState<"paynow" | "other">("paynow");
  const [newPlatform, setNewPlatform] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [auditions, setAuditions] = useState<AuditionRow[] | null>(null);
  const [audPersona, setAudPersona] = useState<PersonaId>("ahbeng");
  const [edits, setEdits] = useState<EditRow[] | null>(null);
  const [editPersona, setEditPersona] = useState<PersonaId>("ahbeng");
  const [editLabel, setEditLabel] = useState("");
  const [openEdit, setOpenEdit] = useState<{ session: EditRow; items: EditItem[] } | null>(null);
  const [amendId, setAmendId] = useState<string | null>(null);
  const [amendText, setAmendText] = useState("");
  const [overrides, setOverrides] = useState<
    { persona: PersonaId; id: string; category: string; shipped: string; corrected: string }[] | null
  >(null);

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

  const loadAuditions = useCallback(() => {
    void fetch("/api/studio/auditions", { headers: headers() })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { auditions: AuditionRow[] }) => setAuditions(data.auditions))
      .catch(() => setAuditions([]));
  }, [headers]);

  const loadEdits = useCallback(() => {
    void fetch("/api/studio/edits", { headers: headers() })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { edits: EditRow[] }) => setEdits(data.edits))
      .catch(() => setEdits([]));
    void fetch("/api/studio/overrides", { headers: headers() })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { overrides: typeof overrides }) => setOverrides(data.overrides ?? []))
      .catch(() => setOverrides([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headers]);

  useEffect(() => {
    if (pinOk && me?.isAdmin) {
      loadSessions();
      loadAuditions();
      loadEdits();
    }
  }, [pinOk, me, loadSessions, loadAuditions, loadEdits]);

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
          currency: newCurrency,
          payVia: newPayMode === "other" ? newPlatform : "",
          // End of the chosen day, Singapore time.
          deadlineAt: Date.parse(`${newDeadline}T23:59:59+08:00`),
          test: newTest,
          cloneOnly: newClone,
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
    // Serialized, and the UI updates from the POST's own response — a fresh
    // GET straight after a write can race the blob store's edge cache and
    // show the flag as never having happened.
    if (!open || busy) return;
    const noteText = on ? prompt("Note for the actor (optional):") ?? "" : "";
    setBusy("flag");
    try {
      const res = await fetch(`/api/studio/sessions/${open.session.id}`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ action: on ? "flag" : "unflag", itemId, note: noteText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "flag failed");
      setOpen((o) => (o ? { ...o, session: data.session as SessionRow } : o));
    } catch (err) {
      setNote(`⚠ ${err instanceof Error ? err.message : "flag failed"}`);
    } finally {
      setBusy(null);
    }
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
      if (action === "test-voice") {
        // Ear check: play the rendered line right here and show what it said.
        setNote(`▶ Test line: “${data.text}”`);
        void new Audio(`data:audio/mpeg;base64,${data.audioBase64}`).play();
      } else {
        void openSession(open.session.id);
      }
    } catch (err) {
      setNote(`⚠ ${err instanceof Error ? err.message : "pvc failed"}`);
    } finally {
      setBusy(null);
    }
  };

  const openEditSession = async (id: string) => {
    setNote(null);
    try {
      const res = await fetch(`/api/studio/edits/${id}`, { headers: headers() });
      if (!res.ok) throw new Error("load failed");
      setOpenEdit((await res.json()) as { session: EditRow; items: EditItem[] });
    } catch (err) {
      setNote(`⚠ ${err instanceof Error ? err.message : "load failed"}`);
    }
  };

  const editVerdict = async (phraseId: string, action: "accept" | "reject") => {
    if (!openEdit || busy) return;
    setBusy(action);
    try {
      const res = await fetch(`/api/studio/edits/${openEdit.session.id}`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          action,
          phraseId,
          // Every verdict this screen already knows — the server merges them
          // in case its own read of the session was a stale copy.
          knownResolved: Object.fromEntries(
            openEdit.items.filter((i) => i.verdict).map((i) => [i.id, i.verdict])
          ),
        }),
      });
      const data = (await res.json()) as { session: EditRow; items: EditItem[] };
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "failed");
      // Belt and braces against blob-storage lag: whatever any (possibly
      // stale) copy claims, the verdict that was just written must not
      // un-happen on screen.
      data.items = data.items.map((x) =>
        x.id === phraseId
          ? { ...x, verdict: action === "accept" ? ("accepted" as const) : ("rejected" as const) }
          : x
      );
      setOpenEdit(data);
    } catch (err) {
      setNote(`⚠ ${err instanceof Error ? err.message : "verdict failed"}`);
    } finally {
      setBusy(null);
    }
  };

  const amend = async () => {
    if (!openEdit || !amendId || busy) return;
    setBusy("amend");
    try {
      const res = await fetch(`/api/studio/edits/${openEdit.session.id}`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          action: "amend",
          phraseId: amendId,
          text: amendText,
          knownResolved: Object.fromEntries(
            openEdit.items.filter((i) => i.verdict).map((i) => [i.id, i.verdict])
          ),
        }),
      });
      const data = (await res.json()) as { session: EditRow; items: EditItem[] };
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "failed");
      // Same stale-copy guard as verdicts: the amendment just saved wins.
      const saved = amendText.trim().slice(0, 600);
      data.items = data.items.map((x) =>
        x.id === amendId ? { ...x, suggested: saved, verdict: null } : x
      );
      setOpenEdit(data);
      setAmendId(null);
    } catch (err) {
      setNote(`⚠ ${err instanceof Error ? err.message : "edit failed"}`);
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

      {openEdit ? (
        <>
          <button className="studio-link" onClick={() => { setOpenEdit(null); loadEdits(); }}>
            ‹ Back
          </button>
          <h2>
            ✏️ {openEdit.session.label} · {openEdit.session.persona} — suggested phrase edits
          </h2>
          {openEdit.items.length === 0 && <p className="studio-sub">No suggestions yet.</p>}
          {openEdit.items
            .filter((it) => it.verdict !== "rejected")
            .map((it) => (
            <div key={it.id} className={`edit-row${it.verdict === "accepted" ? " accepted" : ""}`}>
              <div className="edit-row-head">
                <span className="edit-id">
                  {it.id} · {it.category}
                </span>
                {it.verdict === "accepted" && (
                  <span className="edit-tag ok">✓ accepted — audio deleted for re-render</span>
                )}
              </div>
              {amendId === it.id ? (
                <>
                  <textarea
                    value={amendText}
                    rows={Math.max(3, Math.ceil(amendText.length / 70))}
                    onChange={(e) => setAmendText(e.target.value)}
                  />
                  <div style={{ marginTop: 6, display: "flex", gap: 14 }}>
                    <button
                      className="studio-link"
                      disabled={!!busy || amendText.trim().length < 2}
                      onClick={() => void amend()}
                    >
                      💾 Save edit
                    </button>
                    <button className="studio-link" onClick={() => setAmendId(null)}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <WordDiff from={it.original} to={it.suggested} />
                  {!it.verdict && (
                    <div style={{ marginTop: 6, display: "flex", gap: 14 }}>
                      <button
                        className="studio-link"
                        disabled={!!busy}
                        onClick={() => void editVerdict(it.id, "accept")}
                      >
                        ✓ Accept
                      </button>
                      <button
                        className="studio-link"
                        disabled={!!busy}
                        onClick={() => void editVerdict(it.id, "reject")}
                      >
                        ✗ Reject
                      </button>
                      <button
                        className="studio-link"
                        disabled={!!busy}
                        onClick={() => {
                          setAmendId(it.id);
                          setAmendText(it.suggested);
                        }}
                      >
                        ✎ Edit
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
          {openEdit.items.some((it) => it.verdict === "rejected") && (
            <p className="studio-sub">
              {openEdit.items.filter((it) => it.verdict === "rejected").length} rejected
              suggestion{openEdit.items.filter((it) => it.verdict === "rejected").length === 1 ? "" : "s"}{" "}
              hidden.
            </p>
          )}
          <p className="studio-sub">
            Accepting replaces the phrase&apos;s text everywhere immediately and deletes its
            audio — the app&apos;s automatic gap-fill (or Admin&apos;s &quot;Render
            missing&quot;) re-cuts it with the corrected words.
          </p>
        </>
      ) : !open ? (
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
              placeholder="Fee"
              inputMode="decimal"
              style={{ width: 90 }}
            />
            <select
              value={newCurrency}
              onChange={(e) => setNewCurrency(e.target.value as "SGD" | "USD")}
              title="Fee currency — baked into the licence"
            >
              <option value="SGD">SGD</option>
              <option value="USD">USD</option>
            </select>
            <select
              value={newPayMode}
              onChange={(e) => setNewPayMode(e.target.value as "paynow" | "other")}
              title="PayNow collects the actor's PayNow ID; a platform (Fiverr etc.) settles outside the booth"
            >
              <option value="paynow">Pay by PayNow</option>
              <option value="other">Pay via platform…</option>
            </select>
            {newPayMode === "other" && (
              <input
                value={newPlatform}
                onChange={(e) => setNewPlatform(e.target.value)}
                placeholder="Platform, e.g. Fiverr"
                style={{ width: 140 }}
              />
            )}
            <input
              type="date"
              value={newDeadline}
              onChange={(e) => setNewDeadline(e.target.value)}
              title="Completion deadline (end of day, Singapore time)"
            />
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={newTest}
                onChange={(e) => setNewTest(e.target.checked)}
              />
              🧪 Test (13 items, no promotion)
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={newClone}
                onChange={(e) => setNewClone(e.target.checked)}
              />
              🎧 Clone only (10 paragraphs, fee &amp; deadline optional)
            </label>
            <button
              onClick={() => void createSession()}
              disabled={
                !newLabel.trim() ||
                (newPayMode === "other" && !newPlatform.trim()) ||
                (!newClone &&
                  (!(Number(newFee) > 0) ||
                    !(Date.parse(`${newDeadline}T23:59:59+08:00`) > Date.now())))
              }
            >
              Create session
            </button>
          </div>
          <table className="studio-table">
            <thead>
              <tr><th>Actor</th><th>Type</th><th>Persona</th><th>Fee</th><th>Deadline</th><th>Progress</th><th>License</th><th>Clone</th><th>Link</th><th></th></tr>
            </thead>
            <tbody>
              {(sessions ?? []).map((s) => (
                <tr key={s.id}>
                  <td>
                    <button className="studio-link" onClick={() => void openSession(s.id)}>
                      {s.label}
                    </button>
                  </td>
                  <td>{s.test ? "🧪 Test" : s.cloneOnly ? "🎧 Clone" : "Live"}</td>
                  <td>{s.persona}</td>
                  <td>
                    {(s.feeSgd ?? 0).toFixed(0)} {s.currency ?? "SGD"}
                    {s.payVia ? ` · ${s.payVia}` : ""}
                  </td>
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
                    {s.submittedAt
                      ? ` · ✅ submitted ${new Date(s.submittedAt).toLocaleDateString("en-SG", {
                          day: "numeric",
                          month: "short",
                        })}`
                      : ""}
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
                <tr><td colSpan={10}>No sessions yet — create one above.</td></tr>
              )}
            </tbody>
          </table>

          <h2 style={{ marginTop: 28 }}>🎬 Auditions</h2>
          <p className="studio-sub">
            One public link per character — anyone with it reads the brief and records the
            audition line. Like a take? Prefill a full paid session for that actor.
          </p>
          <div className="studio-create">
            <select value={audPersona} onChange={(e) => setAudPersona(e.target.value as PersonaId)}>
              {PERSONA_LIST.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button
              onClick={() => {
                void fetch("/api/studio/auditions", {
                  method: "POST",
                  headers: headers(),
                  body: JSON.stringify({ persona: audPersona }),
                })
                  .then((res) => (res.ok ? res.json() : Promise.reject()))
                  .then((data: { call: { id: string } }) => {
                    void navigator.clipboard.writeText(
                      `${location.origin}/audition/${data.call.id}`
                    );
                    setNote("✓ Audition link created and copied to clipboard");
                    loadAuditions();
                  })
                  .catch(() => setNote("⚠ Couldn't create the audition link"));
              }}
            >
              🎤 New audition link
            </button>
          </div>
          {(auditions ?? []).map(({ call, submissions }) => (
            <div key={call.id} style={{ marginTop: 14 }}>
              <p className="studio-license">
                <strong>{PERSONA_LIST.find((p) => p.id === call.persona)?.name ?? call.persona}</strong>{" "}
                · opened {new Date(call.createdAt).toLocaleDateString("en-SG", { day: "numeric", month: "short" })}{" "}
                · {submissions.length} audition{submissions.length === 1 ? "" : "s"} ·{" "}
                <button
                  className="studio-link"
                  onClick={() =>
                    void navigator.clipboard.writeText(`${location.origin}/audition/${call.id}`)
                  }
                >
                  Copy link
                </button>{" "}
                <button
                  className="studio-link"
                  onClick={() => {
                    if (
                      confirm(
                        `Close this ${call.persona} audition? The link stops working and all ${submissions.length} submissions are deleted.`
                      )
                    ) {
                      void fetch(`/api/studio/auditions?id=${call.id}`, {
                        method: "DELETE",
                        headers: headers(),
                      }).then(loadAuditions);
                    }
                  }}
                >
                  ✕ Close
                </button>
              </p>
              {submissions.length > 0 && (
                <table className="studio-table">
                  <thead>
                    <tr><th>Name</th><th>Email</th><th>When</th><th>Audition</th><th></th></tr>
                  </thead>
                  <tbody>
                    {submissions.map((sub) => (
                      <tr key={sub.id}>
                        <td>{sub.name}</td>
                        <td>{sub.email}</td>
                        <td>
                          {new Date(sub.at).toLocaleDateString("en-SG", {
                            day: "numeric",
                            month: "short",
                          })}
                        </td>
                        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                        <td>{sub.audioUrl ? <audio controls preload="none" src={sub.audioUrl} /> : "—"}</td>
                        <td>
                          <button
                            className="studio-link"
                            onClick={() => {
                              // Prefill the session form; fee and deadline stay
                              // the admin's call.
                              setNewLabel(sub.name);
                              setNewPersona(call.persona);
                              setNote(
                                `✓ Session form prefilled for ${sub.name} (${sub.email}) — set the fee and deadline, then Create session and email them the link.`
                              );
                              window.scrollTo({ top: 0, behavior: "smooth" });
                            }}
                          >
                            ★ Cast — prefill session
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
          {auditions !== null && auditions.length === 0 && (
            <p className="studio-sub">No audition calls open.</p>
          )}

          <h2 style={{ marginTop: 28 }}>✏️ Phrase edits</h2>
          <p className="studio-sub">
            A link where a human fixes AI-generated phrases, one text box per phrase.
            Review every change as a tracked diff; accepting updates the app and queues
            the audio for re-render.
          </p>
          <div className="studio-create">
            <input
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              placeholder="Editor label, e.g. Auntie Karen"
            />
            <select
              value={editPersona}
              onChange={(e) => setEditPersona(e.target.value as PersonaId)}
            >
              {PERSONA_LIST.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button
              disabled={!editLabel.trim()}
              onClick={() => {
                void fetch("/api/studio/edits", {
                  method: "POST",
                  headers: headers(),
                  body: JSON.stringify({ label: editLabel, persona: editPersona }),
                })
                  .then((res) => (res.ok ? res.json() : Promise.reject()))
                  .then((data: { session: { id: string } }) => {
                    void navigator.clipboard.writeText(
                      `${location.origin}/edit/${data.session.id}`
                    );
                    setEditLabel("");
                    setNote("✓ Editing link created and copied to clipboard");
                    loadEdits();
                  })
                  .catch(() => setNote("⚠ Couldn't create the editing link"));
              }}
            >
              ✏️ New editing link
            </button>
          </div>
          {(edits ?? []).map((e) => (
            <p className="studio-license" key={e.id}>
              <button className="studio-link" onClick={() => void openEditSession(e.id)}>
                <strong>{e.label}</strong>
              </button>{" "}
              · {e.persona} · {e.pending} pending · {e.accepted} accepted · {e.rejected}{" "}
              rejected
              {e.submittedAt
                ? ` · ✅ submitted ${new Date(e.submittedAt).toLocaleDateString("en-SG", {
                    day: "numeric",
                    month: "short",
                  })}`
                : ""}{" "}
              ·{" "}
              <button
                className="studio-link"
                onClick={() =>
                  void navigator.clipboard.writeText(`${location.origin}/edit/${e.id}`)
                }
              >
                Copy link
              </button>{" "}
              <button
                className="studio-link"
                onClick={() => {
                  if (
                    confirm(
                      `Delete ${e.label}'s editing link? Unreviewed suggestions are lost; accepted edits stay live.`
                    )
                  ) {
                    void fetch(`/api/studio/edits?id=${e.id}`, {
                      method: "DELETE",
                      headers: headers(),
                    }).then(loadEdits);
                  }
                }}
              >
                ✕ Delete
              </button>
            </p>
          ))}
          {edits !== null && edits.length === 0 && (
            <p className="studio-sub">No editing links yet.</p>
          )}

          {(overrides ?? []).length > 0 && (
            <>
              <h2 style={{ marginTop: 28 }}>🩹 Live corrections</h2>
              <p className="studio-sub">
                Accepted edits currently overriding the shipped wording. Reverting restores
                the original text and deletes the phrase&apos;s audio so it re-renders — an
                actor take comes back via re-promote from their session instead.
              </p>
              {(overrides ?? []).map((o) => (
                <div key={`${o.persona}/${o.id}`} className="edit-row">
                  <div className="edit-row-head">
                    <span className="edit-id">
                      {o.persona} · {o.id} · {o.category}
                    </span>
                    <button
                      className="studio-link"
                      disabled={!!busy}
                      onClick={() => {
                        if (
                          !confirm(
                            `Revert ${o.persona}/${o.id} to its original wording? The corrected audio is deleted and the phrase re-renders with the shipped text.`
                          )
                        )
                          return;
                        setBusy("revert");
                        void fetch(
                          `/api/studio/overrides?persona=${o.persona}&id=${o.id}`,
                          { method: "DELETE", headers: headers() }
                        )
                          .then((res) => {
                            if (!res.ok) throw new Error();
                            setOverrides((prev) =>
                              (prev ?? []).filter(
                                (x) => !(x.persona === o.persona && x.id === o.id)
                              )
                            );
                            setNote(`✓ Reverted ${o.persona}/${o.id} — will re-render with original text`);
                          })
                          .catch(() => setNote("⚠ Revert failed — try again"))
                          .finally(() => setBusy(null));
                      }}
                    >
                      ↩ Revert
                    </button>
                  </div>
                  <WordDiff from={o.shipped} to={o.corrected} />
                </div>
              ))}
            </>
          )}
        </>
      ) : (
        <>
          <button className="studio-link" onClick={() => { setOpen(null); loadSessions(); }}>
            ‹ All sessions
          </button>
          <h2>
            {open.session.test ? "🧪 TEST SESSION · " : ""}
            {open.session.cloneOnly ? "🎧 CLONE ONLY · " : ""}
            {open.session.label} · {open.session.persona} · {open.session.currency ?? "SGD"}{" "}
            {(open.session.feeSgd ?? 0).toFixed(2)}
            {open.session.payVia ? ` via ${open.session.payVia}` : ""}{" "}
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
              Signed: {open.session.license.typedName} · {open.session.license.email} ·{" "}
              {open.session.license.payVia
                ? `via ${open.session.license.payVia}`
                : `PayNow ${open.session.license.paynowId || "—"}`}{" "}
              · {open.session.license.currency ?? "SGD"}{" "}
              {(open.session.license.feeSgd ?? 0).toFixed(2)} ·{" "}
              {new Date(open.session.license.at).toLocaleString()} ({open.session.license.version})
              {" · "}
              <a
                className="studio-link"
                href={(() => {
                  const lic = open.session.license;
                  const flaggedCount = (open.session.flags ?? []).length;
                  const link = `${location.origin}/record/${open.session.id}`;
                  const subject =
                    flaggedCount > 0
                      ? "Your voice session — a few takes need another pass"
                      : "Your voice session";
                  const body =
                    flaggedCount > 0
                      ? `Hi ${lic.typedName},\n\nThanks for your recordings! A few items need another take — open your recording link and they'll be marked 🔁 with a note on each:\n\n${link}\n\nOnce you've re-recorded them, press "Review all takes & submit" again.\n\nThanks!`
                      : `Hi ${lic.typedName},\n\nHere's your recording link:\n\n${link}\n\nThanks!`;
                  return `mailto:${lic.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                })()}
              >
                ✉ Email actor
              </a>
            </p>
          )}
          <div className="studio-actions">
            <button
              onClick={() => void promote()}
              disabled={!!busy || open.session.test || open.session.cloneOnly}
              title={
                open.session.test
                  ? "Test sessions never touch a real library"
                  : open.session.cloneOnly
                    ? "Clone-only sessions have no phrases to promote"
                    : undefined
              }
            >
              ⬆ Promote {approved.size} approved takes
            </button>
            <button onClick={() => void pvcAction("instant")} disabled={!!busy}>
              ⚡ {open.session.pvc?.voiceId ? "Rebuild instant clone" : "Create instant clone"}
            </button>
            <button
              onClick={() => void pvcAction("test-voice")}
              disabled={!!busy || !open.session.pvc?.voiceId}
            >
              ▶ Test voice
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
              To make this voice live: set{" "}
              <code>ELEVENLABS_VOICE_{open.session.persona.toUpperCase()}</code> ={" "}
              <code>{open.session.pvc.voiceId}</code> in the Vercel environment, redeploy,
              then Re-render the persona in Admin — live phrases use it immediately, the
              pre-rendered pack after the re-render.
            </p>
          )}
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
