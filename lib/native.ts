// The one question web code ever asks about the native shell: am I inside it?
// Checked off the injected global rather than importing @capacitor/core, so
// the web bundle carries zero Capacitor weight and the answer is simply false
// in every browser. Native-only behaviour (system-browser sign-in, background
// GPS, AVAudioSession ducking) branches on this and nothing else.

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
}

export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as { Capacitor?: CapacitorGlobal }).Capacitor;
  return !!cap?.isNativePlatform?.();
}
