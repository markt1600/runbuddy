// The one question web code ever asks about the native shell: am I inside it?
// Checked off the injected global rather than importing @capacitor/core, so
// the web bundle carries zero Capacitor weight and the answer is simply false
// in every browser. Native-only behaviour (system-browser sign-in, background
// GPS, AVAudioSession ducking) branches on this and nothing else.

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, unknown>;
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

interface RunBuddyNativePlugin {
  configureAudio(): Promise<void>;
  duckStart(): Promise<void>;
  duckEnd(): Promise<void>;
  startLocation(): Promise<void>;
  stopLocation(): Promise<void>;
  addListener(
    name: "location" | "locationError",
    cb: (data: never) => void
  ): Promise<{ remove: () => void }>;
}

/**
 * The custom plugin registered by the shell's AppViewController. Null in
 * every browser AND in a native build that predates the plugin — callers
 * fall back to the web paths, so an old TestFlight build keeps working.
 */
export function runBuddyNative(): RunBuddyNativePlugin | null {
  if (!isNativeApp()) return null;
  const cap = (window as { Capacitor?: CapacitorGlobal }).Capacitor;
  return (cap?.Plugins?.RunBuddyNative as RunBuddyNativePlugin | undefined) ?? null;
}

export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as { Capacitor?: CapacitorGlobal }).Capacitor;
  return !!cap?.isNativePlatform?.();
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
