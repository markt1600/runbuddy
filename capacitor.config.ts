import type { CapacitorConfig } from "@capacitor/cli";

// The native shell is a thin client of the deployed web app: remote mode
// loads run.marktan.ai directly, so the app updates with every Vercel deploy
// and the API routes never move. webDir is required by the CLI but unused at
// runtime in remote mode — it points at a stub so `cap sync` has something
// to copy.
const config: CapacitorConfig = {
  appId: "ai.marktan.runbuddy",
  appName: "Run Buddy",
  webDir: "public",
  server: {
    url: "https://run.marktan.ai",
  },
  ios: {
    // Match the PWA: no bounce past the app shell's own scrolling.
    contentInset: "never",
  },
};

export default config;
