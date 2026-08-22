// The one question web code ever asks about the native shell: am I inside it?
// Checked off the injected global rather than importing @capacitor/core, so
// the web bundle carries zero Capacitor weight and the answer is simply false
// in every browser. Native-only behaviour (system-browser sign-in, background
// GPS, AVAudioSession ducking) branches on this and nothing else.

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, unknown>;
  /** Natively-registered plugins, announced by the injected bridge. */
  PluginHeaders?: { name: string }[];
  /** The low-level bridge: one promise-returning native call. */
  nativePromise?: (plugin: string, method: string, options?: unknown) => Promise<unknown>;
  /** Repeating-callback variant — what addListener rides on. */
  nativeCallback?: (
    plugin: string,
    method: string,
    options?: unknown,
    callback?: (data?: unknown) => void
  ) => string;
}

/** The fix events the native location plugin streams (see RunBuddyNative.swift). */
export interface NativeFix {
  latitude: number;
  longitude: number;
  accuracy: number;
  /** m/s; -1 = no Doppler solution (the CLLocation convention) */
  speed: number;
  timestamp: number; // ms epoch
}

/** What Apple Health saw over a run's window — display-only, never stored. */
export interface HealthRunSummary {
  available: boolean;
  workoutCount?: number;
  workout?: {
    activity: string;
    source: string;
    startMs: number;
    endMs: number;
    durationSec: number;
    distanceKm?: number;
    calories?: number;
  };
  heartRate?: { avg?: number; min?: number; max?: number };
  heartRateSamples?: number;
  /** Health's own de-duplicated distance sum over the window. */
  distanceKm?: number;
}

interface RunBuddyNativePlugin {
  configureAudio(): Promise<void>;
  duckStart(): Promise<void>;
  duckEnd(): Promise<void>;
  /**
   * Play one clip through a native AVAudioPlayer — the only playback WebKit
   * cannot pause when the screen locks. Pass raw base64 audio bytes as `data`,
   * or an http(s) `url` the native side fetches itself (no CORS in play).
   * Resolves when the clip finishes.
   */
  play(options: { data?: string; url?: string; volume?: number }): Promise<void>;
  stopPlayback(): Promise<void>;
  keepAliveStart(): Promise<void>;
  keepAliveStop(): Promise<void>;
  startLocation(): Promise<void>;
  stopLocation(): Promise<void>;
  /** Show the Health read-permission sheet (first time only; no-op after). */
  healthAuthorize(): Promise<{ available: boolean }>;
  /** Read-only: what Health recorded during [sinceMs, untilMs]. */
  healthRunSummary(options: { sinceMs: number; untilMs: number }): Promise<HealthRunSummary>;
  addListener(
    name: "location" | "locationError",
    cb: (data: never) => void
  ): Promise<{ remove: () => void }>;
}

const PLUGIN = "RunBuddyNative";
let cached: RunBuddyNativePlugin | null | undefined;

/**
 * The custom plugin registered by the shell's AppViewController. Null in
 * every browser AND in a native build that predates the plugin — callers
 * fall back to the web paths, so an old TestFlight build keeps working.
 *
 * Modern Capacitor does NOT auto-populate Capacitor.Plugins for natively
 * registered plugins — it announces them in PluginHeaders and expects a JS
 * proxy built over the low-level bridge (nativePromise / nativeCallback).
 * That proxy is normally @capacitor/core's registerPlugin; building the
 * same thing by hand here keeps the web bundle free of Capacitor entirely.
 */
export function runBuddyNative(): RunBuddyNativePlugin | null {
  if (cached !== undefined) return cached;
  if (!isNativeApp()) return null; // don't cache: pre-hydration SSR calls
  const cap = (window as { Capacitor?: CapacitorGlobal }).Capacitor;
  const announced =
    cap?.PluginHeaders?.some((h) => h.name === PLUGIN) ||
    (cap?.Plugins && PLUGIN in cap.Plugins);
  if (!announced || !cap?.nativePromise || !cap.nativeCallback) {
    cached = null;
    return null;
  }
  const promise = cap.nativePromise;
  const callback = cap.nativeCallback;
  const call = <T = void>(method: string, options: unknown = {}) =>
    promise(PLUGIN, method, options) as Promise<T>;
  cached = {
    configureAudio: () => call("configureAudio"),
    duckStart: () => call("duckStart"),
    duckEnd: () => call("duckEnd"),
    play: (options) => call("play", options),
    stopPlayback: () => call("stopPlayback"),
    keepAliveStart: () => call("keepAliveStart"),
    keepAliveStop: () => call("keepAliveStop"),
    startLocation: () => call("startLocation"),
    stopLocation: () => call("stopLocation"),
    healthAuthorize: () => call<{ available: boolean }>("healthAuthorize"),
    healthRunSummary: (options) => call<HealthRunSummary>("healthRunSummary", options),
    addListener: (name, cb) => {
      callback(PLUGIN, "addListener", { eventName: name }, (data) =>
        cb(data as never)
      );
      return Promise.resolve({
        // CAPPlugin's built-in removal is all-listeners; the only caller
        // (GeoTracker.stop) drops both of its listeners at once anyway.
        remove: () => void promise(PLUGIN, "removeAllListeners", {}),
      });
    },
  };
  return cached;
}

export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as { Capacitor?: CapacitorGlobal }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

/** What the shell's bridge actually announced — the bring-up diagnostic. */
export function nativeDiagnostics(): string {
  if (typeof window === "undefined") return "ssr";
  const cap = (window as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (!cap?.isNativePlatform?.()) return "shell no";
  const headers = (cap.PluginHeaders ?? []).map((h) => h.name);
  const bridge = `${cap.nativePromise ? "P" : "-"}${cap.nativeCallback ? "C" : "-"}`;
  return `shell yes · bridge ${bridge} · plugins [${headers.join(", ") || "none"}]`;
}

// The Capacitor plugin modules are loaded dynamically and only ever inside
// the shell, so the web bundle's main chunks never carry them and browsers
// never execute them.

/**
 * Native sign-in: open the OAuth flow in the SYSTEM browser (Google refuses
 * WKWebViews). ?native=1 tells the callback to come back via the runbuddy://
 * deep link instead of setting a cookie the WebView can't see.
 */
export async function openNativeLogin(): Promise<void> {
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url: `${window.location.origin}/api/auth/login?native=1` });
}

/**
 * Installed once at app boot inside the shell: catches the runbuddy://auth
 * deep link, closes the in-app browser sheet, and sends the WebView through
 * /api/auth/native-complete to trade the handoff token for the real session
 * cookie. Loading that URL reloads the app signed in — no state to patch up.
 */
export async function initNativeAuthListener(): Promise<void> {
  const { App } = await import("@capacitor/app");
  await App.addListener("appUrlOpen", ({ url }) => {
    let token: string | null = null;
    try {
      token = new URL(url).searchParams.get("token");
    } catch {
      return;
    }
    if (!token || !url.startsWith("runbuddy://auth")) return;
    void import("@capacitor/browser")
      .then(({ Browser }) => Browser.close())
      .catch(() => {});
    window.location.href = `/api/auth/native-complete?token=${encodeURIComponent(token)}`;
  });
}
