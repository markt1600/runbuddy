// The account flows, with auth and runs stubbed at the network edge:
//   1. Unconfigured auth → straight to setup (the pre-accounts app, untouched).
//   2. Configured, signed out → landing; "Run as guest" → setup, remembered.
//   3. Signed in → home: Get Ready to Run + run cards; card → detail with the
//      key stats and the split chart, fastest split highlighted; delete needs
//      a confirmation and returns home.
//
// Needs a production server: npm run build && npx next start -p 3123
// Run: node --import ../ts-resolve.mjs tests/ui/accounts.mjs
import assert from "node:assert";
import { launchIphone, BASE } from "./helpers.mjs";

const SPLITS = [372_000, 355_000, 348_000, 361_000]; // ms per km; km 3 fastest
const RUNS = [
  {
    id: "1755480000000_10060_3732_3810_ahbeng.json",
    startedAt: 1755480000000,
    distanceKm: 10.06,
    movingSec: 3732,
    wallSec: 3810,
    personaId: "ahbeng",
  },
  {
    id: "1755390000000_4210_1500_1512_ahlian.json",
    startedAt: 1755390000000,
    distanceKm: 4.21,
    movingSec: 1500,
    wallSec: 1512,
    personaId: "ahlian",
  },
];

async function stubAuth(page, me) {
  await page.route("**/api/auth/me", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(me) })
  );
  await page.route("**/api/library/status", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        elevenlabs: false, blob: false, canRender: false,
        rendered: {}, renderedAt: {}, renderHashes: {}, extras: {}, voiceSettings: {},
      }),
    })
  );
}

// ---- 1. unconfigured → setup, exactly as before accounts ----
{
  const { browser, page } = await launchIphone();
  await stubAuth(page, { configured: false, historyAvailable: false, user: null });
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  assert.ok(await page.locator(".persona-card").count() > 0, "setup did not render");
  assert.strictEqual(await page.locator(".landing").count(), 0, "landing shown while unconfigured");
  await browser.close();
  console.log("  ok   unconfigured → setup untouched");
}

// ---- 2. configured, signed out → landing; guest choice remembered ----
{
  const { browser, page } = await launchIphone();
  await stubAuth(page, {
    configured: true, historyAvailable: true, user: null,
    adminGated: true, isAdmin: false,
  });
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  assert.strictEqual(await page.locator(".landing").count(), 1, "no landing when configured");
  await page.locator("button", { hasText: "Run as guest" }).click();
  await page.waitForTimeout(600);
  assert.ok(await page.locator(".persona-card").count() > 0, "guest did not reach setup");
  // With ADMIN_EMAIL gating, the admin tab isn't theirs to see…
  assert.strictEqual(await page.locator(".tab-admin").count(), 0, "admin tab shown to gated guest");
  // …and a guest's Home leads to the login page, not a history they don't have.
  await page.locator(".tab-home").click();
  await page.waitForTimeout(500);
  assert.strictEqual(await page.locator(".landing").count(), 1, "guest Home did not reach the login page");
  await page.locator("button", { hasText: "Run as guest" }).click();
  await page.waitForTimeout(500);
  await page.locator(".tab-account").click();
  await page.waitForTimeout(500);
  assert.ok(
    (await page.locator('a[href="/api/auth/login"]').count()) > 0,
    "no sign-in option on the guest account screen"
  );
  // Reload: the guest choice sticks, landing never reappears.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  assert.strictEqual(await page.locator(".landing").count(), 0, "landing reappeared for guest");
  assert.ok(await page.locator(".persona-card").count() > 0, "guest reload lost setup");
  await browser.close();
  console.log("  ok   landing → guest → remembered");
}

// ---- 3. signed in → home, cards, detail, chart, delete ----
{
  const { browser, page } = await launchIphone();
  await stubAuth(page, {
    configured: true,
    historyAvailable: true,
    user: { name: "Mark Tan", picture: null },
    adminGated: true,
    isAdmin: true,
  });
  let deleted = false;
  await page.route("**/api/runs", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ runs: deleted ? RUNS.slice(1) : RUNS }),
    })
  );
  await page.route(`**/api/runs/${RUNS[0].id}`, (r) => {
    if (r.request().method() === "DELETE") {
      deleted = true;
      return r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    }
    return r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        personaId: "ahbeng",
        savedAt: RUNS[0].startedAt,
        stats: {
          elapsedMs: RUNS[0].movingSec * 1000,
          distanceKm: RUNS[0].distanceKm,
          splits: SPLITS,
          route: [],
          paceSecPerKm: null, avgPaceSecPerKm: 371, speedNowKmh: null,
          lastKmSpeedKmh: null, avgSpeedKmh: 9.7,
          startedAt: RUNS[0].startedAt,
          wallElapsedMs: RUNS[0].wallSec * 1000,
        },
      }),
    });
  });

  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  assert.match(await page.locator(".tab-run").innerText(), /GET READY/i, "wrong big-button label on home");
  assert.strictEqual(await page.locator(".run-card").count(), RUNS.length, "wrong card count");
  const firstCard = await page.locator(".run-card").first().innerText();
  assert.match(firstCard, /10\.06/, `card missing distance: ${firstCard}`);

  // The big button leads to setup, where it becomes START RUN; the admin
  // account keeps its admin tab, and Home leads back.
  await page.locator(".tab-run").click();
  await page.waitForTimeout(600);
  assert.ok(await page.locator(".persona-card").count() > 0, "setup not reached from home");
  assert.match(await page.locator(".tab-run").innerText(), /START RUN/i, "wrong big-button label on setup");
  assert.strictEqual(await page.locator(".tab-admin").count(), 1, "admin tab missing for admin");
  await page.locator(".tab-home").click();
  await page.waitForTimeout(500);

  // Into the detail view.
  await page.locator(".run-card").first().click();
  await page.waitForTimeout(900);
  const statLabels = await page.locator(".run-detail .stat-label").allInnerTexts();
  // innerText reflects the CSS text-transform, so compare case-insensitively.
  const labels = statLabels.map((l) => l.toLowerCase());
  for (const want of ["distance", "avg pace / km", "moving time", "total elapsed", "fastest split"]) {
    assert.ok(labels.some((l) => l.includes(want)), `missing stat: ${want} in ${labels}`);
  }
  assert.strictEqual(await page.locator(".split-chart-row").count(), SPLITS.length, "chart rows");
  assert.strictEqual(await page.locator(".split-chart-bar.fastest").count(), 1, "fastest bars");
  const fastestTime = await page.locator(".split-chart-time.fastest").innerText();
  assert.match(fastestTime, /5:48/, `fastest split label: ${fastestTime}`);

  // Delete: link → confirmation → gone, back on home with one card fewer.
  await page.locator(".run-delete-link").click();
  assert.strictEqual(await page.locator(".run-delete-confirm").count(), 1, "no confirmation step");
  await page.locator(".cta.danger").click();
  await page.waitForTimeout(900);
  assert.strictEqual(await page.locator(".run-card").count(), RUNS.length - 1, "card not removed");
  await browser.close();
  console.log("  ok   home → detail → chart → confirmed delete");
}

console.log("accounts: passed");
