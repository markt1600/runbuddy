"use client";

import { useEffect, useState } from "react";
import { isNativeApp } from "@/lib/native";
import type { Plan } from "@/lib/plan";
import { PRIVACY_PATH, TERMS_URL } from "@/lib/subscription";
import {
  buyPackage,
  configurePurchases,
  loadPackages,
  purchasesAvailable,
  restorePurchases,
  type OfferedPackage,
  type PurchaseOutcome,
} from "@/lib/purchases";

// The Subscribe screen: what the full plan adds, the store's own prices,
// a buy button per term, Restore purchases, and the two links review looks
// for. On the web it only explains — subscriptions are bought in the iPhone
// app, and the web runs whatever plan the account already has.

interface Props {
  plan: Plan;
  /** The signed-in account's uid hash — RevenueCat's app user id. Null for guests. */
  uid: string | null;
  /** After a purchase or restore: ask the server to re-read the store and report back. */
  onSync: () => Promise<Plan>;
  onBack: () => void;
}

const FULL_GETS = [
  "Improvised lines all run long — colour on every kilometre, fresh encouragement, anecdotes",
  "The personal touches: your name, your age and build, your history and records, the weather where you are",
  "Duo banter — Ah Beng and Ah Lian actually arguing about your run",
  "Talk to your trainer mid-run and get a real reply",
  "A closing comment on your run card, and cheers from friends in the trainer's own words",
];

function periodLabel(period: string | null): string {
  if (!period) return "";
  if (/^P1M$/i.test(period)) return "per month";
  if (/^P1Y$/i.test(period)) return "per year";
  if (/^P1W$/i.test(period)) return "per week";
  const m = period.match(/^P(\d+)([MWY])$/i);
  if (m) return `per ${m[1]} ${{ M: "months", W: "weeks", Y: "years" }[m[2].toUpperCase()]}`;
  return "";
}

export default function SubscribeScreen({ plan, uid, onSync, onBack }: Props) {
  const native = isNativeApp();
  const available = purchasesAvailable() && !!uid;
  const [packages, setPackages] = useState<OfferedPackage[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // package id or "restore"
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!available || !uid) return;
    let cancelled = false;
    void (async () => {
      try {
        await configurePurchases(uid);
        const pkgs = await loadPackages();
        if (!cancelled) setPackages(pkgs);
      } catch {
        if (!cancelled) {
          setPackages([]);
          setNote("Couldn't reach the App Store right now — try again in a moment.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [available, uid]);

  const finish = async (outcome: PurchaseOutcome, verb: "Subscribed" | "Restored") => {
    if (outcome.state === "cancelled") return;
    if (outcome.state === "failed") {
      setNote(`⚠ ${outcome.message}`);
      return;
    }
    if (outcome.state === "not-entitled") {
      setNote(
        verb === "Restored"
          ? "No active subscription found for this Apple ID."
          : "The purchase didn't go through — nothing was charged."
      );
      return;
    }
    // The store says yes; the server's re-read is what actually switches the plan.
    try {
      const next = await onSync();
      setNote(
        next === "full"
          ? `✓ ${verb} — you're on the full plan`
          : "✓ Purchase recorded — the plan will switch in a moment"
      );
    } catch {
      setNote("✓ Purchase recorded — the plan will switch once the server catches up");
    }
  };

  const buy = async (pkg: OfferedPackage) => {
    setBusy(pkg.id);
    setNote(null);
    try {
      await finish(await buyPackage(pkg.id), "Subscribed");
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    setBusy("restore");
    setNote(null);
    try {
      await finish(await restorePurchases(), "Restored");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fade-in subscribe">
      <button className="back-link" onClick={onBack}>
        ‹ Account
      </button>
      <h1 className="setup-title">Tekan Buddy Full</h1>
      <p className="setup-sub">
        {plan === "full"
          ? "You're on the full plan."
          : "The free plan plays every recorded line. Full lets your trainer improvise."}
      </p>

      <div className="card sub-card">
        <div className="sub-card-head">What Full adds</div>
        <ul className="sub-list">
          {FULL_GETS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div className="sub-note">
          Free keeps everything recorded: the start, every kilometre and its split,
          checkpoints and the target, pause and resume, the record moments, duo mode&apos;s
          scripted reactions, cheers word for word, the run card, friends.
        </div>
      </div>

      {!native ? (
        <div className="card sub-card">
          <div className="sub-note">
            Subscriptions are bought in the Tekan Buddy iPhone app. The web app runs whatever
            plan your account has.
          </div>
        </div>
      ) : !uid ? (
        <div className="card sub-card">
          <div className="sub-note">Sign in first — the subscription belongs to your account.</div>
        </div>
      ) : !available ? (
        <div className="card sub-card">
          <div className="sub-note">Subscriptions aren&apos;t switched on for this build yet.</div>
        </div>
      ) : (
        <>
          {packages === null ? (
            <div className="home-empty">Loading prices from the App Store…</div>
          ) : packages.length === 0 ? (
            <div className="home-empty">No subscription is on offer right now.</div>
          ) : (
            <div className="sub-packages">
              {packages.map((pkg) => (
                <button
                  key={pkg.id}
                  className="cta sub-buy"
                  disabled={busy !== null || plan === "full"}
                  onClick={() => void buy(pkg)}
                >
                  <span className="sub-buy-title">{pkg.title}</span>
                  <span className="sub-buy-price">
                    {busy === pkg.id ? "Opening the App Store…" : `${pkg.priceString} ${periodLabel(pkg.period)}`}
                  </span>
                </button>
              ))}
            </div>
          )}
          <button className="cta secondary" disabled={busy !== null} onClick={() => void restore()}>
            {busy === "restore" ? "Checking…" : "Restore purchases"}
          </button>
          <div className="sub-legal">
            Payment is charged to your Apple ID at confirmation. The subscription renews
            automatically unless cancelled at least 24 hours before the end of the current
            period; manage or cancel it in your Apple ID settings.
          </div>
        </>
      )}

      {note && <div className="save-note">{note}</div>}

      <div className="sub-links">
        <a href={TERMS_URL} target="_blank" rel="noreferrer">
          Terms of Use
        </a>
        <a href={PRIVACY_PATH} target="_blank" rel="noreferrer">
          Privacy Policy
        </a>
      </div>
    </div>
  );
}
