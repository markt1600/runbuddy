import { NextRequest, NextResponse } from "next/server";
import { blobConfigured } from "@/lib/server/library";
import { enrichedRunsByHash } from "@/lib/server/runs";
import { UID_RE, setPlan } from "@/lib/server/users";
import { isPlan } from "@/lib/plan";
import { requireAdmin } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest, ctx: { params: Promise<{ uid: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const { uid } = await ctx.params;
  if (!UID_RE.test(uid)) return NextResponse.json({ error: "bad uid" }, { status: 400 });
  return NextResponse.json({ runs: await enrichedRunsByHash(uid) });
}

/** Pin the user's plan ({ plan: "free" | "full" | null } — null clears to the default). */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ uid: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const { uid } = await ctx.params;
  if (!UID_RE.test(uid)) return NextResponse.json({ error: "bad uid" }, { status: 400 });
  const body = (await req.json().catch(() => null)) as { plan?: unknown } | null;
  const plan = body?.plan ?? null;
  if (plan !== null && !isPlan(plan)) return NextResponse.json({ error: "bad plan" }, { status: 400 });
  const profile = await setPlan(uid, plan);
  if (!profile) return NextResponse.json({ error: "no such user" }, { status: 404 });
  return NextResponse.json({ plan: profile.plan ?? null });
}
