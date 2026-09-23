// The split figures: 13 minute clips and 60 second clips that compose every
// second from 3:00 to 15:59, the words each says, the lookup the coach uses,
// and the guarantee that none of their ids can shadow a library phrase (so
// rendering them can never land on a promoted actor take).
import assert from "node:assert";
import {
  MINUTE_FIGURES,
  SECOND_FIGURES,
  PACE_FIGURES,
  paceFigureFor,
  paceFigureById,
  minuteFigureText,
  secondFigureText,
} from "../lib/paceFigures.ts";
import { PHRASE_LIBRARY } from "../lib/phrases.ts";

assert.strictEqual(MINUTE_FIGURES.length, 13, "3 through 15");
assert.strictEqual(SECOND_FIGURES.length, 60, "0 through 59");
assert.strictEqual(PACE_FIGURES.length, 73);
assert.strictEqual(new Set(PACE_FIGURES.map((p) => p.id)).size, PACE_FIGURES.length, "ids unique");
assert.ok(PACE_FIGURES.every((p) => p.category === "pace_figure"));

assert.strictEqual(minuteFigureText(3), "Three minutes,");
assert.strictEqual(minuteFigureText(15), "Fifteen minutes,");
assert.strictEqual(secondFigureText(0), "flat!");
assert.strictEqual(secondFigureText(1), "one second per kilometre.");
assert.strictEqual(secondFigureText(12), "twelve seconds per kilometre.");
assert.strictEqual(secondFigureText(59), "fifty-nine seconds per kilometre.");
assert.strictEqual(secondFigureText(40), "forty seconds per kilometre.");

const f = paceFigureFor(180);
assert.strictEqual(f?.minute.id, "pf-min-3");
assert.strictEqual(f?.second.id, "pf-sec-00");
assert.strictEqual(paceFigureFor(341.4)?.second.id, "pf-sec-41", "rounds to the nearest second");
assert.strictEqual(paceFigureFor(341.6)?.second.id, "pf-sec-42");
assert.strictEqual(paceFigureFor(359.6)?.minute.id, "pf-min-6", "rounding can carry into the minute");
assert.strictEqual(paceFigureFor(359.6)?.second.id, "pf-sec-00");
assert.strictEqual(paceFigureFor(959)?.minute.id, "pf-min-15");
assert.strictEqual(paceFigureFor(179), null, "below the band → device voice");
assert.strictEqual(paceFigureFor(960), null, "above the band → device voice");
assert.strictEqual(paceFigureById("pf-sec-05")?.text, "five seconds per kilometre.");

const libraryIds = new Set(Object.values(PHRASE_LIBRARY).flat().map((p) => p.id));
for (const p of PACE_FIGURES) {
  assert.ok(!libraryIds.has(p.id), `${p.id} shadows a library phrase`);
}

console.log("paceFigures: 13 + 60 clips, words, lookup and id isolation — passed");
