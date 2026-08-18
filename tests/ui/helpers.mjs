// Shared plumbing for the browser drivers. These run against a production
// build: `npm run build && npx next start -p 3123`, then run the driver.
import { chromium, devices } from "playwright";
import { existsSync, readdirSync } from "node:fs";

export const BASE = process.env.BASE_URL ?? "http://localhost:3123";

/** Playwright's auto-resolution wants a headless-shell build that the pinned
 *  container doesn't ship; fall back to any full chromium under the browsers
 *  dir, and let an env var override both. */
function chromiumPath() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (root && existsSync(root)) {
    for (const d of readdirSync(root)) {
      if (d.startsWith("chromium-")) {
        const p = `${root}/${d}/chrome-linux/chrome`;
        if (existsSync(p)) return p;
      }
    }
  }
  return undefined; // let playwright resolve its own install
}

export async function launchIphone() {
  const browser = await chromium.launch({ executablePath: chromiumPath() });
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    permissions: ["geolocation"],
    geolocation: { latitude: 1.3521, longitude: 103.8198 },
  });
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept());
  return { browser, context, page };
}

/** A fake blob-rendered map covering every static phrase, so the app believes
 *  the whole library has audio without any network or ElevenLabs credits. */
export async function fullRenderedMap() {
  const { PHRASE_LIBRARY } = await import("../../lib/phrases.ts");
  const out = {};
  for (const [persona, phrases] of Object.entries(PHRASE_LIBRARY)) {
    for (const p of phrases) out[`${persona}/${p.id}`] = `${BASE}/silent.mp3`;
  }
  return out;
}

/** Stub the credit-spending and blob-backed routes. `renderHashes` drives the
 *  stale-audio UI; `renderCalls` collects every forced re-render request. */
export async function stubLibraryRoutes(page, { renderHashes = {}, renderCalls = [] } = {}) {
  const rendered = await fullRenderedMap();
  // Every phrase "recorded" at a fixed moment, so date rendering is testable.
  const renderedAt = Object.fromEntries(
    Object.keys(rendered).map((k) => [k, "2026-08-01T02:15:00.000Z"])
  );
  await page.route("**/api/admin/verify", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: "{}" })
  );
  await page.route("**/api/library/status", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        elevenlabs: true,
        blob: true,
        canRender: true,
        rendered,
        renderedAt,
        renderHashes,
        extras: {},
        voiceSettings: {},
      }),
    })
  );
  await page.route("**/api/library/render", async (r) => {
    const body = JSON.parse(r.request().postData() ?? "{}");
    renderCalls.push(`${body.persona}/${body.id}`);
    await r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ url: `${BASE}/silent.mp3`, existed: false }),
    });
  });
  await page.route("**/api/phrase", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ text: "Not bad lah. Same time tomorrow." }),
    })
  );
}

export async function openAdmin(page) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  await page.locator(".tab-admin").click();
  await page.waitForTimeout(600);
  const pin = page.locator('input[type="password"], input[inputmode="numeric"]').first();
  if (await pin.count()) {
    await pin.fill("0000");
    await page.keyboard.press("Enter");
  }
  await page.waitForTimeout(1200);
}
