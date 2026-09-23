import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { blobConfigured } from "@/lib/server/library";
import { UID_RE } from "@/lib/server/users";
import { revenuecatConfigured, syncPlanFromStore } from "@/lib/server/revenuecat";

// RevenueCat's webhook: renewals, cancellations, expirations, refunds and
// billing issues arrive here whether or not the app is open. The body is
// only trusted for WHICH account it names; the plan itself is re-read from
// RevenueCat's API and pinned from that. Configure the webhook in the
// RevenueCat dashboard with the Authorization header set to
// REVENUECAT_WEBHOOK_SECRET.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function authorized(req: NextRequest): boolean {
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET ?? "";
  const header = req.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : header;
  if (!secret || !given) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!blobConfigured() || !revenuecatConfigured()) {
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }
  const body = (await req.json().catch(() => null)) as {
    event?: { type?: string; app_user_id?: string; original_app_user_id?: string; aliases?: string[] };
  } | null;
  const event = body?.event;
  // The app user id IS our uid hash (the app signs in to RevenueCat with it);
  // anonymous ids from before sign-in are ignored — they can't map to a profile.
  const candidates = [event?.app_user_id, event?.original_app_user_id, ...(event?.aliases ?? [])];
  const uid = candidates.find((c): c is string => typeof c === "string" && UID_RE.test(c));
  if (!uid) return NextResponse.json({ ignored: true, reason: "no account id" });
  try {
    const pinned = await syncPlanFromStore(uid);
    return NextResponse.json({ ok: true, type: event?.type ?? null, pinned });
  } catch (err) {
    const message = err instanceof Error ? err.message : "sync failed";
    // A 5xx makes RevenueCat retry, which is what we want for a transient fault.
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
