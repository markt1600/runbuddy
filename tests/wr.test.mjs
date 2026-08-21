// Preset-target phrase coverage. Every preset distance must have its full
// pre-rendered set for every persona: the 10 progress checkpoints, and one
// world-record line per gender (the coach falls back to silence when a line
// is missing — a hole here is inaudible in the field until someone runs that
// exact target). Plus the WR maths the firing times come from.
import assert from "node:assert";

const { PHRASE_LIBRARY } = await import("../lib/phrases.ts");
const { TARGET_OPTIONS } = await import("../lib/prefs.ts");
const { HS_RECORDS, MARATHON_WR, hsFinishMs, wrFinishMs } = await import("../lib/records.ts");

const MARKS = [10, 25, 33, 50, 67, 75, 90, 94, 97, 99];
const personas = Object.keys(PHRASE_LIBRARY);
const targets = TARGET_OPTIONS.filter((t) => t > 0);

for (const persona of personas) {
  const all = PHRASE_LIBRARY[persona];

  // ids unique within the persona — duplicates silently shadow each other in
  // the blob store.
  const ids = new Set();
  for (const p of all) {
    assert.ok(!ids.has(p.id), `${persona}: duplicate phrase id ${p.id}`);
    ids.add(p.id);
  }

  for (const target of targets) {
    for (const mark of MARKS) {
      const hits = all.filter(
        (p) => p.category === "progress_km" && p.target === target && p.mark === mark
      );
      assert.strictEqual(
        hits.length,
        1,
        `${persona}: expected 1 progress_km for ${target}km @${mark}%, found ${hits.length}`
      );
    }
    for (const wr of ["male", "female"]) {
      const hits = all.filter(
        (p) => p.category === "wr_finish" && p.target === target && p.wr === wr
      );
      assert.strictEqual(
        hits.length,
        1,
        `${persona}: expected 1 wr_finish (${wr}) for ${target}km, found ${hits.length}`
      );
      // The line must actually contain the record holder's name — the whole
      // point of the phrase is the fact.
      assert.ok(
        hits[0].text.includes(MARATHON_WR[wr].name.split(" ")[1]),
        `${persona}: wr_finish ${wr}/${target} does not name ${MARATHON_WR[wr].name}`
      );
    }
    // High-school record moments exist only where a real record at the exact
    // distance does (5 and 10 km) — and must exist there for both genders.
    for (const wr of ["male", "female"]) {
      const hits = all.filter(
        (p) => p.category === "hs_finish" && p.target === target && p.wr === wr
      );
      if (HS_RECORDS[target]) {
        assert.strictEqual(
          hits.length,
          1,
          `${persona}: expected 1 hs_finish (${wr}) for ${target}km, found ${hits.length}`
        );
        assert.ok(
          hits[0].text.includes(HS_RECORDS[target][wr].name.split(" ")[1]),
          `${persona}: hs_finish ${wr}/${target} does not name ${HS_RECORDS[target][wr].name}`
        );
      } else {
        assert.strictEqual(hits.length, 0, `${persona}: stray hs_finish for ${target}km`);
      }
    }
  }
}

// HS trigger times are the literal race results.
assert.strictEqual(hsFinishMs("male", 5), 806_000); // Simmons 13:26
assert.strictEqual(hsFinishMs("female", 5), 898_000); // Hedengren 14:58
assert.strictEqual(hsFinishMs("male", 10), 1_713_000); // Chapa 28:33
assert.strictEqual(hsFinishMs("female", 10), 1_973_000); // Shea 32:53
assert.strictEqual(hsFinishMs("male", 12), null, "no HS record line for 12km");
// The 10K wrinkle both lines are written around: the 1976 schoolboy finishes
// BEFORE the marathon world-record holder's extrapolated split.
assert.ok(hsFinishMs("male", 10) < wrFinishMs("male", 10), "Chapa no longer pips Kiptum?");

// The trigger-time maths: WR pace × distance. 2:00:35 over 42.195 km puts a
// 10 km finish at 28:35; 2:09:56 puts it at 30:48.
assert.strictEqual(Math.round(wrFinishMs("male", 10) / 1000), 1715);
assert.strictEqual(Math.round(wrFinishMs("female", 10) / 1000), 1848);
// Half marathon: Kiptum just over the hour, Chepngetich ~1:05.
assert.strictEqual(Math.round(wrFinishMs("male", 21.1) / 1000), 3618);
assert.strictEqual(Math.round(wrFinishMs("female", 21.1) / 1000), 3898);
// Monotonic in distance, ordered by record.
for (const t of targets) {
  assert.ok(wrFinishMs("male", t) < wrFinishMs("female", t), `male WR slower at ${t}km?`);
}

console.log(
  `wr.phrases: ${personas.length} personas × ${targets.length} targets covered — passed`
);
