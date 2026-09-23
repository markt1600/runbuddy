import { planFromSubscriber } from "../subscription";
import type { Plan } from "../plan";
import { setPlan } from "./users";

// RevenueCat's REST API is the one source of truth for who is subscribed:
// both the purchase sync (the app just bought or restored) and the webhook
// (a renewal, lapse or refund happened while the app was closed) re-read
// the subscriber here and pin the plan from that, never from what the
// client or the webhook body claims.

const API = "https://api.revenuecat.com/v1";

export function revenuecatConfigured(): boolean {
  return !!process.env.REVENUECAT_SECRET_KEY;
}

/** The subscriber record, or null when RevenueCat has never seen this id. */
export async function fetchSubscriber(appUserId: string): Promise<unknown | null> {
  const key = process.env.REVENUECAT_SECRET_KEY;
  if (!key) throw new Error("REVENUECAT_SECRET_KEY not set");
  const res = await fetch(`${API}/subscribers/${encodeURIComponent(appUserId)}`, {
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`RevenueCat ${res.status}`);
  return res.json();
}

/**
 * Re-read the store's verdict for this account and pin it: "full" while
 * entitled, otherwise the pin is cleared so the server default applies.
 * Returns what was pinned.
 */
export async function syncPlanFromStore(uid: string): Promise<Plan | null> {
  const subscriber = await fetchSubscriber(uid);
  const plan = planFromSubscriber(
    subscriber as Parameters<typeof planFromSubscriber>[0]
  );
  await setPlan(uid, plan);
  return plan;
}
