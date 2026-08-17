# Tests

Every scenario here earned its place by catching a real bug — several of which
passed a clean simulation and only failed on a phone, which is why the sims
jitter their clocks and the UI checks drive a real browser.

## Node suites (no server, no browser, no credits)

```
npm test
```

- `geo.sim.mjs` — the real `lib/geo.ts` against a fake clock and scripted
  geolocation watch, with seeded-random jitter on fix timing and position
  noise. Scenarios: stationary drift (the ~3 km phantom-distance bug), steady
  run accuracy, auto-pause/resume with back-dating, tunnel signal loss (the
  frozen-distance-after-exit bug), and armed resume (the boundary bug that a
  clean clock hid). On its first run it caught the stall-log pruning bug that
  had silently disabled auto-pause for no-Doppler receivers.
- `audio.settle.test.mjs` — `VoiceEngine` against a stubbed DOM. Simulates iOS
  pausing the media element with no `ended`/`error` (camera, lock button) and
  asserts the queue keeps moving — the "trainer permanently silent" bug.
- `markers.test.mjs` — the stale-audio marker scheme against a mock blob store
  whose content reads lag its writes like a CDN, proving the pathname-as-data
  design survives what destroyed the read-modify-write JSON manifest.

TypeScript imports work through `tests/ts-resolve.mjs`, which maps the app's
extensionless relative imports onto Node 22's native type stripping — no build
step, no extra dependencies.

## Browser drivers (production server required)

```
npm run build
npx next start -p 3123 &
npm run test:ui                 # stale-admin flow + screen invariants
```

- `ui/stale-admin.mjs` — the stale-audio admin flow in both states: no render
  markers → completely silent (the false-alarm regression), and markers
  disagreeing with current text → exactly those rows flagged and exactly those
  re-rendered by the bulk button.
- `ui/screens.mjs` — screenshots setup, run, summary, and the generated run
  card at full resolution, asserting the theme invariants a build can't check:
  the run screen actually inverts, its text actually contrasts with its ground
  (the computed-`color` inheritance bug), and the timer is set in the display
  face. Screenshots land in `/tmp/runbuddy-screens` (or pass an out dir).

All API routes that would spend ElevenLabs credits or touch Vercel Blob are
stubbed in `ui/helpers.mjs`; the drivers run entirely offline.

Set `CHROMIUM=/path/to/chrome` if Playwright can't resolve a browser; the
helpers otherwise fall back to any chromium under `PLAYWRIGHT_BROWSERS_PATH`.
