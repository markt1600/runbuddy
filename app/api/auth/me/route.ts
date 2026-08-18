import { NextRequest, NextResponse } from "next/server";
import { authConfigured, readSession } from "@/lib/server/auth";
import { blobConfigured } from "@/lib/server/library";

export const dynamic = "force-dynamic";

// The client's one auth question: is Google sign-in available here, and who
// (if anyone) is signed in? historyAvailable warns the UI when runs can't be
// stored because no blob store is connected.
export async function GET(req: NextRequest) {
  const configured = authConfigured();
  const user = configured ? readSession(req) : null;
  return NextResponse.json({
    configured,
    historyAvailable: blobConfigured(),
    user: user ? { name: user.name, picture: user.picture ?? null } : null,
  });
}
