"use client";

// Bottom navigation, constant on every screen except the live run, which
// keeps its own locked-down controls. Rendered as a plain flex child of the
// app shell below the internal scroller — see .tab-bar in globals.css for
// why it is neither sticky nor fixed.

export type TabId = "home" | "friends" | "setup" | "account";

interface Props {
  /** Undefined on screens that aren't any tab's own (admin, landing, summary). */
  active?: TabId;
  /** Guests have no home — there is no history behind it. */
  showHome: boolean;
  /** Friends needs an account — hidden for guests. */
  showFriends: boolean;
  /** ADMIN_EMAIL gating: only the admin account gets the entry point. */
  showAdmin: boolean;
  /** The big button: starts the run on setup, leads to setup elsewhere. */
  runLabel: string;
  onHome: () => void;
  onFriends: () => void;
  onRun: () => void;
  onAccount: () => void;
  onAdmin: () => void;
}

export default function TabBar({
  active,
  showHome,
  showFriends,
  showAdmin,
  runLabel,
  onHome,
  onFriends,
  onRun,
  onAccount,
  onAdmin,
}: Props) {
  return (
    // Two equal-flex side groups around a pill-sized hole: the hole stays at
    // the exact centre — under the absolutely-centred floating pill — no
    // matter how many tabs each side happens to have.
    <nav className="tab-bar">
      <div className="tab-side">
        {showHome && (
          <button
            className={`tab-item tab-home${active === "home" ? " active" : ""}`}
            onClick={onHome}
          >
            <span className="tab-icon">🏠</span>
            <span className="tab-label">Home</span>
          </button>
        )}
        {showFriends && (
          <button
            className={`tab-item tab-friends${active === "friends" ? " active" : ""}`}
            onClick={onFriends}
          >
            <span className="tab-icon">👥</span>
            <span className="tab-label">Friends</span>
          </button>
        )}
      </div>
      <button className="tab-run" onClick={onRun}>
        {runLabel}
      </button>
      <div className="tab-side">
        <button
          className={`tab-item tab-account${active === "account" ? " active" : ""}`}
          onClick={onAccount}
        >
          <span className="tab-icon">👤</span>
          <span className="tab-label">Account</span>
        </button>
        {showAdmin && (
          <button className="tab-item tab-admin" onClick={onAdmin}>
            <span className="tab-icon">⚙</span>
            <span className="tab-label">Admin</span>
          </button>
        )}
      </div>
    </nav>
  );
}
