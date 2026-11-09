// Runs every non-interactive spike in order. The wallet spike (04) needs you to approve in a browser:
// run it separately with `npm run paypal:wallet`.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const scripts = [
  "01-card-hold-partial-capture-refund.mjs",
  "02-card-hold-void.mjs",
  "03-card-decline.mjs",
  "05-payout.mjs",
  "06-channel3.mjs",
];
for (const s of scripts) {
  console.log(`\n===== ${s}`);
  spawnSync(process.execPath, [path.join(dir, s)], { stdio: "inherit", cwd: dir });
}
console.log("\nSummary written to spikes/RESULTS.md");
