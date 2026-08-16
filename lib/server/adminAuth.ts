import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

// Simple PIN gate for admin actions. When ADMIN_PIN is unset, everything is
// open (local dev convenience). When set, the admin page and the
// credit-spending endpoints (expand, force re-render) require it.

export function pinRequired(): boolean {
  return !!process.env.ADMIN_PIN;
}

export function checkPin(candidate: string | null | undefined): boolean {
  const pin = process.env.ADMIN_PIN;
  if (!pin) return true;
  if (!candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(pin);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function checkPinHeader(req: NextRequest): boolean {
  return checkPin(req.headers.get("x-admin-pin"));
}
