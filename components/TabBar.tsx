"use client";

// Bottom navigation, constant on every screen except the live run, which
// keeps its own locked-down controls. Rendered as a plain flex child of the
// app shell below the internal scroller — see .tab-bar in globals.css for
// why it is neither sticky nor fixed.

export type TabId = "home" | "setup" | "account";

interface Props {
  /** Undefined on screens that aren't any tab's own (admin, landing, summary). */
  active?: TabId;
  /** Guests have no home — there is no history behind it. */
  showHome: boolean;
  /** ADMIN_EMAIL gating: only the admin account gets the entry point. */
  showAdmin: boolean;
  /** The big button: starts the run on setup, leads to setup elsewhere. */
  runLabel: string;
  onHome: () => void;
  onRun: () => void;
  onAccount: () => void;
  onAdmin: () => void;
}

export default function TabBar({
  active,
  showHome,
  showAdmin,
  runLabel,
  onHome,
  onRun,
  onAccount,
  onAdmin,
}: Props) {
  return (
    <nav className="tab-bar">
      {showHome && (
        <button
          className={`tab-item tab-home${active === "home" ? " active" : ""}`}
          onClick={onHome}
        >
          <span className="tab-icon">🏠</span>
          <span className="tab-label">Home</span>
        </button>
      )}
      <button className="tab-run" onClick={onRun}>
        {runLabel}
      </button>
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
    </nav>
  );
}
