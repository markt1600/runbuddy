import { NextRequest, NextResponse } from "next/server";
import { checkPin, pinRequired } from "@/lib/server/adminAuth";

export const dynamic = "force-dynamic";

/** GET: is a PIN required at all? */
export async function GET() {
  return NextResponse.json({ required: pinRequired() });
}

/** POST {pin}: verify it. */
export async function POST(req: NextRequest) {
  let body: { pin?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (checkPin(body.pin)) {
    return NextResponse.json({ ok: true });
  }
  // Small fixed delay to blunt brute-force guessing
  await new Promise((r) => setTimeout(r, 750));
  return NextResponse.json({ ok: false }, { status: 401 });
}
