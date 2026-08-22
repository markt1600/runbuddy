"use client";

import { isNativeApp, openNativeLogin } from "@/lib/native";

// First-open choice when Google sign-in is configured: an account keeps your
// run history; guest goes straight to the setup screen, exactly as the app
// behaved before accounts existed. The choice is remembered either way.

interface Props {
  onGuest: () => void;
}

export default function LandingScreen({ onGuest }: Props) {
  return (
    <div className="fade-in landing">
      <div className="landing-hero">
        <div className="landing-emoji">🏃</div>
        <h1 className="large-title">Run Buddy</h1>
        <p className="subtitle">Pick your trainer. Press start. Get talked at.</p>
      </div>

      <div className="landing-actions">
        <a
          className="cta"
          href="/api/auth/login"
          onClick={(e) => {
            // Inside the shell, OAuth must happen in the system browser —
            // Google refuses WKWebViews. Browsers take the plain link.
            if (isNativeApp()) {
              e.preventDefault();
              void openNativeLogin();
            }
          }}
        >
          Continue with Google
        </a>
        <button className="cta secondary" onClick={onGuest}>
          Run as guest
        </button>
        <p className="landing-note">
          Signing in keeps a history of your runs — distance, pace and splits for
          every outing. Guest runs work exactly the same, they just aren&apos;t saved.
        </p>
      </div>
    </div>
  );
}
