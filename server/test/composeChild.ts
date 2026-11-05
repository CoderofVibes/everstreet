// Job 003w test fixture (never used by the application): a fresh PROCESS running the real
// composition root in configured mode, with a SYNTHETIC testnet RPC (labelled), so a restart can
// be proven across processes rather than by rebuilding objects in one. It runs the entry's own
// logic (serve.ts): "listening" only from the listener's callback; SIGTERM/SIGINT stop it.
//   node --import tsx server/test/composeChild.ts <config.json> <keys.json> <port>
// keys.json: { "<account>|<ed25519:public key>": "full" | "function_call" }

import { readFileSync } from "node:fs";
import { validateConfig } from "../src/appConfig.ts";
import { runServer } from "../src/serve.ts";
import type { FetchLike } from "../src/v3rpc.ts";

const [configFile, keysFile, portText] = process.argv.slice(2) as [string, string, string];
const config = validateConfig(JSON.parse(readFileSync(configFile, "utf8")));
const keys = JSON.parse(readFileSync(keysFile, "utf8")) as Record<string, string>;
const fetch: FetchLike = async (_url, init) => {
  const req = JSON.parse(init.body) as {
    id: string;
    method: string;
    params: Record<string, unknown>;
  };
  const reply = (body: unknown) =>
    new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, ...(body as object) }), {
      status: 200,
    });
  if (req.method === "block")
    return reply({
      result: {
        header: {
          height: 1000,
          hash: "9".repeat(43),
          timestamp_nanosec: String(BigInt(Date.now()) * 1_000_000n),
        },
      },
    });
  const perm = keys[`${req.params.account_id}|${req.params.public_key}`];
  if (req.params.request_type === "view_access_key")
    return perm
      ? reply({ result: { permission: perm === "full" ? "FullAccess" : { FunctionCall: {} } } })
      : reply({ error: { cause: { name: "UNKNOWN_ACCESS_KEY" } } });
  return reply({ result: { error: "synthetic: no such view" } });
};
// Job 003wf1: the normal entry logic itself (server/src/serve.ts), with only the network injected.
const running = runServer(
  config,
  { fetch, fetchLabel: "synthetic RPC (test child)" },
  { log: (l) => console.log(l), error: (l) => console.log(l), exit: (c) => process.exit(c) },
);
process.on("SIGTERM", () => void running.stop());
process.on("SIGINT", () => void running.stop());
