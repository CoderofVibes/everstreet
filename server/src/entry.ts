// Job 003w-a: the normal application entry (docs/design/APPLICATION_COMPOSITION.md §3, §12.5).
//
//   npx tsx server/src/entry.ts --config <absolute path to a config file>
//   (npm run entry -- --config …)
//
// It reads ONE explicit config file, validates it (refusing mainnet and anything malformed before
// any database is opened), composes the application, listens, and only then starts its recovery,
// workers and (if configured) background maintenance (server/src/serve.ts). SIGINT/SIGTERM stop
// everything it started (admission, bounded drain, fence, close) and then the listener. It never
// searches for keys, never starts the legacy OpenSeat worker or v2 signing chain, and prints no
// secret or path from the config's secret sources. The legacy preview (server/src/main.ts) is a
// different program.

import { readFileSync } from "node:fs";
import { validateConfig } from "./appConfig.ts";
import { runServer } from "./serve.ts";

const at = process.argv.indexOf("--config");
const file = at > 0 ? process.argv[at + 1] : undefined;
if (!file) {
  console.error("Usage: entry --config <absolute path to a config file>");
  process.exit(2);
}
let config: ReturnType<typeof validateConfig>;
try {
  config = validateConfig(JSON.parse(readFileSync(file, "utf8")));
} catch (e) {
  console.error(
    (e as Error).message.startsWith("config:") ? (e as Error).message : "config: unreadable",
  );
  process.exit(2);
}
let running: ReturnType<typeof runServer>;
try {
  running = runServer(
    config,
    {},
    {
      log: (l) => console.log(l),
      error: (l) => console.error(l),
      exit: (code) => process.exit(code),
    },
  );
} catch (e) {
  // Composition errors are fixed sentences ("compose: …"); anything else names nothing.
  console.error(
    (e as Error).message.startsWith("compose:") ? (e as Error).message : "startup failed",
  );
  process.exit(1);
}
process.on("SIGINT", () => void running.stop());
process.on("SIGTERM", () => void running.stop());
