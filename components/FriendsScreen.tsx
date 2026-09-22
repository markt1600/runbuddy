"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatElapsed, formatPace } from "@/lib/geo";
import { PERSONAS } from "@/lib/personas";
import type { PersonaId, RunStats } from "@/lib/types";
import type { AppNotification } from "@/lib/server/notifications";

// The Friends tab: one feed, newest first, of everything your friends did —
// their runs, what they said about yours, the cheers of yours that played in
// their runs, who added you back. A cheer composer sits on top and says who
// is out running right now; requests wear a badge in the header; adding
// someone is a button, not a permanent search box. Friendship only activates
// when BOTH sides added each other; until then the row reads as pending and
// no runs are visible.

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
  /** The whole alert inbox (owned by the app shell, which also polls it). */
  notifications?: AppNotification[];
  /** Alerts newer than this arrived since the previous visit: marked as new. */
  newSince?: number;
  onOpenNotification?: (n: AppNotification) => void;
}

/** "12 min" / "3 h" / "Yesterday" / "Sat" / "12 Sep" — the feed's stamps. */
function when(at: number): string {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h`;
  const d = new Date(at);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.floor((today.getTime() - d.getTime()) / 86_400_000) + 1;
  if (days <= 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** A steady colour per person, from the design's palette. */
const AVATAR_COLOURS = ["#3f7d3f", "#2f5d8c", "#b06a15", "#7b4fa0", "#a8391e", "#5a5142"];

function Avatar({ name, isNew }: { name: string; isNew?: boolean }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const colour = AVATAR_COLOURS[h % AVATAR_COLOURS.length];
  return (
    <span className="fe-avatar" style={{ background: colour }} aria-hidden>
      {name.trim().charAt(0).toUpperCase() || "•"}
      {isNew && <span className="fe-new" />}
    </span>
  );
}

/**
 * The server writes each alert as one display line, emoji first. Split it
 * into the feed's shape — a head with the person's name in bold, a quieter
 * second line — without the server learning a new format.
 */
function splitNotification(n: AppNotification): {
  head: React.ReactNode;
  sub: string | null;
  quote: boolean;
} {
  const text = n.text.replace(/^[^\p{L}\p{N}]+\s*/u, ""); // drop the leading emoji
  // A comment quotes the words: "Mel commented on your run: “…”".
  const quoted = text.match(/^(.*?):\s*[“"](.*)[”"]\s*$/s);
  let head = text;
  let sub: string | null = null;
  let quote = false;
  if (quoted) {
    head = quoted[1];
    sub = quoted[2];
    quote = true;
  } else {
    const dash = text.indexOf(" — ");
    if (dash > 0) {
      head = text.slice(0, dash);
      sub = text.slice(dash + 3);
    }
  }
  // "Played at 07:42 in Mel's run" leads with the moment; everything else
  // leads with the person.
  const played = head.match(/^(Played(?: at [^ ]+(?: [AaPp][Mm])?)?)(.*)$/);
  let node: React.ReactNode = head;
  if (played) {
    node = (
      <>
        <strong>{played[1]}</strong>
        {played[2]}
      </>
    );
  } else if (n.fromName && head.startsWith(n.fromName)) {
    node = (
      <>
        <strong>{n.fromName}</strong>
        {head.slice(n.fromName.length)}
      </>
    );
  } else if (n.fromName && head.startsWith(`You and ${n.fromName}`)) {
    node = (
      <>
        You and <strong>{n.fromName}</strong>
        {head.slice(`You and ${n.fromName}`.length)}
      </>
    );
  }
  return { head: node, sub, quote };
}

/** A friend's run in the feed: the head line, a compact strip, comments. */
function RunEntry({
  run,
  isNew,
  onOpen,
  onCheer,
}: {
  run: FeedRun;
  isNew: boolean;
  onOpen: () => void;
  onCheer: () => void;
}) {
  const [stats, setStats] = useState<RunStats | null>(null);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    // The strip's second line wants where it was and whether it was a duo —
    // both live in the full stats, one small fetch per run.
    void fetch(`/api/friends/runs/${run.friendUid}/${encodeURIComponent(run.id)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { stats: RunStats } | null) => {
        if (!cancelled && data?.stats) setStats(data.stats);
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
  }, [run.friendUid, run.id]);

  useEffect(() => {
    if (commenting) inputRef.current?.focus();
  }, [commenting]);

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

  const persona = PERSONAS[run.personaId as PersonaId] ?? PERSONAS.ahbeng;
  const duo = stats?.duoWith ? PERSONAS[stats.duoWith] : null;
  const treadmill = run.distanceKm <= 0;
  const pace = !treadmill ? formatPace(run.movingSec / run.distanceKm) : null;
  const trainers = duo ? `${persona.shortName} & ${duo.shortName}` : persona.shortName;
  const place = stats?.locality ?? stats?.city ?? null;
  const shown = showAll ? (comments ?? []) : (comments ?? []).slice(-2);

  return (
    <div className="fe">
      <Avatar name={run.friendName} isNew={isNew} />
      <div className="fe-body">
        <div className="fe-head">
          <span className="fe-text">
            <strong>{run.friendName}</strong>{" "}
            {treadmill
              ? `ran ${formatElapsed(run.movingSec * 1000)} on the treadmill`
              : `ran ${run.distanceKm.toFixed(1)} km`}
          </span>
          <span className="fe-when">{when(run.startedAt)}</span>
        </div>
        <button className="fe-strip" onClick={onOpen} aria-label={`Open ${run.friendName}'s run`}>
          <span className="fe-strip-km">
            {treadmill ? formatElapsed(run.movingSec * 1000) : run.distanceKm.toFixed(2)}
          </span>
          <span className="fe-strip-meta">
            <span>
              {treadmill
                ? "Treadmill, by the clock"
                : `${formatElapsed(run.movingSec * 1000)} · ${pace} per km`}
            </span>
            <span>
              {trainers}
              {place ? ` · ${place}` : ""}
            </span>
          </span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="fe-strip-chev">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
        {shown.length > 0 && (
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
          </div>
        )}
        {commenting ? (
          <div className="feed-comment-row">
            <input
              ref={inputRef}
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
              aria-label="Post comment"
            >
              ➤
            </button>
          </div>
        ) : (
          <div className="fe-links">
            <button className="fe-link" onClick={() => setCommenting(true)}>
              Comment
            </button>
            <button className="fe-link" onClick={onCheer}>
              Cheer next run
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Anything that isn't a run: a cheer that played, a comment, a new friend. */
function NoteEntry({
  n,
  isNew,
  onOpen,
}: {
  n: AppNotification;
  isNew: boolean;
  onOpen?: () => void;
}) {
  const { head, sub, quote } = splitNotification(n);
  const body = (
    <>
      <div className="fe-head">
        <span className="fe-text">{head}</span>
        <span className="fe-when">{when(n.at)}</span>
      </div>
      {sub && <span className={`fe-sub${quote ? " quote" : ""}`}>{quote ? `“${sub}”` : sub}</span>}
    </>
  );
  return (
    <div className="fe">
      <Avatar name={n.fromName ?? "•"} isNew={isNew} />
      {onOpen ? (
        <button className="fe-body fe-open" onClick={onOpen}>
          {body}
        </button>
      ) : (
        <div className="fe-body">{body}</div>
      )}
    </div>
  );
}

type Entry =
  | { kind: "run"; at: number; key: string; run: FeedRun }
  | { kind: "note"; at: number; key: string; n: AppNotification };

export default function FriendsScreen({
  onOpenRun,
  notifications,
  newSince = 0,
  onOpenNotification,
}: Props) {
  const [friends, setFriends] = useState<FriendEntry[] | null>(null);
  const [requests, setRequests] = useState<{ uid: string; name: string; city?: string }[]>([]);
  const [feed, setFeed] = useState<FeedRun[] | null>(null);
  const [showRequests, setShowRequests] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ uid: string; name: string; city?: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** The cheer composer: open, and for whom. */
  const [cheerOpen, setCheerOpen] = useState(false);
  const [cheerFor, setCheerFor] = useState<string | null>(null);
  const cheerRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
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

  useEffect(() => {
    if (showAdd) searchRef.current?.focus();
  }, [showAdd]);

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

  /** "Cheer next run" on a feed entry opens the composer up top, for them. */
  const cheer = (uid: string) => {
    setCheerFor(uid);
    setCheerOpen(true);
    cheerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const addedUids = new Set((friends ?? []).map((f) => f.uid));
  const mutuals = (friends ?? []).filter((f) => f.mutual);
  const runningFriend = mutuals.find((f) => f.running) ?? null;
  const cheerTarget = mutuals.find((f) => f.uid === cheerFor) ?? null;

  // One list, newest first. Run alerts are skipped: the run itself is here.
  // The same alert text twice (a glitch-era double-fire, or two adds
  // racing) reads as noise — keep the newest of each.
  const entries: Entry[] = [
    ...(feed ?? []).map<Entry>((run) => ({
      kind: "run",
      at: run.startedAt,
      key: `run-${run.friendUid}-${run.id}`,
      run,
    })),
    ...(notifications ?? [])
      .filter((n) => n.type !== "run")
      .filter((n, i, arr) => arr.findIndex((m) => m.text === n.text) === i)
      .map<Entry>((n) => ({ kind: "note", at: n.at, key: `note-${n.id}`, n })),
  ].sort((a, b) => b.at - a.at);
  const loading = feed === null || friends === null;

  return (
    <div className="fade-in friends">
      <div className="fr-head">
        <h1 className="fr-title">Friends</h1>
        <div className="fr-head-btns">
          {requests.length > 0 && (
            <button
              className={`fr-pill${showRequests ? " on" : ""}`}
              aria-expanded={showRequests}
              onClick={() => setShowRequests((s) => !s)}
            >
              Requests
              <span className="fr-badge">{requests.length}</span>
            </button>
          )}
          <button
            className={`fr-pill${showAdd ? " on" : ""}`}
            aria-expanded={showAdd}
            onClick={() => setShowAdd((s) => !s)}
          >
            {showAdd ? "Done" : "+ Add"}
          </button>
        </div>
      </div>

      {showRequests && requests.length > 0 && (
        <div className="card fr-block">
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
      )}

      {showAdd && (
        <div className="friend-search fr-block">
          <input
            ref={searchRef}
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
      )}
      {note && <div className="save-note">{note}</div>}

      {/* The cheer composer: who's out right now, then whom to cheer. */}
      {mutuals.length > 0 && (
        <div className="cheer-strip" ref={cheerRef}>
          <button
            className="cheer-open"
            aria-expanded={cheerOpen}
            onClick={() => setCheerOpen((o) => !o)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" />
              <path d="M19 12a7 7 0 0 1-14 0" />
              <path d="M12 19v3" />
            </svg>
            <span className="cheer-prompt">
              {cheerTarget ? `Cheer for ${cheerTarget.name}` : "Send a cheer to someone…"}
            </span>
            {runningFriend && (
              <span className="cheer-live">
                <span className="cheer-dot" />
                {runningFriend.name} is running
              </span>
            )}
          </button>
          {cheerOpen && (
            <div className="cheer-body">
              <div className="shout-row">
                {mutuals.map((f) => (
                  <button
                    key={f.uid}
                    className={`shout-pill${cheerFor === f.uid ? " active" : ""}`}
                    onClick={() => setCheerFor(f.uid)}
                  >
                    {f.name}
                    {f.running ? " 🏃" : ""}
                  </button>
                ))}
              </div>
              {cheerTarget ? (
                <ShoutoutComposer
                  key={cheerTarget.uid}
                  friend={cheerTarget}
                  onSent={() => setCheerOpen(false)}
                />
              ) : (
                <div className="cheer-hint">Pick a friend to cheer.</div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="feed">
        {loading && entries.length === 0 ? (
          <div className="home-empty">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="home-empty">
            {friends === null || friends.length === 0
              ? "Add some friends to see their runs here."
              : friends.some((f) => f.mutual)
                ? "No runs from your friends yet — nag them to lace up."
                : "Waiting for a friend to add you back — then their runs appear here."}
          </div>
        ) : (
          entries.map((e) =>
            e.kind === "run" ? (
              <RunEntry
                key={e.key}
                run={e.run}
                isNew={e.at > newSince}
                onOpen={() => onOpenRun(e.run)}
                onCheer={() => cheer(e.run.friendUid)}
              />
            ) : (
              <NoteEntry
                key={e.key}
                n={e.n}
                isNew={e.at > newSince}
                onOpen={
                  onOpenNotification && (e.n.type === "comment" || e.n.type === "run")
                    ? () => onOpenNotification(e.n)
                    : undefined
                }
              />
            )
          )
        )}
      </div>

      {friends !== null && friends.length > 0 && (
        <>
          <div className="section-header">
            Your friends<span className="cat-count">{friends.length}</span>
          </div>
          <div className="card" style={{ padding: "4px 14px" }}>
            {friends.map((f) => (
              <div className="friend-row" key={f.uid}>
                <span className="friend-row-name">{f.name}</span>
                <span className="friend-row-city">{f.city ?? ""}</span>
                {f.mutual && f.running && <span className="friend-running">🏃 Running</span>}
                <span className={`friend-status${f.mutual ? " mutual" : ""}`}>
                  {f.mutual ? "✓ Friends" : "Pending"}
                </span>
                <button
                  className="friend-remove"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => void remove(f.uid)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
