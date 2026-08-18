import { NextRequest, NextResponse } from "next/server";
import { adminGateActive, authConfigured, isAdminEmail, readSession } from "@/lib/server/auth";
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
    // Verdicts only — the allowed email list itself never leaves the server.
    // Once sign-in exists, admin is never offered to guests; with ADMIN_EMAIL
    // set it is only offered to those accounts. Unconfigured deployments
    // (local dev, no Google) keep admin visible — hiding it there would make
    // it unreachable everywhere.
    adminGated: adminGateActive(),
    isAdmin: !configured
      ? true
      : user
        ? adminGateActive()
          ? isAdminEmail(user.email)
          : true
        : false,
    user: user ? { name: user.name, picture: user.picture ?? null, email: user.email ?? null } : null,
  });
}
