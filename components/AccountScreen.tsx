"use client";

import type { AuthUser } from "./HomeScreen";

// Account: who you are, and the one destructive-ish action — signing out —
// kept off the tab bar where a thumb could hit it by accident.

interface Props {
  user: AuthUser | null;
  /** Google sign-in exists on this deployment (guests can upgrade). */
  configured: boolean;
  historyAvailable: boolean;
  onSignOut: () => void;
}

export default function AccountScreen({ user, configured, historyAvailable, onSignOut }: Props) {
  return (
    <div className="fade-in account">
      <h1 className="large-title">Account</h1>

      {user ? (
        <>
          <div className="account-card card">
            {user.picture ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="account-avatar" src={user.picture} alt="" referrerPolicy="no-referrer" />
            ) : (
              <div className="account-avatar account-avatar-fallback">
                {user.name[0]?.toUpperCase() ?? "?"}
              </div>
            )}
            <div>
              <div className="account-name">{user.name}</div>
              {user.email && <div className="account-email">{user.email}</div>}
            </div>
          </div>
          <p className="account-note">
            Your runs save automatically when you finish — distance, pace and every
            kilometre split, listed on your home screen.
            {!historyAvailable &&
              " (Right now the server has no Vercel Blob store connected, so nothing can be stored.)"}
          </p>
          <button className="cta secondary" style={{ marginTop: 18 }} onClick={onSignOut}>
            Sign out
          </button>
        </>
      ) : (
        <>
          <p className="account-note">
            You&apos;re running as a guest. Everything works — runs just aren&apos;t saved
            when you finish.
          </p>
          {configured && (
            <a className="cta" style={{ marginTop: 18, textAlign: "center", textDecoration: "none" }} href="/api/auth/login">
              Continue with Google
            </a>
          )}
        </>
      )}
    </div>
  );
}
