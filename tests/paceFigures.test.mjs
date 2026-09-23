// The split figures: one per second from 3:00 to 15:59, the words the
// trainer says, the lookup the coach uses, and the guarantee that none of
// their ids can shadow a library phrase (so rendering them can never land
// on a promoted actor take).
import assert from "node:assert";
import {
  PACE_FIGURES,
  paceFigureFor,
  paceFigureById,
  paceFigureText,
} from "../lib/paceFigures.ts";
import { PHRASE_LIBRARY } from "../lib/phrases.ts";

assert.strictEqual(PACE_FIGURES.length, 13 * 60, "3:00–15:59 is 780 figures");
assert.strictEqual(new Set(PACE_FIGURES.map((p) => p.id)).size, PACE_FIGURES.length, "ids unique");
assert.ok(PACE_FIGURES.every((p) => p.category === "pace_figure"));

assert.strictEqual(paceFigureText(3, 0), "Three minutes flat!");
assert.strictEqual(paceFigureText(3, 1), "Three minutes, one second per kilometre.");
assert.strictEqual(paceFigureText(5, 12), "Five minutes, twelve seconds per kilometre.");
assert.strictEqual(paceFigureText(15, 59), "Fifteen minutes, fifty-nine seconds per kilometre.");
assert.strictEqual(paceFigureText(10, 40), "Ten minutes, forty seconds per kilometre.");

assert.strictEqual(paceFigureFor(180)?.id, "pf-3-00");
assert.strictEqual(paceFigureFor(341.4)?.id, "pf-5-41", "rounds to the nearest second");
assert.strictEqual(paceFigureFor(341.6)?.id, "pf-5-42");
assert.strictEqual(paceFigureFor(959)?.id, "pf-15-59");
assert.strictEqual(paceFigureFor(179), null, "below the band → device voice");
assert.strictEqual(paceFigureFor(960), null, "above the band → device voice");
assert.strictEqual(paceFigureById("pf-7-05")?.text, "Seven minutes, five seconds per kilometre.");

const libraryIds = new Set(Object.values(PHRASE_LIBRARY).flat().map((p) => p.id));
for (const p of PACE_FIGURES) {
  assert.ok(!libraryIds.has(p.id), `${p.id} shadows a library phrase`);
}

console.log("paceFigures: 780 figures, words, lookup and id isolation — passed");
