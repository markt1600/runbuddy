"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";

// The phrase-editing suite, booth-style: first a page on WHO the character
// is (you can't fix Singlish without knowing the voice), then one phrase per
// page — category on top, the text in a box, back/next underneath. Position
// is saved server-side with the edits, so leaving mid-way resumes on the
// exact phrase, from any device. Nothing goes live until each change is
// accepted in review.

interface EditView {
  personaName: string;
  label: string;
  brief: string;
  phrases: { id: string; category: string; text: string }[];
  suggestions: Record<string, string>;
  resolved: Record<string, "accepted" | "rejected">;
  cursor: number;
  submittedAt: number;
}

const BRIEF_KEY = (token: string) => `runbuddy-editbrief-${token}`;

const catLabel = (c: string) =>
  c.replace(/_/g, " ").replace(/^./, (ch) => ch.toUpperCase());

export default function EditPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [view, setView] = useState<EditView | null>(null);
  const [failed, setFailed] = useState(false);
  const [briefDone, setBriefDone] = useState(false);
  const [idx, setIdx] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty" | "error">("saved");
  const [submitted, setSubmitted] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef({ drafts, idx });
  stateRef.current = { drafts, idx };

  useEffect(() => {
    try {
      if (sessionStorage.getItem(BRIEF_KEY(token)) === "1") setBriefDone(true);
    } catch {
      /* private mode — brief every visit, no harm */
    }
    void fetch(`/api/edit/${token}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: EditView) => {
        setView(data);
        setDrafts(data.suggestions ?? {});
        setSubmitted(data.submittedAt > 0);
        // Resume on the phrase they last had open.
        setIdx(Math.max(0, Math.min(data.phrases.length - 1, data.cursor ?? 0)));
      })
      .catch(() => setFailed(true));
  }, [token]);

  const persist = useCallback(async () => {
    setSaveState("saving");
    try {
      const res = await fetch(`/api/edit/${token}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suggestions: stateRef.current.drafts,
          cursor: stateRef.current.idx,
        }),
      });
      if (!res.ok) throw new Error();
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, [token]);

  const scheduleSave = useCallback(
    (delay = 900) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void persist(), delay);
    },
    [persist]
  );

  const edit = (id: string, original: string, value: string) => {
    setDrafts((prev) => {
      const next = { ...prev };
      if (value.trim() === original.trim() || value.trim().length < 2) delete next[id];
      else next[id] = value;
      return next;
    });
    setSaveState("dirty");
    scheduleSave();
  };

  const goTo = (next: number) => {
    setIdx(next);
    // Position rides along with the next save — a cheap write, so soon.
    scheduleSave(400);
  };

  const submit = async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await persist();
    try {
      const res = await fetch(`/api/edit/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit" }),
      });
      if (res.ok) setSubmitted(true);
    } catch {
      /* the banner just stays un-flipped */
    }
  };

  if (failed) {
    return (
      <div className="booth">
        <h1>Link not found</h1>
        <p>This editing link isn&apos;t valid. Please check with whoever sent it to you.</p>
      </div>
    );
  }
  if (!view) return <div className="booth"><p>Loading…</p></div>;

  // ---- stage 1: who the character is ----
  if (!briefDone) {
    return (
      <div className="booth">
        <h1>Meet {view.personaName}</h1>
        <p className="booth-sub">{view.label}</p>
        <div className="booth-note">
          ✏️ <strong>Your job:</strong> fix Singlish that reads off, awkward phrasing, or
          typos — one phrase per page. Change only what needs changing; a good line left
          alone is a good edit. Everything saves as you go, and if you leave, the same link
          brings you back to the exact phrase you were on.
        </div>
        <p className="booth-sub">
          Every fix has to keep this character&apos;s voice — here&apos;s who they are:
        </p>
        <div className="booth-brief">{view.brief}</div>
        <button
          className="booth-primary"
          onClick={() => {
            try {
              sessionStorage.setItem(BRIEF_KEY(token), "1");
            } catch {
              /* fine */
            }
            setBriefDone(true);
          }}
        >
          Got it — start editing
        </button>
      </div>
    );
  }

  // ---- stage 2: one phrase per page ----
  const total = view.phrases.length;
  const phrase = view.phrases[idx];
  const changed = Object.keys(drafts).length;
  const value = drafts[phrase.id] ?? phrase.text;
  const isChanged = drafts[phrase.id] !== undefined;
  const verdict = view.resolved[phrase.id];

  return (
    <div className="booth">
      <div className="booth-top">
        <span>
          ✏️ {changed} edited · {total - idx - 1} to go
        </span>
        <progress value={idx + 1} max={total} />
        <span className="edit-save-state">
          {saveState === "saved" && "✓ Saved"}
          {saveState === "saving" && "Saving…"}
          {saveState === "dirty" && "…"}
          {saveState === "error" && "⚠ Save failed"}
        </span>
      </div>

      {submitted && (
        <div className="booth-note">
          ✅ Submitted for review — you can keep refining; re-submit when you&apos;re done.
        </div>
      )}

      <div className="booth-nav">
        <button disabled={idx === 0} onClick={() => goTo(idx - 1)}>
          ‹ Prev
        </button>
        <span className="booth-count">
          {idx + 1} / {total}
          {isChanged ? " ✏️" : ""}
        </span>
        <button disabled={idx >= total - 1} onClick={() => goTo(idx + 1)}>
          Next ›
        </button>
      </div>

      <div className="booth-read-title">
        📂 {catLabel(phrase.category)} · <span className="edit-id">{phrase.id}</span>
      </div>
      <div className={`edit-row${isChanged ? " changed" : ""}`}>
        <div className="edit-row-head">
          {isChanged && <span className="edit-tag">edited</span>}
          {verdict === "accepted" && !isChanged && (
            <span className="edit-tag ok">✓ your earlier edit was accepted</span>
          )}
          {verdict === "rejected" && <span className="edit-tag bad">✗ earlier edit not used</span>}
          {isChanged && (
            <button className="booth-mic-change" onClick={() => edit(phrase.id, phrase.text, phrase.text)}>
              revert to original
            </button>
          )}
        </div>
        <textarea
          value={value}
          rows={Math.max(3, Math.ceil(value.length / 55))}
          onChange={(e) => edit(phrase.id, phrase.text, e.target.value)}
        />
      </div>

      {idx >= total - 1 && (
        <div className="booth-note booth-submit">
          🎉 That&apos;s the last phrase. Submit your corrections whenever you&apos;re happy —
          the link keeps working if you want another pass.
          <button className="booth-primary" disabled={saveState === "saving"} onClick={() => void submit()}>
            {submitted ? "✓ Re-submit for review" : "✓ Submit corrections for review"}
          </button>
        </div>
      )}

      <div className="booth-tips">
        Only real changes are saved as suggestions — leaving a phrase untouched is fine.
        Done early?{" "}
        <button className="booth-mic-change" onClick={() => void submit()}>
          submit what you have
        </button>{" "}
        — your progress and position are saved either way.
      </div>
    </div>
  );
}
