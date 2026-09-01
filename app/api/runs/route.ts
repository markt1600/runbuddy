import { NextRequest, NextResponse } from "next/server";
import { readSession, uidHash } from "@/lib/server/auth";
import { listRuns, runsConfigured, saveRun } from "@/lib/server/runs";
import { setProfileHomeCityIfUnset } from "@/lib/server/users";
import { listFriends } from "@/lib/server/friends";
import { notify } from "@/lib/server/notifications";
import { PERSONAS } from "@/lib/personas";
import type { PersonaId, RunStats } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const user = readSession(req);
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!runsConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  return NextResponse.json({ runs: await listRuns(user.sub) });
}

export async function POST(req: NextRequest) {
  const user = readSession(req);
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!runsConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });

  let body: { personaId?: string; stats?: RunStats };
  try {
    const raw = await req.text();
    if (raw.length > 900_000) return NextResponse.json({ error: "too large" }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const stats = body.stats;
  const personaId = body.personaId as PersonaId;
  if (
    !stats ||
    !(personaId in PERSONAS) ||
    typeof stats.elapsedMs !== "number" ||
    typeof stats.distanceKm !== "number" ||
    !isFinite(stats.elapsedMs) ||
    !isFinite(stats.distanceKm) ||
    stats.distanceKm < 0 ||
    stats.elapsedMs < 0 ||
    stats.elapsedMs > 86_400_000 ||
    !Array.isArray(stats.splits) ||
    !stats.splits.every((s) => typeof s === "number" && isFinite(s) && s > 0)
  ) {
    return NextResponse.json({ error: "bad stats" }, { status: 400 });
  }
  // The route can be long; the card and chart never need more than a shape.
  if (Array.isArray(stats.route) && stats.route.length > 2000) {
    const step = stats.route.length / 2000;
    stats.route = Array.from({ length: 2000 }, (_, i) => stats.route[Math.floor(i * step)]);
  }
  const result = await saveRun(user.sub, personaId, stats);
  if ("rejected" in result) {
    // Not an error: sub-minimum runs are dropped on purpose ("clearly
    // accidents"), and the client shouldn't retry or complain.
    return NextResponse.json({ skipped: result.rejected });
  }
  // Tell every mutual friend a run just landed in their feed. Best-effort —
  // an alert is never worth failing the save.
  try {
    const self = uidHash(user.sub);
    const mutuals = (await listFriends(self)).filter((f) => f.mutual);
    const what = stats.treadmill
      ? `a ${Math.round(stats.elapsedMs / 60000)} min treadmill run`
      : `a ${stats.distanceKm.toFixed(2)} km run`;
    await Promise.all(
      mutuals.map((f) =>
        notify(f.uid, {
          type: "run",
          text: `🏃 ${user.name} posted ${what}`,
          runId: result.id,
          friendUid: self,
          fromName: user.name,
        })
      )
    );
  } catch {
    /* alerts are decoration */
  }
  // Travel mode's baseline: an unset home city fills itself from the first
  // saved run with a GPS city. Best-effort, and never overwrites a value.
  if (typeof stats.city === "string" && stats.city.trim()) {
    await setProfileHomeCityIfUnset(uidHash(user.sub), stats.city.trim().slice(0, 60)).catch(
      () => {}
    );
  }
  return NextResponse.json({ id: result.id });
}
