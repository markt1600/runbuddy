import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { blobConfigured } from "@/lib/server/library";
import { listUsers } from "@/lib/server/users";
import { listRunsByHash } from "@/lib/server/runs";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const users = await listUsers();
  const withCounts = await Promise.all(
    users.map(async (u) => {
      const runs = await listRunsByHash(u.uid);
      // The profile's lastSeen only moves at OAuth login, and sessions last
      // 180 days — someone who ran this morning on a month-old cookie hasn't
      // "logged in" for a month. Activity is logins OR runs, whichever is
      // newer; the summaries are already in hand for the count.
      const lastRunAt = runs.reduce((m, r) => Math.max(m, r.startedAt), 0);
      return { ...u, runCount: runs.length, lastSeen: Math.max(u.lastSeen, lastRunAt) };
    })
  );
  withCounts.sort((a, b) => b.lastSeen - a.lastSeen);
  return NextResponse.json({ users: withCounts });
}
