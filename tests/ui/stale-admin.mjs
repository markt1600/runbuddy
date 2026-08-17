// Stale-audio admin flow, both states:
//   1. No render markers → no banner, no rows flagged (the false-alarm case
//      that shipped once: a guessed baseline kept re-flagging phrases the
//      user had already correctly re-rendered).
//   2. Markers holding pre-edit text hashes → exactly those phrases flagged,
//      untouched personas clean, and the bulk button force-renders exactly
//      the flagged set.
//
// Needs a production server: npm run build && npx next start -p 3123
// Run: node --import ../ts-resolve.mjs tests/ui/stale-admin.mjs
import assert from "node:assert";
import { launchIphone, stubLibraryRoutes, openAdmin } from "./helpers.mjs";

const { phraseHash } = await import("../../lib/phraseHash.ts");
const { PHRASE_LIBRARY } = await import("../../lib/phrases.ts");

// ---- state 1: nothing recorded ----
{
  const { browser, page } = await launchIphone();
  await stubLibraryRoutes(page, { renderHashes: {} });
  await openAdmin(page);
  assert.strictEqual(await page.locator(".stale-banner").count(), 0, "banner with no markers");
  assert.strictEqual(await page.locator(".phrase-badge.stale").count(), 0, "flags with no markers");
  await browser.close();
  console.log("  ok   no markers → silent");
}

// ---- state 2: markers say ahlian's audio was cut from different text ----
{
  const STALE_IDS = ["li-intro-1", "li-enc-7", "li-km-3"];
  const hashes = {
    ahlian: Object.fromEntries(
      PHRASE_LIBRARY.ahlian.map((p) => [
        p.id,
        STALE_IDS.includes(p.id) ? phraseHash(`${p.text} (older wording)`) : phraseHash(p.text),
      ])
    ),
  };
  const renderCalls = [];
  const { browser, page } = await launchIphone();
  await stubLibraryRoutes(page, { renderHashes: hashes, renderCalls });
  await openAdmin(page);

  const head = await page.locator(".stale-banner .stale-head").innerText();
  assert.match(head, /3 phrases/, `banner said: ${head}`);

  await page.locator("button").filter({ hasText: "Ah Lian" }).first().click();
  await page.waitForTimeout(500);
  assert.strictEqual(await page.locator(".phrase-badge.stale").count(), STALE_IDS.length);

  await page.locator("button").filter({ hasText: "Ah Beng" }).first().click();
  await page.waitForTimeout(400);
  assert.strictEqual(await page.locator(".phrase-badge.stale").count(), 0, "clean persona flagged");

  await page.locator("button").filter({ hasText: "Ah Lian" }).first().click();
  await page.waitForTimeout(400);
  await page.locator(".stale-banner button").first().click(); // confirm dialog auto-accepted
  await page.waitForTimeout(2500);

  assert.deepStrictEqual(renderCalls.sort(), STALE_IDS.map((id) => `ahlian/${id}`).sort());
  assert.strictEqual(await page.locator(".stale-banner").count(), 0, "banner survived re-render");
  await browser.close();
  console.log("  ok   markers → exact flags, exact re-renders, banner clears");
}

console.log("stale-admin: passed");
