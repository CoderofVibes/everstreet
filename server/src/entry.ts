// Job 003w-a: the normal application entry (docs/design/APPLICATION_COMPOSITION.md §3).
//
//   npx tsx server/src/entry.ts --config <absolute path to a config file>
//   (npm run entry -- --config …)
//
// It reads ONE explicit config file, validates it (refusing mainnet and anything malformed before
// any database is opened), composes the application, starts its recovery and workers, and listens.
// SIGINT/SIGTERM stop everything it started and close the listener. It never searches for keys,
// never starts the legacy OpenSeat worker or v2 signing chain, and prints no secret or path from
// the config's secret sources. The legacy preview (server/src/main.ts) is a different program.

import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { validateConfig } from "./appConfig.ts";
import { composeApplication } from "./compose.ts";

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
const composed = composeApplication(config);
composed.start();
// Readiness is reported only once the listener is actually listening; a listen failure stops
// everything and exits non-zero (Astra: the log used to precede the listen).
const server = serve(
  { fetch: composed.app.fetch, port: config.listen.port, hostname: config.listen.host },
  () => {
    console.log(
      `Everstreet (${config.mode}, ${config.network}) listening on http://${config.listen.host}:${config.listen.port}`,
    );
    for (const c of composed.capabilities())
      console.log(`  ${c.state === "on" ? "on " : "off"}  ${c.label}: ${c.detail}`);
  },
);
server.on("error", (err: NodeJS.ErrnoException) => {
  console.error(`listen failed: ${err.code ?? "error"}`);
  void composed.stop().finally(() => process.exit(1));
});
let ending = false;
const end = () => {
  if (ending) return;
  ending = true;
  server.close(() => {
    void composed.stop().finally(() => process.exit(0));
  });
  setTimeout(() => {
    void composed.stop().finally(() => process.exit(0));
  }, 10_000).unref();
};
process.on("SIGINT", end);
process.on("SIGTERM", end);
