"use client";

import { isNativeApp } from "./native";
import { ENTITLEMENT_ID, OFFERING_ID, planFromEntitlements } from "./subscription";
import type { Plan } from "./plan";

// The iOS shell's side of the subscription: RevenueCat's Capacitor plugin,
// loaded only on the phone (the web bundle never pulls it in) and only once
// the public iOS SDK key is set. Everything here returns what the STORE says
// about the entitlement; the app then asks the server to sync, and the
// server's answer is the plan that counts.

const IOS_KEY = process.env.NEXT_PUBLIC_REVENUECAT_IOS_KEY ?? "";

/** Purchases exist here: the native shell with the SDK key configured. */
export function purchasesAvailable(): boolean {
  return isNativeApp() && IOS_KEY.length > 0;
}

type Plugin = typeof import("@revenuecat/purchases-capacitor").Purchases;
let plugin: Plugin | null = null;
let configuredFor: string | null = null;

async function load(): Promise<Plugin> {
  if (!plugin) {
    const mod = await import("@revenuecat/purchases-capacitor");
    plugin = mod.Purchases;
  }
  return plugin;
}

/**
 * Configure once per account: the app user id is our uid hash, so the
 * webhook and the sync route can find the profile the purchase belongs to.
 */
export async function configurePurchases(uid: string): Promise<void> {
  if (!purchasesAvailable()) return;
  const p = await load();
  if (configuredFor === uid) return;
  await p.configure({ apiKey: IOS_KEY, appUserID: uid });
  configuredFor = uid;
}

export interface OfferedPackage {
  id: string; // the RevenueCat package identifier ($rc_monthly, $rc_annual…)
  title: string;
  description: string;
  priceString: string;
  /** "P1M" / "P1Y" style, when the store reports one. */
  period: string | null;
}

/** The current offering's packages, cheapest term first. */
export async function loadPackages(): Promise<OfferedPackage[]> {
  const p = await load();
  const { current, all } = await p.getOfferings();
  const offering = all[OFFERING_ID] ?? current;
  if (!offering) return [];
  return offering.availablePackages.map((pkg) => ({
    id: pkg.identifier,
    title: pkg.product.title,
    description: pkg.product.description,
    priceString: pkg.product.priceString,
    period: pkg.product.subscriptionPeriod ?? null,
  }));
}

export type PurchaseOutcome =
  | { state: "entitled"; plan: Plan }
  | { state: "not-entitled" }
  | { state: "cancelled" }
  | { state: "failed"; message: string };

function outcomeFrom(customerInfo: {
  entitlements: { active: Record<string, { isActive: boolean }> };
}): PurchaseOutcome {
  const plan = planFromEntitlements(customerInfo.entitlements.active);
  return plan ? { state: "entitled", plan } : { state: "not-entitled" };
}

function failure(err: unknown): PurchaseOutcome {
  const e = err as { userCancelled?: boolean; code?: string | number; message?: string } | null;
  // The plugin flags a cancelled sheet; older builds only carry the code.
  if (e?.userCancelled || String(e?.code) === "1") return { state: "cancelled" };
  return { state: "failed", message: e?.message ?? "Purchase failed" };
}

/** Buy a package from the current offering; the store's sheet does the rest. */
export async function buyPackage(packageId: string): Promise<PurchaseOutcome> {
  try {
    const p = await load();
    const { current, all } = await p.getOfferings();
    const offering = all[OFFERING_ID] ?? current;
    const pkg = offering?.availablePackages.find((x) => x.identifier === packageId);
    if (!pkg) return { state: "failed", message: "That option is no longer offered" };
    const { customerInfo } = await p.purchasePackage({ aPackage: pkg });
    return outcomeFrom(customerInfo);
  } catch (err) {
    return failure(err);
  }
}

/** Restore purchases — required by review, and how a new phone gets its plan back. */
export async function restorePurchases(): Promise<PurchaseOutcome> {
  try {
    const p = await load();
    const { customerInfo } = await p.restorePurchases();
    return outcomeFrom(customerInfo);
  } catch (err) {
    return failure(err);
  }
}

/** What the store thinks right now, without a purchase — for the screen's header. */
export async function storeEntitled(): Promise<boolean> {
  try {
    const p = await load();
    const { customerInfo } = await p.getCustomerInfo();
    return !!customerInfo.entitlements.active[ENTITLEMENT_ID];
  } catch {
    return false;
  }
}
