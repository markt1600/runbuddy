import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { blobConfigured } from "@/lib/server/library";
import { getSession, ITEM_ID_RE } from "@/lib/server/studio";
import { takeMp3Path, takePath } from "@/lib/studioPaths";

// One take. The booth uploads it STRAIGHT to the store with a short-lived
// token this route issues — the file never passes through a function, so
// the platform's request-body ceiling (which silently cut takes off at
// about 50 seconds of WAV) no longer applies. The token is pinned to this
// session's two pathnames for this item, audio types only, so a leaked
// link can overwrite nothing but its own take. Long reads also upload an
// MP3 twin — the copy the Instant Voice Clone sends to ElevenLabs.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_TAKE_BYTES = 60_000_000; // a 5-minute 44.1 kHz mono WAV is ~26 MB

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string; itemId: string }> }
) {
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const { token, itemId } = await ctx.params;
  if (!ITEM_ID_RE.test(itemId)) return NextResponse.json({ error: "bad item" }, { status: 400 });
  const session = await getSession(token);
  if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!session.license) return NextResponse.json({ error: "license first" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as HandleUploadBody | null;
  if (!body) return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  const allowed = new Set([takePath(token, itemId), takeMp3Path(token, itemId)]);
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!allowed.has(pathname)) throw new Error("that is not this take's pathname");
        return {
          allowedContentTypes: ["audio/wav", "audio/x-wav", "audio/wave", "audio/mpeg"],
          maximumSizeInBytes: MAX_TAKE_BYTES,
          addRandomSuffix: false,
          allowOverwrite: true, // re-records replace in place
          cacheControlMaxAge: 0,
        };
      },
      // Nothing to record on completion: the store listing IS the record.
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "upload refused" },
      { status: 400 }
    );
  }
}
