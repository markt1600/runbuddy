// The cameo script parser: the model returns "B:/A:" tagged lines, and the
// parser is the seam where a formatting drift (preamble, extra lines, empty
// tags) would silently kill the run's set-piece. The generation itself needs
// an API key; the parsing doesn't.
import assert from "node:assert";

const { parseCameoScript } = await import("../lib/server/generate.ts");

// The happy path: strict B A B A, mapped to the right speakers.
{
  const raw = "B: Oi, who is this coaching you?\nA: Excuse me, this is MY runner.\nB: Pace six-oh-two? Under me, five-thirty.\nA: Under you they'd quit by Tuesday.";
  const lines = parseCameoScript(raw, "coach", "ahbeng");
  assert.strictEqual(lines.length, 4);
  assert.deepStrictEqual(
    lines.map((l) => l.persona),
    ["ahbeng", "coach", "ahbeng", "coach"]
  );
  assert.match(lines[0].text, /^Oi/);
}

// Model chatter around the script is ignored; blank-text tags are dropped.
{
  const raw = "Here is the script:\n\nB: Wah, still running ah?\nA: Ignore him.\nB:   \nnot a line\nA: Back to work.";
  const lines = parseCameoScript(raw, "flirty", "loanshark");
  assert.strictEqual(lines.length, 3);
  assert.strictEqual(lines[0].persona, "loanshark");
  assert.strictEqual(lines[1].persona, "flirty");
}

// More than four lines: capped — the client voice queue holds exactly four.
{
  const raw = Array.from({ length: 7 }, (_, i) => `${i % 2 ? "A" : "B"}: line ${i}`).join("\n");
  assert.strictEqual(parseCameoScript(raw, "coach", "ahlian").length, 4);
}

// Garbage in, empty out — the endpoint turns that into a 503 the client skips.
assert.strictEqual(parseCameoScript("no tags here at all", "coach", "ahbeng").length, 0);

console.log("cameo.parse: passed");
