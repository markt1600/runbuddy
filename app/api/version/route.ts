import { NextResponse } from "next/server";
import { WEB_BUILD } from "@/lib/version";

export const dynamic = "force-dynamic";

// What build is the server on? The shell asks on every return to foreground
// and reloads itself when the answer is newer than the page it's showing —
// the WebView only naturally refetches the site on a cold launch.
export async function GET() {
  return NextResponse.json(
    { build: WEB_BUILD },
    { headers: { "Cache-Control": "no-store" } }
  );
}
