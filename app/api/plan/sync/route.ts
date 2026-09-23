import { NextRequest, NextResponse } from "next/server";
import { readSession, uidHash } from "@/lib/server/auth";
import { blobConfigured } from "@/lib/server/library";
import { defaultPlan } from "@/lib/server/plan";
import { revenuecatConfigured, syncPlanFromStore } from "@/lib/server/revenuecat";

// The app calls this right after a purchase or a restore, so the plan lands
// on the profile without waiting for the webhook. The verdict comes from
// RevenueCat's API, not from the client — the app merely says "look again".

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const user = readSession(req);
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  if (!revenuecatConfigured()) {
    return NextResponse.json({ error: "subscriptions not configured" }, { status: 503 });
  }
  try {
    const pinned = await syncPlanFromStore(uidHash(user.sub));
    return NextResponse.json({ pinned, plan: pinned ?? defaultPlan() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "sync failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
