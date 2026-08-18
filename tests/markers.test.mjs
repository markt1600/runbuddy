// Stale-audio bookkeeping — the marker-pathname scheme, exercised against the
// failure that broke its predecessor: one JSON manifest updated by
// read-modify-write, where the CDN serves the pre-overwrite copy for a while,
// so a run of renders seconds apart each read a stale map and wrote back a
// copy missing its predecessors. Mirrors readRenderHashes in
// lib/server/library.ts; if that resolution logic changes, change it here too.
//
// Run: node tests/markers.test.mjs
import assert from "node:assert";

function phraseHash(t) {
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// A blob store whose *content reads* lag behind writes, the way a CDN does,
// but whose listings are current — which is exactly Vercel Blob's behaviour.
function makeStore(readLagMs) {
  const now = { t: 0 };
  const objects = new Map(); // pathname -> { body, uploadedAt, history }
  return {
    now,
    put(pathname, body) {
      // The real SDK rejects empty bodies (BlobError: body is required). The
      // mock accepting them let a zero-byte marker ship and fail every render
      // in production — after the audio had already been paid for and stored.
      if (!body) throw new Error("body is required");
      const prev = objects.get(pathname);
      const history = prev ? prev.history : [];
      history.push({ body, at: now.t });
      objects.set(pathname, { body, uploadedAt: new Date(now.t), history });
    },
    list(prefix) {
      return [...objects.entries()]
        .filter(([p]) => p.startsWith(prefix))
        .map(([pathname, o]) => ({ pathname, uploadedAt: o.uploadedAt }));
    },
    // Content served through the cache: whatever was current readLagMs ago.
    fetch(pathname) {
      const o = objects.get(pathname);
      if (!o) return undefined;
      const visible = o.history.filter((h) => h.at <= now.t - readLagMs);
      return visible.length ? visible[visible.length - 1].body : undefined;
    },
  };
}

const PHRASES = Array.from({ length: 29 }, (_, i) => ({
  id: `li-p-${i}`,
  text: `line number ${i}`,
}));

// ---- the old design: read-modify-write on one JSON blob ----
function recordViaManifest(store, id, hash) {
  const raw = store.fetch("library/ahlian/renders.json");
  const current = raw ? JSON.parse(raw) : {};
  current[id] = hash;
  store.put("library/ahlian/renders.json", JSON.stringify(current));
}

// ---- the new design: one marker blob per render, hash in the pathname ----
function recordViaMarker(store, id, hash) {
  // Hash as body, matching lib/server/library.ts — never empty.
  store.put(`library/ahlian/rendered/${id}__${hash}`, hash);
}
function readMarkers(store) {
  const out = {};
  const seenAt = {};
  for (const b of store.list("library/ahlian/rendered/")) {
    const m = b.pathname.match(/\/rendered\/(.+)__([0-9a-f]{8})$/);
    if (!m) continue;
    const [, id, hash] = m;
    const at = b.uploadedAt.getTime();
    if (seenAt[id] !== undefined && seenAt[id] >= at) continue;
    seenAt[id] = at;
    out[id] = hash;
  }
  return out;
}

// A bulk re-render: 29 phrases, one every 4s, behind a 10s read cache.
const LAG = 10_000;
const GAP = 4_000;

const oldStore = makeStore(LAG);
for (const p of PHRASES) {
  oldStore.now.t += GAP;
  recordViaManifest(oldStore, p.id, phraseHash(p.text));
}
const oldFinal = JSON.parse(oldStore.fetch("library/ahlian/renders.json") ?? "{}");

const newStore = makeStore(LAG);
for (const p of PHRASES) {
  newStore.now.t += GAP;
  recordViaMarker(newStore, p.id, phraseHash(p.text));
}
const newFinal = readMarkers(newStore);

const stale = (recorded) =>
  PHRASES.filter((p) => recorded[p.id] && recorded[p.id] !== phraseHash(p.text)).length;
const unrecorded = (recorded) => PHRASES.filter((p) => !recorded[p.id]).length;

console.log(`old manifest: ${Object.keys(oldFinal).length}/29 recorded,`,
  `${unrecorded(oldFinal)} phrases left with no provenance`);
console.log(`new markers:  ${Object.keys(newFinal).length}/29 recorded,`,
  `${unrecorded(newFinal)} phrases left with no provenance`);

assert.ok(unrecorded(oldFinal) > 0, "expected the old design to lose entries");
assert.strictEqual(unrecorded(newFinal), 0, "markers must record every render");
assert.strictEqual(stale(newFinal), 0, "nothing should read as stale right after rendering");

// Now reword three phrases without re-rendering: those must light up, and only those.
PHRASES[2].text = "line number 2, reworded";
PHRASES[9].text = "line number 9, reworded";
PHRASES[20].text = "line number 20, reworded";
assert.strictEqual(stale(newFinal), 3, "a reword after rendering must be flagged");

// Re-render one of them; it clears, the other two stay flagged.
newStore.now.t += GAP;
recordViaMarker(newStore, PHRASES[9].id, phraseHash(PHRASES[9].text));
const afterFix = readMarkers(newStore);
assert.strictEqual(stale(afterFix), 2, "re-rendering must clear exactly one");

// And an edit-back-and-forth resolves to the newest marker, not an old one.
newStore.now.t += GAP;
PHRASES[9].text = "line number 9";
recordViaMarker(newStore, PHRASES[9].id, phraseHash(PHRASES[9].text));
assert.strictEqual(stale(readMarkers(newStore)), 2, "newest marker must win");

console.log("reword flagged: 3 -> re-render one -> 2 -> edit back -> 2 ✓");
console.log("all assertions passed");
