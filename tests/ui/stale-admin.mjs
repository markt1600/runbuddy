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

const ADMIN_USERS = [
  { uid: "a".repeat(24), name: "Mark Tan", email: "markh.tan@gmail.com",
    firstSeen: 1755000000000, lastSeen: 1755480000000, runCount: 2 },
  { uid: "b".repeat(24), name: "Test Runner", email: "test@example.com",
    firstSeen: 1755100000000, lastSeen: 1755300000000, runCount: 0 },
];
const ADMIN_USER_RUNS = [
  { id: "r1", startedAt: 1755480000000, distanceKm: 10.06, movingSec: 3732,
    wallSec: 3810, personaId: "ahbeng", targetKm: 10 },
  { id: "r2", startedAt: 1755300000000, distanceKm: 0, movingSec: 1800,
    wallSec: 1800, personaId: "coach", treadmill: true, targetMinutes: 30 },
];

async function stubAdminUsers(page) {
  await page.route("**/api/admin/users", (r) =>
    r.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ users: ADMIN_USERS }) })
  );
  await page.route(`**/api/admin/users/${ADMIN_USERS[0].uid}`, (r) =>
    r.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ runs: ADMIN_USER_RUNS }) })
  );
}

// ---- state 1: nothing recorded ----
{
  const { browser, page } = await launchIphone();
  await stubLibraryRoutes(page, { renderHashes: {} });
  await stubAdminUsers(page);
  await openAdmin(page);
  // The user directory: both accounts listed, click-through shows the runs
  // with trainer and the run's configured target.
  assert.strictEqual(await page.locator(".admin-user-row").count(), 2, "user rows");
  await page.locator(".admin-user-row").first().click();
  await page.waitForTimeout(600);
  assert.strictEqual(await page.locator(".admin-run-row").count(), 2, "run rows for user");
  const runsText = await page.locator(".admin-run-row").allInnerTexts();
  assert.ok(runsText.some((t) => /Ah Beng/.test(t) && /10 km target/i.test(t)),
    `distance run missing trainer/target: ${runsText}`);
  assert.ok(runsText.some((t) => /Christine/.test(t) && /30 min target/i.test(t)),
    `treadmill run missing trainer/target: ${runsText}`);
  await page.locator(".back-link", { hasText: "All users" }).click();
  await page.waitForTimeout(300);
  assert.strictEqual(await page.locator(".admin-user-row").count(), 2, "back to user list");
  assert.strictEqual(await page.locator(".stale-banner").count(), 0, "banner with no markers");
  assert.strictEqual(await page.locator(".phrase-badge.stale").count(), 0, "flags with no markers");
  // Recording dates come through the status payload and label every row.
  const dates = await page.locator(".phrase-date").count();
  assert.ok(dates > 0, "no recording dates rendered");
  const sample = await page.locator(".phrase-date").first().innerText();
  assert.match(sample, /Aug/, `unexpected date format: ${sample}`);
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
