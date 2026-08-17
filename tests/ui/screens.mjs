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

// Start a run → ink theme.
await page.evaluate(() => window.scrollTo(0, 99999));
await page.locator(".cta").filter({ hasText: /start/i }).first().click();
await page.waitForTimeout(2000);

assert.strictEqual(await page.locator(".app.theme-ink").count(), 1, "run screen not in ink theme");
const runColors = await page.evaluate(() => {
  const app = document.querySelector(".app");
  const timer = document.querySelector(".big-timer");
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

// Walk far enough to leave a route, then end → summary + card.
for (let i = 0; i < 24; i++) {
  await context.setGeolocation({
    latitude: 1.3521 + i * 0.0009,
    longitude: 103.8198 + Math.sin(i / 3) * 0.0006,
  });
  await page.waitForTimeout(150);
}
await page.locator(".control-btn.end").click();
await page.waitForTimeout(3000);
assert.strictEqual(await page.locator(".app.theme-ink").count(), 0, "summary still in ink theme");
await page.screenshot({ path: `${OUT}/03-summary.png`, fullPage: true });

const dataUrl = await page.evaluate(
  () => document.querySelector(".run-card-img")?.getAttribute("src") ?? null
);
assert.ok(dataUrl?.startsWith("data:image/png"), "run card never rendered");
writeFileSync(`${OUT}/04-card.png`, Buffer.from(dataUrl.split(",")[1], "base64"));

await browser.close();
console.log(`screens: invariants hold — screenshots in ${OUT}`);
