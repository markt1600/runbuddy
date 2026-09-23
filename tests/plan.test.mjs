// The subscription → plan mapping the sync route and the webhook both rely
// on: only a live "full" entitlement earns the full plan, and a lapsed one
// CLEARS the pin (null) rather than pinning "free", so a lapsed account
// follows the server default.
import assert from "node:assert";
import { planFromEntitlements, planFromSubscriber } from "../lib/subscription.ts";

const now = Date.parse("2026-09-23T00:00:00Z");
const future = "2026-10-23T00:00:00Z";
const past = "2026-08-23T00:00:00Z";

assert.strictEqual(planFromSubscriber(null, now), null, "unknown subscriber → no pin");
assert.strictEqual(planFromSubscriber({ subscriber: { entitlements: {} } }, now), null);
assert.strictEqual(
  planFromSubscriber({ subscriber: { entitlements: { full: { expires_date: future } } } }, now),
  "full",
  "live entitlement → full"
);
assert.strictEqual(
  planFromSubscriber({ subscriber: { entitlements: { full: { expires_date: past } } } }, now),
  null,
  "lapsed entitlement → pin cleared"
);
assert.strictEqual(
  planFromSubscriber({ subscriber: { entitlements: { full: { expires_date: null } } } }, now),
  "full",
  "lifetime → full"
);
assert.strictEqual(
  planFromSubscriber({ subscriber: { entitlements: { other: { expires_date: future } } } }, now),
  null,
  "a different entitlement earns nothing"
);

// The SDK's shape on the phone: already-decided flags, camel-cased dates.
assert.strictEqual(planFromEntitlements({ full: { isActive: true } }, now), "full");
assert.strictEqual(planFromEntitlements({ full: { isActive: false } }, now), null);
assert.strictEqual(planFromEntitlements({ full: { expirationDate: future } }, now), "full");
assert.strictEqual(planFromEntitlements(undefined, now), null);

console.log("plan: entitlement → plan mapping — passed");
