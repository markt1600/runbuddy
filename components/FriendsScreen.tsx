"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatElapsed, formatPace } from "@/lib/geo";
import { PERSONAS } from "@/lib/personas";
import { loadSpeedUnit } from "@/lib/units";
import { drawRunCard } from "@/lib/runCard";
import type { PersonaId, RunStats } from "@/lib/types";
import type { AppNotification } from "@/lib/server/notifications";

// The Friends tab: add people by name, and a feed of every mutual friend's
// runs — their run cards, comments underneath, tap-through to the full
// read-only detail. Friendship only activates when BOTH sides added each
// other; until then the row shows as pending and no runs are visible.

export interface FeedRun {
  id: string;
  startedAt: number;
  distanceKm: number;
  movingSec: number;
  wallSec: number;
  personaId: string;
  friendUid: string;
  friendName: string;
}

interface FriendEntry {
  uid: string;
  name: string;
  city?: string;
  mutual: boolean;
  /** Live presence: they're mid-run right now. */
  running?: boolean;
}

type ShoutSlot = "now" | "start" | "middle" | "end";

/**
 * Send a friend a shoutout: your own recorded voice, or words their trainer
 * (whichever one THEY are running with) will speak — verbatim or embellished.
 * "Now" lands mid-run if they're out running; the rest queue for their next
 * run. A delivery, not a chat.
 */
function ShoutoutComposer({ friend, onSent }: { friend: FriendEntry; onSent: () => void }) {
  const [slot, setSlot] = useState<ShoutSlot>(friend.running ? "now" : "start");
  const [mode, setMode] = useState<"trainer" | "voice">("trainer");
  const [text, setText] = useState("");
  const [embellish, setEmbellish] = useState(true);
  const [recState, setRecState] = useState<"idle" | "recording" | "done">("idle");
  const [audio, setAudio] = useState<{ base64: string; mime: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startRecording = async () => {
    setNote(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Safari records AAC-in-mp4, which the native player decodes; webm is
      // the Chrome fallback for browser testing.
      const mime = MediaRecorder.isTypeSupported?.("audio/mp4") ? "audio/mp4" : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/mp4" });
        const fr = new FileReader();
        fr.onload = () => {
          const dataUrl = String(fr.result);
          setAudio({
            base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
            mime: blob.type || "audio/mp4",
          });
          setRecState("done");
        };
        fr.readAsDataURL(blob);
      };
      recRef.current = rec;
      rec.start();
      setRecState("recording");
      // 20 seconds is a shoutout, not a podcast.
      autoStopRef.current = setTimeout(() => rec.state === "recording" && rec.stop(), 20_000);
    } catch {
      setNote("⚠ Couldn't reach the microphone — check mic permission.");
    }
  };

  const stopRecording = () => {
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    if (recRef.current?.state === "recording") recRef.current.stop();
  };

  const send = async () => {
    setSending(true);
    setNote(null);
    try {
      const body =
        mode === "trainer"
          ? { toUid: friend.uid, slot, kind: "trainer", text: text.trim(), embellish }
          : {
              toUid: friend.uid,
              slot,
              kind: "voice",
              audioBase64: audio?.base64,
              mime: audio?.mime,
            };
      const res = await fetch("/api/friends/shoutout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 409) {
        setNote("⚠ They're not running right now — pick a next-run slot.");
        return;
      }
      if (!res.ok) throw new Error();
      setNote(
        slot === "now"
          ? `✓ On its way — ${friend.name} hears it in the next minute or two`
          : `✓ Queued for ${friend.name}'s next run`
      );
      setText("");
      setAudio(null);
      setRecState("idle");
      onSent();
    } catch {
      setNote("⚠ Couldn't send — try again");
    } finally {
      setSending(false);
    }
  };

  const canSend =
    !sending && (mode === "trainer" ? text.trim().length > 0 : audio !== null);

  return (
    <div className="shout-composer">
      <div className="shout-row">
        {(["now", "start", "middle", "end"] as ShoutSlot[]).map((s) => (
          <button
            key={s}
            className={`shout-pill${slot === s ? " active" : ""}`}
            disabled={s === "now" && !friend.running}
            title={s === "now" && !friend.running ? "They're not mid-run right now" : undefined}
            onClick={() => setSlot(s)}
          >
            {s === "now" ? "Now 🏃" : `Next run · ${s}`}
          </button>
        ))}
      </div>
      <div className="shout-row">
        <button
          className={`shout-pill${mode === "trainer" ? " active" : ""}`}
          onClick={() => setMode("trainer")}
        >
          Their trainer says it
        </button>
        <button
          className={`shout-pill${mode === "voice" ? " active" : ""}`}
          onClick={() => setMode("voice")}
        >
          🎤 My own voice
        </button>
      </div>
      {mode === "trainer" ? (
        <>
          <textarea
            className="shout-text"
            placeholder={`What should ${friend.name}'s trainer tell them?`}
            value={text}
            maxLength={280}
            rows={2}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="shout-row">
            <button
              className={`shout-pill${!embellish ? " active" : ""}`}
              onClick={() => setEmbellish(false)}
            >
              Word for word
            </button>
            <button
              className={`shout-pill${embellish ? " active" : ""}`}
              onClick={() => setEmbellish(true)}
            >
              Let the trainer embellish
            </button>
          </div>
        </>
      ) : (
        <div className="shout-row">
          {recState === "recording" ? (
            <button className="shout-pill recording" onClick={stopRecording}>
              ⏹ Stop (max 20s)
            </button>
          ) : (
            <button className="shout-pill" onClick={() => void startRecording()}>
              {recState === "done" ? "↺ Re-record" : "● Record"}
            </button>
          )}
          {audio && (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <audio controls src={`data:${audio.mime};base64,${audio.base64}`} className="shout-preview" />
          )}
        </div>
      )}
      <div className="shout-row">
        <button className="cta secondary shout-send" disabled={!canSend} onClick={() => void send()}>
          {sending ? "Sending…" : "Send shoutout"}
        </button>
      </div>
      {note && <div className="save-note">{note}</div>}
    </div>
  );
}

interface Comment {
  uid: string;
  name: string;
  text: string;
  at: number;
}

interface Props {
  onOpenRun: (run: FeedRun) => void;
  /** The alert inbox (owned by the app shell, which also polls it). */
  notifications?: AppNotification[];
  onOpenNotification?: (n: AppNotification) => void;
}

/** "2h ago" style stamps for the What's New strip. */
function ago(at: number): string {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

/** One feed entry: the friend's run card, drawn from their real stats. */
function FeedCard({ run, onOpen }: { run: FeedRun; onOpen: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cardUrl, setCardUrl] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/friends/runs/${run.friendUid}/${encodeURIComponent(run.id)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { stats: RunStats } | null) => {
        if (cancelled || !data?.stats) return;
        const persona = PERSONAS[run.personaId as PersonaId] ?? PERSONAS.ahbeng;
        // The friend's own card background, when they've set one — proxied
        // same-origin (mutuality-gated) so the canvas isn't tainted. Drawn
        // without it first so the card is never blank waiting on the photo.
        let bgImg: HTMLImageElement | null = null;
        const draw = () => {
          const canvas = canvasRef.current;
          if (!canvas || cancelled) return;
          drawRunCard(canvas, {
            persona,
            stats: data.stats,
            unit: loadSpeedUnit(),
            comment: persona.positive
              ? "Every step of that was theirs. Respect!"
              : "Not bad lah. Your turn.",
            background: bgImg,
            date: new Date(run.startedAt),
          });
          setCardUrl(canvas.toDataURL("image/png"));
        };
        const bg = new Image();
        bg.onload = () => {
          bgImg = bg;
          draw();
        };
        bg.src = `/api/friends/card-bg/${run.friendUid}`;
        draw();
        if (typeof document !== "undefined" && document.fonts?.status !== "loaded") {
          void document.fonts.ready.then(draw).catch(() => {});
        }
      })
      .catch(() => {});
    void fetch(`/api/friends/runs/${run.friendUid}/${encodeURIComponent(run.id)}/comments`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { comments: Comment[] } | null) => {
        if (!cancelled) setComments(data?.comments ?? []);
      })
      .catch(() => {
        if (!cancelled) setComments([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.friendUid, run.id]);

  const postComment = async () => {
    const text = draft.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      const res = await fetch(
        `/api/friends/runs/${run.friendUid}/${encodeURIComponent(run.id)}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        }
      );
      if (res.ok) {
        const data: { comments: Comment[] } = await res.json();
        setComments(data.comments);
        setDraft("");
      }
    } catch {
      /* offline — the draft stays in the box */
    } finally {
      setPosting(false);
    }
  };

  const pace =
    run.distanceKm > 0 ? formatPace(run.movingSec / run.distanceKm) : null;
  const shown = showAll ? (comments ?? []) : (comments ?? []).slice(-2);

  return (
    <div className="feed-item">
      <div className="feed-head">
        <span className="feed-name">{run.friendName}</span>
        <span className="feed-when">
          {new Date(run.startedAt).toLocaleDateString(undefined, {
            weekday: "short",
            day: "numeric",
            month: "short",
          })}
          {" · "}
          {run.distanceKm > 0
            ? `${run.distanceKm.toFixed(2)} km · ${pace}/km`
            : formatElapsed(run.movingSec * 1000)}
        </span>
      </div>
      <canvas ref={canvasRef} style={{ display: "none" }} />
      {cardUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="run-card-img feed-card-img"
          src={cardUrl}
          alt={`${run.friendName}'s run card`}
          onClick={onOpen}
        />
      ) : (
        <div className="feed-card-loading" onClick={onOpen}>
          Loading run card…
        </div>
      )}
      <div className="feed-comments">
        {comments !== null && comments.length > 2 && !showAll && (
          <button className="feed-more" onClick={() => setShowAll(true)}>
            Show all {comments.length} comments
          </button>
        )}
        {shown.map((c, i) => (
          <div className="feed-comment" key={`${c.at}-${i}`}>
            <span className="feed-comment-name">{c.name}</span> {c.text}
          </div>
        ))}
        <div className="feed-comment-row">
          <input
            className="feed-comment-input"
            placeholder="Say something…"
            value={draft}
            maxLength={400}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void postComment();
            }}
          />
          <button
            className="feed-comment-send"
            disabled={posting || draft.trim() === ""}
            onClick={() => void postComment()}
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FriendsScreen({ onOpenRun, notifications, onOpenNotification }: Props) {
  const [friends, setFriends] = useState<FriendEntry[] | null>(null);
  const [requests, setRequests] = useState<{ uid: string; name: string; city?: string }[]>([]);
  const [feed, setFeed] = useState<FeedRun[] | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ uid: string; name: string; city?: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [composerFor, setComposerFor] = useState<string | null>(null);
  const seq = useRef(0);

  const refresh = useCallback(() => {
    void fetch("/api/friends")
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (data: {
          friends: FriendEntry[];
          requests?: { uid: string; name: string; city?: string }[];
        } | null) => {
          setFriends(data?.friends ?? []);
          setRequests(data?.requests ?? []);
        }
      )
      .catch(() => setFriends([]));
    void fetch("/api/friends/feed")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { items: FeedRun[] } | null) => setFeed(data?.items ?? []))
      .catch(() => setFeed([]));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Debounced name search, same discipline as the home-city autocomplete:
  // a sequence guard so a slow stale response never overwrites a newer one.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      void fetch(`/api/friends/search?q=${encodeURIComponent(q)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { results: { uid: string; name: string; city?: string }[] } | null) => {
          if (seq.current !== mine) return;
          setResults(data?.results ?? []);
          setSearching(false);
        })
        .catch(() => {
          if (seq.current === mine) {
            setResults([]);
            setSearching(false);
          }
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const add = async (uid: string, name: string, confirming = false) => {
    setNote(null);
    try {
      const res = await fetch("/api/friends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid }),
      });
      if (!res.ok) throw new Error();
      setQuery("");
      setResults([]);
      setNote(
        confirming
          ? `✓ You and ${name} are now friends — their runs are in your feed`
          : `✓ Added ${name} — you'll see their runs once they add you back`
      );
      refresh();
    } catch {
      setNote("⚠ Couldn't add — try again");
    }
  };

  const remove = async (uid: string) => {
    try {
      await fetch(`/api/friends?uid=${uid}`, { method: "DELETE" });
      refresh();
    } catch {
      /* refresh next time */
    }
  };

  const addedUids = new Set((friends ?? []).map((f) => f.uid));

  return (
    <div className="fade-in">
      <h1 className="large-title">Friends</h1>
      <p className="subtitle">Their runs, your kaypoh commentary.</p>

      {notifications !== undefined && notifications.length > 0 && (
        <>
          <div className="section-header">What&apos;s new</div>
          <div className="card" style={{ padding: "4px 14px" }}>
            {notifications.slice(0, 8).map((n) => (
              <button
                className="notif-row"
                key={n.id}
                onClick={() => onOpenNotification?.(n)}
              >
                <span className="notif-text">{n.text}</span>
                <span className="notif-when">{ago(n.at)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {requests.length > 0 && (
        <>
          <div className="section-header">
            Friend requests<span className="cat-count">{requests.length}</span>
          </div>
          <div className="card" style={{ padding: "4px 14px" }}>
            {requests.map((r) => (
              <div className="friend-result" key={r.uid}>
                <span className="friend-result-name">{r.name}</span>
                <span className="friend-result-city">{r.city ?? ""}</span>
                <button className="open-pill" onClick={() => void add(r.uid, r.name, true)}>
                  ✓ Confirm
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-header">Add a friend</div>
      <div className="friend-search">
        <input
          className="profile-input friend-search-input"
          placeholder="Search by name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {(results.length > 0 || searching) && (
          <div className="friend-results">
            {searching && results.length === 0 && (
              <div className="friend-result-empty">Searching…</div>
            )}
            {results.map((r) => (
              <div className="friend-result" key={r.uid}>
                <span className="friend-result-name">{r.name}</span>
                <span className="friend-result-city">{r.city ?? ""}</span>
                {addedUids.has(r.uid) ? (
                  <span className="friend-added">Added</span>
                ) : (
                  <button className="open-pill" onClick={() => void add(r.uid, r.name)}>
                    Add
                  </button>
                )}
              </div>
            ))}
            {!searching && results.length === 0 && (
              <div className="friend-result-empty">Nobody by that name yet</div>
            )}
          </div>
        )}
      </div>
      {note && <div className="save-note">{note}</div>}

      {friends !== null && friends.length > 0 && (
        <>
          <div className="section-header">
            Your friends<span className="cat-count">{friends.length}</span>
          </div>
          <div className="card" style={{ padding: "4px 14px" }}>
            {friends.map((f) => (
              <div key={f.uid}>
                <div className="friend-row">
                  <span className="friend-row-name">{f.name}</span>
                  <span className="friend-row-city">{f.city ?? ""}</span>
                  {f.mutual && f.running && (
                    <span className="friend-running">🏃 Running</span>
                  )}
                  <span className={`friend-status${f.mutual ? " mutual" : ""}`}>
                    {f.mutual ? "✓ Friends" : "Pending"}
                  </span>
                  {f.mutual && (
                    <button
                      className="friend-shout"
                      aria-label={`Send ${f.name} a shoutout`}
                      title="Send a shoutout"
                      onClick={() =>
                        setComposerFor(composerFor === f.uid ? null : f.uid)
                      }
                    >
                      📣
                    </button>
                  )}
                  <button
                    className="friend-remove"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => void remove(f.uid)}
                  >
                    ✕
                  </button>
                </div>
                {composerFor === f.uid && (
                  <ShoutoutComposer friend={f} onSent={() => {}} />
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="section-header">Feed</div>
      {feed === null ? (
        <div className="home-empty">Loading…</div>
      ) : feed.length === 0 ? (
        <div className="home-empty">
          {friends === null || friends.length === 0
            ? "Add some friends to see their runs here."
            : friends.some((f) => f.mutual)
              ? "No runs from your friends yet — nag them to lace up."
              : "Waiting for a friend to add you back — then their runs appear here."}
        </div>
      ) : (
        feed.map((run) => (
          <FeedCard key={`${run.friendUid}-${run.id}`} run={run} onOpen={() => onOpenRun(run)} />
        ))
      )}
    </div>
  );
}
