"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";

// The phrase-editing suite: every phrase for one persona in a text box,
// corrections saved automatically as you type. No licence, no microphone —
// the job is fixing AI-generated Singlish that's slightly off. Suggestions
// go to review; nothing changes in the app until each one is accepted.

interface EditView {
  personaName: string;
  label: string;
  phrases: { id: string; category: string; text: string }[];
  suggestions: Record<string, string>;
  resolved: Record<string, "accepted" | "rejected">;
  submittedAt: number;
}

const catLabel = (c: string) =>
  c.replace(/_/g, " ").replace(/^./, (ch) => ch.toUpperCase());

export default function EditPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [view, setView] = useState<EditView | null>(null);
  const [failed, setFailed] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty" | "error">("saved");
  const [submitted, setSubmitted] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  useEffect(() => {
    void fetch(`/api/edit/${token}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: EditView) => {
        setView(data);
        setDrafts(data.suggestions ?? {});
        setSubmitted(data.submittedAt > 0);
      })
      .catch(() => setFailed(true));
  }, [token]);

  const persist = useCallback(async () => {
    setSaveState("saving");
    try {
      const res = await fetch(`/api/edit/${token}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestions: draftsRef.current }),
      });
      if (!res.ok) throw new Error();
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, [token]);

  const edit = (id: string, original: string, value: string) => {
    setDrafts((prev) => {
      const next = { ...prev };
      if (value.trim() === original.trim() || value.trim().length < 2) delete next[id];
      else next[id] = value;
      return next;
    });
    setSaveState("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persist(), 900);
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

  const changed = Object.keys(drafts).length;
  const byCategory = new Map<string, EditView["phrases"]>();
  for (const p of view.phrases) {
    byCategory.set(p.category, [...(byCategory.get(p.category) ?? []), p]);
  }

  return (
    <div className="booth booth-wide">
      <h1>Phrase editing: {view.personaName}</h1>
      <p className="booth-sub">
        {view.label} — fix anything that reads off: wrong Singlish, awkward phrasing, typos.
        Leave good lines alone. Changes save automatically and go to review; nothing goes
        live until each edit is approved.
      </p>

      <div className="edit-topbar">
        <span>
          ✏️ {changed} of {view.phrases.length} phrases changed
        </span>
        <progress value={changed} max={view.phrases.length} />
        <span className="edit-save-state">
          {saveState === "saved" && "✓ Saved"}
          {saveState === "saving" && "Saving…"}
          {saveState === "dirty" && "…"}
          {saveState === "error" && "⚠ Save failed — keep this tab open and retry"}
        </span>
      </div>

      {submitted && (
        <div className="booth-note">
          ✅ Submitted for review{changed > 0 ? " — you can still refine edits; re-submit when done." : "."}
        </div>
      )}

      {[...byCategory.entries()].map(([cat, phrases]) => (
        <div key={cat}>
          <div className="booth-read-title">
            {catLabel(cat)} · {phrases.filter((p) => drafts[p.id]).length}/{phrases.length} edited
          </div>
          {phrases.map((p) => {
            const value = drafts[p.id] ?? p.text;
            const isChanged = drafts[p.id] !== undefined;
            const verdict = view.resolved[p.id];
            return (
              <div key={p.id} className={`edit-row${isChanged ? " changed" : ""}`}>
                <div className="edit-row-head">
                  <span className="edit-id">{p.id}</span>
                  {isChanged && <span className="edit-tag">edited</span>}
                  {verdict === "accepted" && !isChanged && <span className="edit-tag ok">✓ accepted</span>}
                  {verdict === "rejected" && <span className="edit-tag bad">✗ not used</span>}
                  {isChanged && (
                    <button className="booth-mic-change" onClick={() => edit(p.id, p.text, p.text)}>
                      revert
                    </button>
                  )}
                </div>
                <textarea
                  value={value}
                  rows={Math.max(2, Math.ceil(value.length / 70))}
                  onChange={(e) => edit(p.id, p.text, e.target.value)}
                />
              </div>
            );
          })}
        </div>
      ))}

      <div className="booth-note booth-submit">
        Done for now? Submitting tells us to start reviewing — your link keeps working if
        you want to come back for more.
        <button className="booth-primary" disabled={saveState === "saving"} onClick={() => void submit()}>
          {submitted ? "✓ Re-submit for review" : "✓ Submit corrections for review"}
        </button>
      </div>
    </div>
  );
}
