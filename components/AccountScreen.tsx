"use client";

import { useEffect, useRef, useState } from "react";
import type { AuthUser } from "./HomeScreen";

// Account: who you are, your body stats (the trainer weaves these into its
// improvised lines), and the one destructive-ish action — signing out — kept
// off the tab bar where a thumb could hit it by accident.

interface Props {
  user: AuthUser | null;
  /** Google sign-in exists on this deployment (guests can upgrade). */
  configured: boolean;
  historyAvailable: boolean;
  onSignOut: () => void;
  /** The saved profile changed — lets the app hand fresh stats to the coach. */
  onProfileSaved?: (p: {
    age: number | null;
    heightCm: number | null;
    weightKg: number | null;
    gender: Gender;
  }) => void;
}

type Units = "metric" | "imperial";
type Gender = "female" | "male" | null;

const CM_PER_IN = 2.54;
const KG_PER_LB = 0.45359237;

// Singapore Heart Foundation BMI bands (myheart.org.sg) — the Asian-population
// cutoffs, stored here verbatim so classification never needs a lookup.
// Ordered by upper bound; matched against the BMI rounded to one decimal, the
// same figure the row displays, so the label never disagrees with the number.
const SG_BMI_BANDS = [
  { max: 18.4, label: "Underweight", note: "risk of nutritional deficiency and osteoporosis" },
  { max: 22.9, label: "Normal", note: "low risk — healthy range" },
  { max: 27.4, label: "Overweight", note: "moderate risk of health complications" },
  { max: Infinity, label: "Obese", note: "high risk of heart disease and diabetes" },
] as const;

const sgBand = (bmi: number) => {
  const r = Math.round(bmi * 10) / 10;
  return SG_BMI_BANDS.find((b) => r <= b.max) ?? SG_BMI_BANDS[SG_BMI_BANDS.length - 1];
};

/** One decimal, no trailing ".0" — what the inputs display. */
const show = (n: number) => {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

export default function AccountScreen({
  user,
  configured,
  historyAvailable,
  onSignOut,
  onProfileSaved,
}: Props) {
  // Inputs are strings so half-typed values survive; canonical metric numbers
  // only exist at load and save time.
  const [units, setUnits] = useState<Units>("metric");
  const [age, setAge] = useState("");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [gender, setGender] = useState<Gender>(null);
  const [loaded, setLoaded] = useState(false);
  const [storage, setStorage] = useState(true);
  const [status, setStatus] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [errorText, setErrorText] = useState("");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void fetch("/api/profile")
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (data: {
          profile: {
            age: number | null;
            heightCm: number | null;
            weightKg: number | null;
            gender: Gender;
            units: Units;
          };
          storage: boolean;
        } | null) => {
          if (cancelled || !data) return;
          const p = data.profile;
          const u = p.units === "imperial" ? "imperial" : "metric";
          setUnits(u);
          setGender(p.gender === "female" || p.gender === "male" ? p.gender : null);
          setAge(p.age !== null ? String(p.age) : "");
          setHeight(
            p.heightCm !== null ? show(u === "imperial" ? p.heightCm / CM_PER_IN : p.heightCm) : ""
          );
          setWeight(
            p.weightKg !== null ? show(u === "imperial" ? p.weightKg / KG_PER_LB : p.weightKg) : ""
          );
          setStorage(data.storage);
          setLoaded(true);
        }
      )
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Derived live from whatever is typed, in whichever unit — never stored,
  // never editable. kg / m² after converting the display values back.
  const bmi = (() => {
    const h = parseFloat(height);
    const w = parseFloat(weight);
    if (!isFinite(h) || !isFinite(w) || h <= 0 || w <= 0) return null;
    const meters = (units === "imperial" ? h * CM_PER_IN : h) / 100;
    const kg = units === "imperial" ? w * KG_PER_LB : w;
    const v = kg / (meters * meters);
    return v >= 5 && v <= 100 ? v : null;
  })();

  /** Flip the display unit, converting whatever is currently typed in place. */
  const switchUnits = (next: Units) => {
    if (next === units) return;
    const h = parseFloat(height);
    const w = parseFloat(weight);
    if (isFinite(h)) setHeight(show(next === "imperial" ? h / CM_PER_IN : h * CM_PER_IN));
    if (isFinite(w)) setWeight(show(next === "imperial" ? w / KG_PER_LB : w * KG_PER_LB));
    setUnits(next);
    markDirty();
  };

  const markDirty = () => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
    setStatus("dirty");
  };

  const save = async () => {
    // Empty box clears the field; anything typed converts back to metric.
    const num = (s: string) => {
      const n = parseFloat(s);
      return isFinite(n) ? n : null;
    };
    const h = num(height);
    const w = num(weight);
    const body = {
      age: num(age),
      heightCm: h !== null ? (units === "imperial" ? h * CM_PER_IN : h) : null,
      weightKg: w !== null ? (units === "imperial" ? w * KG_PER_LB : w) : null,
      gender,
      units,
    };
    setStatus("saving");
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErrorText(data?.error ?? `save failed (${res.status})`);
        setStatus("error");
        return;
      }
      onProfileSaved?.({
        age: body.age,
        heightCm: body.heightCm,
        weightKg: body.weightKg,
        gender: body.gender,
      });
      setStatus("saved");
      savedTimer.current = setTimeout(() => setStatus("idle"), 2500);
    } catch {
      setErrorText("network error — try again");
      setStatus("error");
    }
  };

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

          <div className="section-header">Your stats</div>
          <div className="card profile-card">
            <div className="segmented profile-units" role="group" aria-label="Units">
              <button
                className={units === "metric" ? "active" : ""}
                onClick={() => switchUnits("metric")}
              >
                kg · cm
              </button>
              <button
                className={units === "imperial" ? "active" : ""}
                onClick={() => switchUnits("imperial")}
              >
                lb · in
              </button>
            </div>

            <label className="profile-row">
              <span className="profile-label">Age</span>
              <input
                className="profile-input"
                type="number"
                inputMode="numeric"
                placeholder="—"
                value={age}
                onChange={(e) => {
                  setAge(e.target.value);
                  markDirty();
                }}
              />
              <span className="profile-unit">yrs</span>
            </label>
            <div className="profile-row">
              <span className="profile-label">Gender</span>
              <div className="segmented compact profile-gender" role="group" aria-label="Gender">
                {(
                  [
                    ["female", "Female"],
                    ["male", "Male"],
                    [null, "—"],
                  ] as [Gender, string][]
                ).map(([value, text]) => (
                  <button
                    key={text}
                    className={gender === value ? "active" : ""}
                    onClick={() => {
                      setGender(value);
                      markDirty();
                    }}
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>
            <label className="profile-row">
              <span className="profile-label">Height</span>
              <input
                className="profile-input"
                type="number"
                inputMode="decimal"
                placeholder="—"
                value={height}
                onChange={(e) => {
                  setHeight(e.target.value);
                  markDirty();
                }}
              />
              <span className="profile-unit">{units === "imperial" ? "in" : "cm"}</span>
            </label>
            <label className="profile-row">
              <span className="profile-label">Weight</span>
              <input
                className="profile-input"
                type="number"
                inputMode="decimal"
                placeholder="—"
                value={weight}
                onChange={(e) => {
                  setWeight(e.target.value);
                  markDirty();
                }}
              />
              <span className="profile-unit">{units === "imperial" ? "lb" : "kg"}</span>
            </label>

            <div className="profile-row profile-row-bmi">
              <span className="profile-label">
                BMI <span className="profile-derived">derived</span>
              </span>
              <span className="profile-value">{bmi !== null ? bmi.toFixed(1) : "—"}</span>
              <span className="profile-unit" />
            </div>
            {bmi !== null && (
              <div className="profile-bmi-class">
                <span className="profile-bmi-band">{sgBand(bmi).label}</span>
                <span className="profile-bmi-note"> — {sgBand(bmi).note}</span>
                <div className="profile-bmi-source">
                  SG classification · Singapore Heart Foundation
                </div>
              </div>
            )}

            {status === "error" && <p className="profile-status error">{errorText}</p>}
            {status === "saved" && <p className="profile-status saved">Saved</p>}
            {!storage && loaded && (
              <p className="profile-status error">
                No Vercel Blob store connected — stats can&apos;t be saved right now.
              </p>
            )}
            <button
              className="cta profile-save"
              disabled={status === "saving" || !storage}
              onClick={() => void save()}
            >
              {status === "saving" ? "Saving…" : "Save stats"}
            </button>
            <p className="profile-hint">
              Your trainer sees these and may work them into what they say mid-run.
            </p>
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
