import { NextResponse } from "next/server";
import {
  blobConfigured,
  elevenLabsConfigured,
  listRendered,
  readExtras,
} from "@/lib/server/library";

export const dynamic = "force-dynamic";

// Reports whether runtime rendering is possible, which phrases already have
// blob-rendered audio, and the AI-generated extra phrases per persona.
export async function GET() {
  try {
    const canRender = blobConfigured() && elevenLabsConfigured();
    const rendered = blobConfigured() ? await listRendered() : {};
    const [ahbeng, coach] = await Promise.all([readExtras("ahbeng"), readExtras("coach")]);
    return NextResponse.json({
      elevenlabs: elevenLabsConfigured(),
      blob: blobConfigured(),
      canRender,
      rendered, // { "<persona>/<id>": url }
      extras: { ahbeng, coach },
    });
  } catch {
    return NextResponse.json({ error: "status unavailable" }, { status: 503 });
  }
}
