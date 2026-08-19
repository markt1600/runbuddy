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
    users.map(async (u) => ({ ...u, runCount: (await listRunsByHash(u.uid)).length }))
  );
  return NextResponse.json({ users: withCounts });
}
