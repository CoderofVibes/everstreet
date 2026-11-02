// Runs OpenSeat on its own: `npm run openseat`. It checks operator authority against the
// business contract named by OPENSEAT_BUSINESS on OPENSEAT_RPC (testnet by default).

import { mkdirSync } from "node:fs";
import { serve } from "@hono/node-server";
import { NearRpcAuthority } from "./authority.ts";
import { seedJuniper } from "./fixture.ts";
import { openSeatApp } from "./http.ts";
import { OpenSeat } from "./service.ts";

const business = process.env.OPENSEAT_BUSINESS;
if (!business) {
  console.error("Set OPENSEAT_BUSINESS to the business contract account (see config/).");
  process.exit(1);
}
const network = process.env.OPENSEAT_NETWORK === "sandbox" ? "sandbox" : "testnet";
const rpc = process.env.OPENSEAT_RPC ?? "https://test.rpc.fastnear.com";
const dbPath = process.env.OPENSEAT_DB ?? "data/runtime/openseat.db";
mkdirSync("data/runtime", { recursive: true });

const service = new OpenSeat({ dbPath, authority: new NearRpcAuthority(network, business, rpc) });
if (process.argv.includes("--seed")) {
  const { maya, sam } = seedJuniper(service);
  console.log(`Seeded: Maya ${maya.ref} (${maya.status}), Sam ${sam.ref} (${sam.status})`);
}
const port = Number(process.env.OPENSEAT_PORT ?? 8790);
serve({ fetch: openSeatApp(service).fetch, port });
console.log(`OpenSeat on http://localhost:${port}, authority ${network} ${business}`);
