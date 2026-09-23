import { NextResponse, type NextRequest } from "next/server";
import { readSession, uidHash } from "./auth";
import { getProfile } from "./users";
import { isPlan, planAllowsGenerated, type Plan } from "../plan";

// Which plan a request is on, and the one gate the generation routes share.
// The plan is decided HERE, never trusted from the client: the routes that
// spend model and voice credits check it, and the client merely mirrors the
// verdict so it can skip the round trip.

/**
 * The plan for anyone without one pinned on their profile — guests included.
 * "full" until the store subscription ships; flip with DEFAULT_PLAN=free.
 */
export function defaultPlan(): Plan {
  return process.env.DEFAULT_PLAN === "free" ? "free" : "full";
}

/** The request's plan: the profile's pinned plan, else the default. */
export async function planFor(req: NextRequest): Promise<Plan> {
  const user = readSession(req);
  if (!user) return defaultPlan();
  try {
    const profile = await getProfile(uidHash(user.sub));
    return profile?.plan && isPlan(profile.plan) ? profile.plan : defaultPlan();
  } catch {
    return defaultPlan(); // a store hiccup must not lock a paying runner out
  }
}

/**
 * For routes that call the model: null when allowed, else the 402 to
 * return. The client treats any non-200 as "no line" and plays the library,
 * so a free run simply never hears an improvised word.
 */
export async function requireGenerated(req: NextRequest): Promise<NextResponse | null> {
  const plan = await planFor(req);
  if (planAllowsGenerated(plan)) return null;
  return NextResponse.json({ error: "plan", plan, feature: "generated" }, { status: 402 });
}
