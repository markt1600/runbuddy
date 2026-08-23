import { NextRequest, NextResponse } from "next/server";
import { readSession, uidHash } from "@/lib/server/auth";
import { blobConfigured } from "@/lib/server/library";
import { getProfile, updateProfile, type ProfileEdits } from "@/lib/server/users";
import { spotifyConfigured } from "@/lib/server/spotify";

// The signed-in user's own profile: read on the account screen, written when
// they save their age / height / weight. Always keyed off the session — the
// uid never travels in the request, so there is nothing to spoof.

export const runtime = "nodejs";

const pick = (
  p: {
    age?: number;
    heightCm?: number;
    weightKg?: number;
    gender?: string;
    units?: string;
    homeCity?: string;
  } | null
) =>
  p
    ? {
        age: p.age ?? null,
        heightCm: p.heightCm ?? null,
        weightKg: p.weightKg ?? null,
        gender: p.gender ?? null,
        units: p.units ?? "metric",
        homeCity: p.homeCity ?? null,
      }
    : {
        age: null,
        heightCm: null,
        weightKg: null,
        gender: null,
        units: "metric",
        homeCity: null,
      };

export async function GET(req: NextRequest) {
  const session = readSession(req);
  if (!session) return NextResponse.json({ error: "sign in required" }, { status: 401 });
  if (!blobConfigured()) return NextResponse.json({ profile: pick(null), storage: false });
  const profile = await getProfile(uidHash(session.sub)).catch(() => null);
  return NextResponse.json({
    profile: pick(profile),
    storage: true,
    spotify: { configured: spotifyConfigured(), connected: !!profile?.spotify },
    // Which provider IS this account, and which others are linked onto it —
    // the account screen's linking section reads this.
    account: {
      provider: session.sub.startsWith("apple:") ? "apple" : "google",
      linked: profile?.linked ?? [],
    },
  });
}

/** null clears a field; a number must sit inside a sane human range. */
function numberOrNull(
  v: unknown,
  min: number,
  max: number,
  integer = false
): number | null | undefined {
  if (v === null) return null;
  if (typeof v !== "number" || !isFinite(v)) return undefined;
  const n = integer ? Math.round(v) : Math.round(v * 10) / 10;
  return n >= min && n <= max ? n : undefined;
}

export async function PUT(req: NextRequest) {
  const session = readSession(req);
  if (!session) return NextResponse.json({ error: "sign in required" }, { status: 401 });
  if (!blobConfigured()) {
    return NextResponse.json({ error: "no blob store connected" }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const edits: ProfileEdits = {};
  if ("age" in body) {
    const age = numberOrNull(body.age, 5, 120, true);
    if (age === undefined && body.age !== undefined) {
      return NextResponse.json({ error: "age must be between 5 and 120" }, { status: 400 });
    }
    edits.age = age;
  }
  if ("heightCm" in body) {
    const h = numberOrNull(body.heightCm, 50, 250);
    if (h === undefined && body.heightCm !== undefined) {
      return NextResponse.json({ error: "height must be 50–250 cm" }, { status: 400 });
    }
    edits.heightCm = h;
  }
  if ("weightKg" in body) {
    const w = numberOrNull(body.weightKg, 20, 350);
    if (w === undefined && body.weightKg !== undefined) {
      return NextResponse.json({ error: "weight must be 20–350 kg" }, { status: 400 });
    }
    edits.weightKg = w;
  }
  if ("gender" in body) {
    if (body.gender === null) edits.gender = null;
    else if (body.gender === "female" || body.gender === "male") edits.gender = body.gender;
    else if (body.gender !== undefined) {
      return NextResponse.json({ error: "gender must be female, male or null" }, { status: 400 });
    }
  }
  if (body.units === "metric" || body.units === "imperial") edits.units = body.units;
  if ("homeCity" in body) {
    if (body.homeCity === null) edits.homeCity = null;
    else if (typeof body.homeCity === "string") {
      const city = body.homeCity.trim().slice(0, 60);
      edits.homeCity = city || null; // an emptied box clears it
    } else if (body.homeCity !== undefined) {
      return NextResponse.json({ error: "homeCity must be a string or null" }, { status: 400 });
    }
  }

  const profile = await updateProfile(uidHash(session.sub), edits).catch(() => null);
  if (!profile) {
    return NextResponse.json({ error: "profile not found — sign in again" }, { status: 404 });
  }
  return NextResponse.json({ profile: pick(profile), storage: true });
}
