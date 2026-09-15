import { NextRequest, NextResponse } from "next/server";
import { readSession, uidHash } from "@/lib/server/auth";
import { blobConfigured } from "@/lib/server/library";
import { takeReceipt } from "@/lib/server/shoutouts";
import { notify } from "@/lib/server/notifications";
import { PERSONAS } from "@/lib/personas";
import type { PersonaId } from "@/lib/types";

// The recipient's run screen reports that a delivered message has actually
// started playing. The receipt parked at delivery (under the recipient, so
// only they can complete it) names the sender; they get a What's-new line
// saying when it played, in whose run, and what it was. The clock time comes
// from the runner's phone — it's their run, in their timezone.

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = readSession(req);
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!blobConfigured()) return NextResponse.json({ error: "no blob store" }, { status: 503 });
  const body = (await req.json().catch(() => null)) as {
    id?: string;
    localTime?: string;
  } | null;
  const id = body?.id ?? "";
  const self = uidHash(user.sub);
  const receipt = await takeReceipt(self, id);
  if (!receipt) return NextResponse.json({ ok: false });

  const at = /^[0-9]{1,2}:[0-9]{2}( ?[AaPp][Mm])?$/.test(body?.localTime ?? "")
    ? ` at ${body!.localTime}`
    : "";
  const runner = user.name.split(" ")[0] || "your friend";
  const trainer = PERSONAS[receipt.persona as PersonaId]?.shortName ?? "their trainer";
  let what: string;
  if (receipt.kind === "voice") {
    what = "🎤 your voice recording";
  } else {
    const words = (receipt.text ?? "").trim();
    const short = words.length > 90 ? words.slice(0, 87).trimEnd() + "…" : words;
    what = `💬 “${short}”` + (receipt.embellish ? `, in ${trainer}'s words` : `, read by ${trainer}`);
  }
  await notify(receipt.fromUid, {
    type: "shoutout",
    text: `✅ Played${at} in ${runner}'s run — ${what}`,
    fromName: user.name,
    friendUid: self,
  });
  return NextResponse.json({ ok: true });
}
