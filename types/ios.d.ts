// Safari-only / non-standard APIs the app relies on at runtime.

type AudioSessionType =
  | "auto"
  | "playback"
  | "transient"
  | "transient-solo"
  | "ambient"
  | "play-and-record";

interface AudioSession {
  type: AudioSessionType;
}

interface Navigator {
  audioSession?: AudioSession;
}
