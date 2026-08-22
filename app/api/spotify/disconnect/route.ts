import { NextRequest, NextResponse } from "next/server";
import { readSession, uidHash } from "@/lib/server/auth";
import { setProfileSpotify } from "@/lib/server/users";

// Forget the stored Spotify tokens. (Full revocation happens at
// spotify.com/account/apps if the user wants it gone from Spotify's side.)
export async function POST(req: NextRequest) {
  const session = readSession(req);
  if (!session) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  await setProfileSpotify(uidHash(session.sub), null).catch(() => {});
  return NextResponse.json({ ok: true });
}
