// Screenshots every screen (setup, admin, run, summary) plus the generated
// run card at full resolution, and asserts the theme invariants that a build
// cannot catch — this is the check that found the run screen rendering
// paper-dark ink on an ink-dark ground.
//
// Needs a production server: npm run build && npx next start -p 3123
// Run: node --import ../ts-resolve.mjs tests/ui/screens.mjs [outDir]
import assert from "node:assert";
import { writeFileSync, mkdirSync } from "node:fs";
import { launchIphone, stubLibraryRoutes, BASE } from "./helpers.mjs";

const OUT = process.argv[2] ?? "/tmp/runbuddy-screens";
mkdirSync(OUT, { recursive: true });

const { browser, context, page } = await launchIphone();
await stubLibraryRoutes(page);

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/01-setup.png`, fullPage: true });

// Start a run → paper while running; the shell only flips to ink on a pause.
// Setup carries its own named Start; the tab bar's pill leaves the slot empty.
assert.strictEqual(await page.locator(".tab-run").count(), 0, "setup still shows the tab-bar run pill");
assert.match(await page.locator(".setup-start").innerText(), /Start with/i, "setup Start not named");
await page.locator(".setup-start").click();
await page.waitForTimeout(2000);

assert.strictEqual(await page.locator(".app.theme-ink").count(), 0, "running screen should be paper");
const runColors = await page.evaluate(() => {
  const app = document.querySelector(".app");
  const timer = document.querySelector(".rs-timer");
  return {
    bg: getComputedStyle(app).backgroundColor,
    fg: getComputedStyle(timer).color,
    font: getComputedStyle(timer).fontFamily,
  };
});
// The regression: fg and bg both dark. Parse and demand real contrast.
const lum = (c) => {
  const [r, g, b] = c.match(/\d+/g).map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};
assert.ok(
  Math.abs(lum(runColors.fg) - lum(runColors.bg)) > 0.5,
  `run screen text barely differs from its ground: ${JSON.stringify(runColors)}`
);
assert.match(runColors.font, /Fraunces/, "timer not set in the display face");
await page.screenshot({ path: `${OUT}/02-run.png`, fullPage: true });

// Lock, then hold-to-unlock: the unlock must land already paused — you
// unlocked to do something, not to hunt for the pause button while the
// clock eats your pace.
await page.locator('[aria-label="Lock screen for armband"]').click();
await page.waitForTimeout(300);
assert.strictEqual(await page.locator(".lock-overlay").count(), 1, "lock overlay missing");
const pad = await page.locator(".unlock-pad").boundingBox();
await page.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2);
await page.mouse.down();
await page.waitForTimeout(1700); // > the 1.5s hold
await page.mouse.up();
await page.waitForTimeout(500); // > the 250ms release settle
assert.strictEqual(await page.locator(".lock-overlay").count(), 0, "hold-to-unlock failed");
assert.match(
  await page.locator(".control-btn.pause").innerText(),
  /resume/i,
  "unlock did not auto-pause the run"
);
// Paused = the whole shell in ink with amber, unmistakable at arm's length.
assert.strictEqual(await page.locator(".app.theme-ink.theme-paused").count(), 1, "pause did not flip the theme");
const pausedColors = await page.evaluate(() => {
  const app = document.querySelector(".app");
  const timer = document.querySelector(".rs-timer");
  return { bg: getComputedStyle(app).backgroundColor, fg: getComputedStyle(timer).color };
});
assert.ok(
  Math.abs(lum(pausedColors.fg) - lum(pausedColors.bg)) > 0.4,
  `paused timer barely differs from its ground: ${JSON.stringify(pausedColors)}`
);
await page.screenshot({ path: `${OUT}/02b-paused.png`, fullPage: true });
await page.locator(".control-btn.pause").click(); // back to running for the walk
await page.waitForTimeout(400);
assert.strictEqual(await page.locator(".app.theme-ink").count(), 0, "resume did not restore paper");

// Walk far enough to leave a route, then end → summary + card.
for (let i = 0; i < 24; i++) {
  await context.setGeolocation({
    latitude: 1.3521 + i * 0.0009,
    longitude: 103.8198 + Math.sin(i / 3) * 0.0006,
  });
  await page.waitForTimeout(150);
}
await page.locator(".control-btn.end").click();
// End asks first — an in-app overlay, never window.confirm (which froze the
// WebView mid-gesture in the field).
await page.locator(".end-confirm .cta:not(.secondary)").click();
await page.waitForTimeout(3000);
assert.strictEqual(await page.locator(".app.theme-ink").count(), 0, "summary still in ink theme");
await page.screenshot({ path: `${OUT}/03-summary.png`, fullPage: true });

// The detail rows collapse under the card; opening one reveals its body.
assert.strictEqual(await page.locator(".sum-row-body").count(), 0, "a summary row started open");
await page.locator(".sum-row-main", { hasText: "Route" }).click();
await page.waitForTimeout(300);
assert.strictEqual(await page.locator(".sum-row-body").count(), 1, "the Route row did not open");
assert.ok(
  (await page.locator(".sum-row-body .route-map, .sum-row-body .route-empty").count()) === 1,
  "the Route row opened without a map or an empty-state line"
);
await page.screenshot({ path: `${OUT}/03b-summary-open.png`, fullPage: true });
await page.locator(".sum-row-main", { hasText: "Route" }).click();
await page.waitForTimeout(200);
assert.strictEqual(await page.locator(".sum-row-body").count(), 0, "the Route row did not close");

const dataUrl = await page.evaluate(
  () => document.querySelector(".run-card-img")?.getAttribute("src") ?? null
);
assert.ok(dataUrl?.startsWith("data:image/png"), "run card never rendered");
writeFileSync(`${OUT}/04-card.png`, Buffer.from(dataUrl.split(",")[1], "base64"));

await browser.close();
console.log(`screens: invariants hold — screenshots in ${OUT}`);
