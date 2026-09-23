import type { Plan } from "./plan";

// The store subscription, as the app and the server both see it. RevenueCat
// sits between us and StoreKit: the iOS shell buys through its plugin, and
// the server asks its REST API who is entitled — one entitlement, "full",
// which the products in App Store Connect are attached to.

/** The RevenueCat entitlement identifier the products grant. */
export const ENTITLEMENT_ID = "full";

/** The RevenueCat offering the Subscribe screen presents (its packages). */
export const OFFERING_ID = "default";

/**
 * Apple's standard EULA covers the subscription terms; the review guidelines
 * accept a link to it in place of your own.
 */
export const TERMS_URL = "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";
export const PRIVACY_PATH = "/privacy";

/** The `entitlements` map of a RevenueCat REST subscriber, or the SDK's `active` map. */
export interface EntitlementLike {
  expires_date?: string | null; // REST: ISO, null for lifetime
  expirationDate?: string | null; // SDK: same, camel-cased
  isActive?: boolean; // SDK: already decided
}

/**
 * The plan a subscriber record earns: "full" while the entitlement is live,
 * otherwise null — CLEAR the pin rather than pin "free", so an account that
 * lapses follows the server default (full until launch, free after).
 */
export function planFromEntitlements(
  entitlements: Record<string, EntitlementLike> | undefined | null,
  now = Date.now()
): Plan | null {
  const e = entitlements?.[ENTITLEMENT_ID];
  if (!e) return null;
  if (e.isActive === true) return "full";
  if (e.isActive === false) return null;
  // A null date is a lifetime entitlement, so it must not collapse into
  // "no date" the way `??` would make it.
  const until = "expires_date" in e ? e.expires_date : e.expirationDate;
  if (until === null) return "full"; // lifetime
  if (until === undefined) return null;
  const t = Date.parse(until);
  return isFinite(t) && t > now ? "full" : null;
}

/** The REST shape: GET /v1/subscribers/{app_user_id}. */
export function planFromSubscriber(
  body: { subscriber?: { entitlements?: Record<string, EntitlementLike> } } | null | undefined,
  now = Date.now()
): Plan | null {
  return planFromEntitlements(body?.subscriber?.entitlements, now);
}
