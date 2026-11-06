// Step 7: writes the dashboard's data, exactly as GET /api/me/dashboard answers it, for Delphine
// Marsh's simulated month (scripts/lib/demo). Designers work from real shapes and real numbers
// (fictional, synthetic) instead of invented ones.
//   npx tsx scripts/demo-sample.ts [out.json]

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { simulatedClock } from "./lib/demo/clock.ts";
import { simulateHistory } from "./lib/demo/history.ts";
import { demoWorld } from "./lib/demo/world.ts";

const out = process.argv[2] ?? "design/dashboard/sample-dashboard.json";
const DAY = 86_400_000;
const dir = mkdtempSync(join(tmpdir(), "everstreet-demo-sample-"));
const today = Math.floor(simulatedClock.realNow() / DAY) * DAY;
const start = today - 30 * DAY;
simulatedClock.install();
simulatedClock.begin(start);
const w = await demoWorld({ dbPath: join(dir, "demo.db") });
await simulateHistory(w, { start });
simulatedClock.realTime();
const d = (await w.delphine("/api/me/dashboard?days=30")).body;
w.db.close();
rmSync(dir, { recursive: true, force: true });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  `${JSON.stringify({ note: "FICTIONAL: Delphine Marsh's simulated month (synthetic chain, stand-in models). Shape of GET /api/me/dashboard.", ...d }, null, 2)}\n`,
);
console.log(`wrote ${out}`);
