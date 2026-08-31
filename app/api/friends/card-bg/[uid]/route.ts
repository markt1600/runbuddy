import { NextRequest, NextResponse } from "next/server";
import { readSession, uidHash } from "@/lib/server/auth";
import { blobConfigured } from "@/lib/server/library";
import { isMutual } from "@/lib/server/friends";
import { readCardBgImage, UID_RE } from "@/lib/server/users";

// A friend's card background, proxied same-origin so the feed can draw it
// onto a canvas without CORS taint — and gated on mutuality like the runs.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ uid: string }> }
) {
  const user = readSession(req);
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const { uid } = await ctx.params;
  if (!UID_RE.test(uid)) return NextResponse.json({ error: "bad uid" }, { status: 400 });
  const self = uidHash(user.sub);
  if (self !== uid && !(await isMutual(self, uid))) {
    return NextResponse.json({ error: "not friends" }, { status: 403 });
  }
  const bytes = await readCardBgImage(uid);
  if (!bytes) return NextResponse.json({ error: "no background" }, { status: 404 });
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=300",
    },
  });
}
