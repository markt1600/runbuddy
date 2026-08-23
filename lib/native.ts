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
  /**
   * Native text-to-speech — the fallback voice. WebKit suspends the page's
   * speechSynthesis while the screen is locked; AVSpeechSynthesizer doesn't.
   */
  speak(options: { text: string; rate?: number; pitch?: number; lang?: string }): Promise<void>;
  stopPlayback(): Promise<void>;
  keepAliveStart(): Promise<void>;
  keepAliveStop(): Promise<void>;
  startLocation(): Promise<void>;
  stopLocation(): Promise<void>;
  /** Add one base64 PNG to the photo library (add-only permission). */
  saveToPhotos(options: { data: string }): Promise<void>;
  /** One buzz. iOS has no web Vibration API, so the shell taps for real. */
  haptic(options: { kind: "tap" | "medium" | "heavy" | "success" | "warning" }): Promise<void>;
  /** Warm the on-disk voice cache with any of these URLs not yet stored. */
  prefetchAudio(options: { urls: string[] }): Promise<{ queued: number }>;
  /** How many of these URLs are already cached on disk. */
  cacheStatus(options: { urls: string[] }): Promise<{ cached: number; total: number }>;
  /** Apple's native sign-in sheet. Rejects when the runner cancels. */
  appleSignIn(): Promise<{ identityToken: string; name?: string; email?: string }>;
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
    speak: (options) => call("speak", options),
    stopPlayback: () => call("stopPlayback"),
    keepAliveStart: () => call("keepAliveStart"),
    keepAliveStop: () => call("keepAliveStop"),
    startLocation: () => call("startLocation"),
    stopLocation: () => call("stopLocation"),
    saveToPhotos: (options) => call("saveToPhotos", options),
    haptic: (options) => call("haptic", options),
    prefetchAudio: (options) => call<{ queued: number }>("prefetchAudio", options),
    cacheStatus: (options) => call<{ cached: number; total: number }>("cacheStatus", options),
    appleSignIn: () =>
      call<{ identityToken: string; name?: string; email?: string }>("appleSignIn"),
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
 * Sign in with Apple, fully native: Face ID sheet → identity token →
 * /api/auth/apple verifies it and sets the session cookie on this very
 * fetch — then a reload arrives signed in. Resolves false when the runner
 * cancels the sheet or anything fails (the landing page just stays put).
 */
/**
 * Link an Apple ID with the signed-in account, inline: native sheet →
 * identity token → /api/auth/link, which merges into whichever side has
 * more runs (the "main" account) and reloads. Resolves the server's error
 * message, or null on success / silent-cancel.
 */
export async function nativeLinkApple(): Promise<string | null> {
  const native = runBuddyNative();
  if (!native) return "native app required";
  let cred: { identityToken: string };
  try {
    cred = await native.appleSignIn();
  } catch {
    return null; // cancelled the sheet — say nothing
  }
  try {
    const res = await fetch("/api/auth/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identityToken: cred.identityToken }),
    });
    if (res.ok) {
      // The merge may have made the OTHER side the main account (and
      // re-issued the session as it) — a reload shows whichever won.
      window.location.href = "/";
      return null;
    }
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    return data?.error ?? "link failed";
  } catch {
    return "network error — try again";
  }
}

/**
 * Link a Google account onto the signed-in (Apple-canonical) account: the
 * OAuth runs in the browser sheet carrying a signed link intent; success
 * returns through the normal auth deep link (reloading signed in, same
 * account), refusal through runbuddy://linked with a reason.
 */
export async function openNativeGoogleLink(): Promise<void> {
  const res = await fetch("/api/auth/link");
  if (!res.ok) return;
  const { url } = (await res.json()) as { url?: string };
  if (!url) return;
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url });
}

export async function nativeAppleLogin(): Promise<boolean> {
  const native = runBuddyNative();
  if (!native) return false;
  try {
    const cred = await native.appleSignIn();
    const res = await fetch("/api/auth/apple", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cred),
    });
    if (!res.ok) return false;
    window.location.href = "/";
    return true;
  } catch {
    return false; // cancelled — not an error worth surfacing
  }
}

/**
 * Native Connect Spotify. Left to itself the WebView's navigation to
 * accounts.spotify.com gets punted to Safari, and the whole flow FINISHES in
 * Safari — stranding the runner on the website. Instead the signed-in WebView
 * asks the server for an authorize URL whose state carries the identity, opens
 * it in the in-app browser sheet, and the callback deep-links back here.
 */
export async function openNativeSpotifyConnect(): Promise<void> {
  const res = await fetch("/api/spotify/native-start");
  if (!res.ok) return;
  const { url } = (await res.json()) as { url?: string };
  if (!url) return;
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url });
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
    let params: URLSearchParams;
    try {
      params = new URL(url).searchParams;
    } catch {
      return;
    }

    // Spotify connect finished in the browser sheet: close it and, on
    // success, tell whoever is showing connect state (the account screen
    // listens) — no navigation, the runner is exactly where they tapped.
    if (url.startsWith("runbuddy://spotify")) {
      void import("@capacitor/browser")
        .then(({ Browser }) => Browser.close())
        .catch(() => {});
      if (params.get("ok") === "1") {
        window.dispatchEvent(new CustomEvent("runbuddy-spotify-connected"));
      }
      return;
    }

    // Account linking REFUSED (a successful link comes back through the
    // normal runbuddy://auth reload instead): close the sheet and hand the
    // reason to the account screen.
    if (url.startsWith("runbuddy://linked")) {
      void import("@capacitor/browser")
        .then(({ Browser }) => Browser.close())
        .catch(() => {});
      window.dispatchEvent(
        new CustomEvent("runbuddy-link-failed", {
          detail: { reason: params.get("reason") ?? "link failed" },
        })
      );
      return;
    }

    const token = params.get("token");
    if (!token || !url.startsWith("runbuddy://auth")) return;
    void import("@capacitor/browser")
      .then(({ Browser }) => Browser.close())
      .catch(() => {});
    window.location.href = `/api/auth/native-complete?token=${encodeURIComponent(token)}`;
  });
}
