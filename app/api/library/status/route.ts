import { NextResponse } from "next/server";
import { blobConfigured, elevenLabsConfigured, listRendered } from "@/lib/server/library";

export const dynamic = "force-dynamic";

// Reports whether runtime rendering is possible and which phrases already
// have blob-rendered audio.
export async function GET() {
  try {
    const canRender = blobConfigured() && elevenLabsConfigured();
    const rendered = blobConfigured() ? await listRendered() : {};
    return NextResponse.json({
      elevenlabs: elevenLabsConfigured(),
      blob: blobConfigured(),
      canRender,
      rendered, // { "<persona>/<id>": url }
    });
  } catch {
    return NextResponse.json({ error: "status unavailable" }, { status: 503 });
  }
}
