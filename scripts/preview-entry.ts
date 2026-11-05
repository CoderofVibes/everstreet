// Job 003w: a bounded browser-review entry for the NORMAL composition (server/src/compose.ts), not
// a per-feature preview.
//
//   npm run web:build
//   npx tsx scripts/preview-entry.ts preview       (fictional preview sessions, loopback)
//   npx tsx scripts/preview-entry.ts configured    (verified identity, capability inventory)
//
// Both use a fresh temporary directory: the records file, a protected-store root and EPHEMERAL
// random storage keys (configured). Configured mode gets a NETWORK THAT REFUSES EVERY REQUEST
// (labelled "no network (review harness)"), so browsing it can't reach any endpoint; no wallet,
// model, worker or chain is connected; the capability inventory says what is unavailable and
// why. It listens on 127.0.0.1:8870 only. Ctrl+C stops it and removes the temporary directory.
// Pass --keep to keep the directory for a restart check (the path is printed).

import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { validateConfig } from "../server/src/appConfig.ts";
import { composeApplication } from "../server/src/compose.ts";
import type { FetchLike } from "../server/src/v3rpc.ts";

const mode = process.argv[2] === "configured" ? "configured" : "preview";
const keep = process.argv.includes("--keep");
const reuse = process.argv.indexOf("--dir");
const PORT = 8870;
const dir =
  reuse > 0
    ? (process.argv[reuse + 1] as string)
    : mkdtempSync(join(tmpdir(), "everstreet-entry-"));
const keysFile = join(dir, "protected-keys.json");
const root = join(dir, "protected");
mkdirSync(root, { recursive: true });
if (reuse < 0) writeFileSync(keysFile, JSON.stringify({ k1: randomBytes(32).toString("base64") }));

const config = validateConfig({
  config_version: 1,
  mode,
  network: "testnet",
  listen: { host: "127.0.0.1", port: PORT },
  database: join(dir, "everstreet.db"),
  web_dist: "web/dist",
  origins: { platform: `http://127.0.0.1:${PORT}`, preview: `http://localhost:${PORT}` },
  ...(mode === "configured"
    ? {
        sign_in: { recipient: "everstreet.local", session_hours: 12 },
        rpc: { endpoint: "https://no-network.review-harness.invalid" },
        customer: { operator_account: "review-operator.testnet" },
        protected_storage: { root, active_key_id: "k1", keys_file: keysFile },
      }
    : {}),
});
const refuseAll: FetchLike = async () => {
  throw new Error("the review harness has no network");
};
const composed = composeApplication(
  config,
  mode === "configured" ? { fetch: refuseAll, fetchLabel: "no network (review harness)" } : {},
);
composed.start();
const server = serve({ fetch: composed.app.fetch, port: PORT, hostname: "127.0.0.1" });
console.log(`Normal composition, ${mode} mode: http://127.0.0.1:${PORT}/  (FICTIONAL, temporary)`);
console.log(`  Capabilities: http://127.0.0.1:${PORT}/api/system/capabilities`);
if (keep || reuse > 0) console.log(`  Data kept in ${dir} (restart with --dir <that path>)`);
const end = async () => {
  server.close();
  await composed.stop();
  if (!keep && reuse < 0)
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  process.exit(0);
};
process.on("SIGINT", end);
process.on("SIGTERM", end);
