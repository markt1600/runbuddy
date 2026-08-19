// Runs every Node-side test. UI drivers under tests/ui/ need a running
// production server and a browser, so they are invoked separately — see
// tests/README.md.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const suites = [
  { file: "geo.sim.mjs", flags: [] },
  { file: "markers.test.mjs", flags: [] },
  { file: "audio.settle.test.mjs", flags: ["--import", path.join(dir, "ts-resolve.mjs")] },
  { file: "audio.duck.test.mjs", flags: ["--import", path.join(dir, "ts-resolve.mjs")] },
  { file: "history.test.mjs", flags: ["--import", path.join(dir, "ts-resolve.mjs")] },
];

let failed = 0;
for (const { file, flags } of suites) {
  console.log(`\n── ${file}`);
  const r = spawnSync(process.execPath, [...flags, path.join(dir, file)], {
    stdio: "inherit",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  if (r.status !== 0) failed++;
}

console.log(failed === 0 ? "\nAll suites passed." : `\n${failed} suite(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
