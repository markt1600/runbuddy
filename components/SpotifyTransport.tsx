"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

// The Spotify transport: now-playing plus play/pause/skip, driving the
// runner's own Spotify app through the Web API. Mounted on the setup screen
// (get the music going before the phone goes into the sleeve) and on the run
// screen. It owns its polling; the first answer decides whether to keep
// going — {connected:false} covers guests, no Spotify link, server
// unconfigured — and then the fallback (setup's open-the-app card) renders
// instead, so everyone else sees exactly what they saw before.

interface NowPlayingState {
  connected: boolean;
  playing?: boolean;
  track?: string;
  artist?: string;
}

interface Props {
  /** Each poll's track label, for the run screen to feed the coach. */
  onTrack?: (label: string | null) => void;
  firstPollMs?: number;
  intervalMs?: number;
  /** Rendered while unknown and when Spotify reports not-connected. */
  fallback?: ReactNode;
  /** Render nothing but keep polling (run screen while locked). */
  hidden?: boolean;
  /** Show a small open-the-app link under the transport (setup screen). */
  openLink?: boolean;
}

export default function SpotifyTransport({
  onTrack,
  firstPollMs = 500,
  intervalMs = 60_000,
  fallback = null,
  hidden = false,
  openLink = false,
}: Props) {
  const [now, setNow] = useState<NowPlayingState | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const stoppedRef = useRef(false);
  const onTrackRef = useRef(onTrack);
  onTrackRef.current = onTrack;

  const poll = useCallback(async () => {
    if (stoppedRef.current) return;
    try {
      const res = await fetch("/api/spotify/now-playing");
      if (!res.ok) return;
      const data: NowPlayingState = await res.json();
      setNow(data);
      if (!data.connected) {
        stoppedRef.current = true;
        return;
      }
      onTrackRef.current?.(
        data.playing && data.track
          ? `${data.track}${data.artist ? ` — ${data.artist}` : ""}`
          : null
      );
    } catch {
      /* offline blip — keep the last known answer */
    }
  }, []);

  useEffect(() => {
    stoppedRef.current = false;
    const first = setTimeout(() => void poll(), firstPollMs);
    const timer = setInterval(() => void poll(), intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [poll, firstPollMs, intervalMs]);

  /**
   * The flip is optimistic (the poll 1.5s later is the truth); failures turn
   * into a one-line note saying exactly what to fix.
   */
  const control = async (action: "play" | "pause" | "next" | "previous") => {
    if (action === "play" || action === "pause") {
      setNow((prev) => (prev ? { ...prev, playing: action === "play" } : prev));
    }
    try {
      const res = await fetch("/api/spotify/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data: { ok: boolean; reason?: string } = await res.json();
      if (data.ok) {
        setNote(null);
      } else if (data.reason === "premium") {
        setNote("Spotify only allows playback control on Premium accounts");
      } else if (data.reason === "scope") {
        setNote("Reconnect Spotify on the Account page to enable these controls");
      } else if (data.reason === "noDevice") {
        setNote("Start something in the Spotify app once — then control it from here");
      }
    } catch {
      /* offline blip — the poll below re-syncs the truth */
    }
    setTimeout(() => void poll(), 1_500);
  };

  if (hidden) return null; // stays mounted: polling continues for the coach
  if (!now?.connected) return <>{fallback}</>;

  return (
    <div className="spotify-widget">
      <div className="spotify-track">
        {now.track ? (
          <>
            <span className="spotify-title">{now.track}</span>
            {now.artist && <span className="spotify-artist">{now.artist}</span>}
          </>
        ) : (
          <span className="spotify-artist">Nothing playing</span>
        )}
      </div>
      <div className="spotify-buttons">
        <button
          className="spotify-btn"
          aria-label="Previous track"
          onClick={() => void control("previous")}
        >
          ⏮
        </button>
        <button
          className="spotify-btn main"
          aria-label={now.playing ? "Pause music" : "Play music"}
          onClick={() => void control(now.playing ? "pause" : "play")}
        >
          {now.playing ? "⏸" : "▶"}
        </button>
        <button
          className="spotify-btn"
          aria-label="Next track"
          onClick={() => void control("next")}
        >
          ⏭
        </button>
      </div>
      {note && <div className="spotify-note">{note}</div>}
      {openLink && (
        <a className="spotify-open-link" href="spotify://">
          Open the Spotify app — pick a playlist, control it from here ↗
        </a>
      )}
    </div>
  );
}
