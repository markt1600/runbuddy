import { NextRequest, NextResponse } from "next/server";
import { blobConfigured } from "@/lib/server/library";
import { getAuditionCall, saveAuditionSubmission } from "@/lib/server/studio";
import { AUDITION_LINES, STUDIO_BRIEFS } from "@/lib/studioReads";
import { PERSONAS } from "@/lib/personas";

// The public audition page's API. The token is the whole gate — anyone who
// has it may read the brief and leave exactly one line. No account, no
// licence; the consent line on the page covers casting review.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const { token } = await ctx.params;
  const call = await getAuditionCall(token);
  if (!call) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    persona: call.persona,
    personaName: PERSONAS[call.persona].name,
    brief: STUDIO_BRIEFS[call.persona],
    line: AUDITION_LINES[call.persona],
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const { token } = await ctx.params;
  const call = await getAuditionCall(token);
  if (!call) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as {
    name?: string;
    email?: string;
    mp3Base64?: string;
  } | null;
  const name = (body?.name ?? "").trim();
  const email = (body?.email ?? "").trim();
  if (name.length < 2 || name.length > 80) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    return NextResponse.json({ error: "valid email required" }, { status: 400 });
  }
  let mp3: Buffer;
  try {
    mp3 = Buffer.from(body?.mp3Base64 ?? "", "base64");
  } catch {
    return NextResponse.json({ error: "bad audio" }, { status: 400 });
  }
  // One spoken line at 112kbps tops out well under 1MB; 3MB is a mistake.
  if (mp3.length < 2000 || mp3.length > 3_000_000) {
    return NextResponse.json({ error: "bad audio size" }, { status: 400 });
  }
  const sub = await saveAuditionSubmission(token, name, email, mp3);
  return NextResponse.json({ ok: true, id: sub.id });
}
