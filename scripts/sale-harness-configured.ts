// Job 003wf2 brief item 8: a FINITE browser review of a Direct sale over the CONFIGURED
// COMPOSITION (scripts/lib/configuredSaleHarness.ts): the normal entry (serve.ts runServer →
// composeApplication, configured mode) in its own child process, its RPC and model transports
// answered by this process from one synthetic customer+sale state. Not the fixture app of
// scripts/sale-harness.ts.
//
//   npm run web:build
//   npx tsx scripts/sale-harness-configured.ts [--minutes 30] [--port 8814] [--gated]
//
// --gated (job 003wf3): a Gated sale with the managed handover configured (a fictional closer and
// its ephemeral close_sale-only key; the composition's coordinator passes every second). The
// seller's acceptance starts the closing; the coordinator checks readiness, orders the close and
// reconciles it, and the page's handover panel follows. Extra controls:
//   POST /hold-close | /release-close   the closer's next send waits before it lands | goes on
//
// Site: http://127.0.0.1:<port>/ (default 8814). Sign in with the synthetic wallet (it starts as the
// seller, ava-founder.near). Controls on http://127.0.0.1:<port+1>/ (a separate listener):
//   GET  /                      composition, usage, controls, contract, treasury, capabilities
//   GET  /usage                 the session's explicit budget (RPC requests 25 000, customer chain
//                               calls 4 000, sale double 2 000) and its non-secret counters; the
//                               first limit reached is named in `exhausted` (never a success)
//   GET  /history[?account=<id>]  the synthetic wallet's activity (each transaction's ID and status)
//   POST /account/<id>          ava-founder.near (seller), noah-buyer.near (buyer) or
//                               cara.near (Cara); sign out and in again to act as that person
//   POST /cancel-next | /lose-next | /delay-next/<ms>   the next wallet window closed / its answer
//                               lost after landing / its answer late (0 to 30000 ms)
//   POST /fail-next-payout      the next claim's token transfer fails (the claim is restored)
//   POST /advance/<minutes>     the synthetic contract's clock moves forward (e.g. past expiry)
//   POST /customer-use          one customer use by Cara through the composition's routes
//   POST /older-contract | /newer-contract   the business answers without | with the sale capability
//   POST /rpc/down | /rpc/up    every synthetic RPC answer fails | works again
// It stops by itself after the time bound, or on Ctrl+C: the child stops (admission, drain,
// close), the listeners close and the temporary directory is removed. Nothing remains.

import {
  CONFIGURED_BUYER,
  CONFIGURED_CUSTOMER,
  CONFIGURED_SELLER,
  startConfiguredSaleHarness,
} from "./lib/configuredSaleHarness.ts";

const arg = (name: string, def: number) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? Number(process.argv[at + 1]) : def;
};
const minutes = arg("--minutes", 30);
const port = arg("--port", 8814);
if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 120) {
  console.error("--minutes must be 1 to 120");
  process.exit(2);
}
if (!Number.isInteger(port) || port < 1024 || port > 65_000) {
  console.error("--port must be 1024 to 65000");
  process.exit(2);
}
const gated = process.argv.includes("--gated");
const h = await startConfiguredSaleHarness({ sitePort: port, controlPort: port + 1, gated });
console.log(
  `Configured-composition ${gated ? "Gated (managed handover)" : "Direct"} sale review harness (SYNTHETIC chain and wallet, fictional): ${h.origin}/`,
);
console.log(`  Sale page: ${h.origin}/sales/${h.business}`);
console.log(`  Controls: ${h.control}/   Stops in ${minutes} min or on Ctrl+C.`);
console.log(
  `  Accounts: ${CONFIGURED_SELLER} (seller), ${CONFIGURED_BUYER} (buyer), ${CONFIGURED_CUSTOMER} (customer)`,
);
console.log(`  Application child: ${h.app} (loopback; reached through the site)`);
let ending = false;
const end = async () => {
  if (ending) return;
  ending = true;
  const r = await h.stop();
  console.log(
    `Stopped: application child exit ${r.childExit}${r.forcedKill ? " (forced)" : ""}; temporary directory removed.`,
  );
  process.exit(0);
};
setTimeout(() => void end(), minutes * 60_000).unref();
process.on("SIGINT", () => void end());
process.on("SIGTERM", () => void end());
