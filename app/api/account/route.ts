import { NextRequest, NextResponse } from "next/server";
import { readSession, SESSION_COOKIE } from "@/lib/server/auth";
import { blobConfigured } from "@/lib/server/library";
import { deleteAccount } from "@/lib/server/deleteAccount";

// Delete the signed-in account and everything stored with it. The body
// must say so in as many words — a stray call from a retry or a script
// must not be able to do this — and the session cookie goes with it.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function DELETE(req: NextRequest) {
  const user = readSession(req);
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const body = (await req.json().catch(() => null)) as { confirm?: unknown } | null;
  if (body?.confirm !== "delete my account") {
    return NextResponse.json({ error: "confirmation required" }, { status: 400 });
  }
  try {
    const report = await deleteAccount(user.sub);
    const res = NextResponse.json({ ok: true, report });
    res.cookies.delete(SESSION_COOKIE);
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "deletion failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
