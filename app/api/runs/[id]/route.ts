import { NextRequest, NextResponse } from "next/server";
import { readSession } from "@/lib/server/auth";
import { confirmRunDistance, deleteRun, getRun, runsConfigured } from "@/lib/server/runs";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = readSession(req);
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!runsConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const { id } = await ctx.params;
  const run = await getRun(user.sub, id);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(run);
}

// Confirm the run against a device: adopt its distance (from the Health
// panel) as the run's official one. Returns the amended stats and the run's
// new id — the basename encodes distance, so the id changes with it.
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = readSession(req);
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!runsConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as {
    distanceKm?: number;
    source?: string;
  } | null;
  const km = body?.distanceKm;
  if (typeof km !== "number" || !isFinite(km) || km <= 0 || km > 300) {
    return NextResponse.json({ error: "bad distance" }, { status: 400 });
  }
  const result = await confirmRunDistance(user.sub, id, km, body?.source ?? "device");
  if (!result) return NextResponse.json({ error: "not confirmable" }, { status: 400 });
  return NextResponse.json(result);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = readSession(req);
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!runsConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const { id } = await ctx.params;
  const ok = await deleteRun(user.sub, id);
  return ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "not found" }, { status: 404 });
}
