import { NextRequest, NextResponse } from "next/server";
import { readSession } from "@/lib/server/auth";
import { deleteRun, getRun, runsConfigured } from "@/lib/server/runs";

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
