// Job 003w-e (APPLICATION_COMPOSITION §9.8): a FINITE, no-network browser review of wallet sign-in and
// the customer's device key, with the production controllers and a synthetic wallet module.
//
//   npm run web:build
//   npx tsx scripts/wallet-harness.ts [--minutes 30] [--seeded]
//   (default: a FRESH customer, Dana, who buys uses first; --seeded: Cara with 100 units)
//
// Site: http://127.0.0.1:8814/ (sign in, then open /use/<offer>, printed below). Controls on
// http://127.0.0.1:8815/ (a separate listener; no control route exists in the app):
//   POST /cancel-next   the next wallet window is "closed" by the person
//   POST /lose-next     the next transaction lands but its answer is lost
//   POST /delay-next/<ms>  the next wallet answer arrives late (0 to 30000 ms)
//   POST /account/<id>  the synthetic wallet switches to another (fictional) account
//   GET  /             what the synthetic wallet signed and sent
//   GET  /history[?account=<id>]  the synthetic wallet's activity, newest first: each recorded
//                      transaction's ID, signer, receiver, method and its own status (read-only;
//                      e.g. the original ID of a purchase whose answer /lose-next withheld)
// FICTIONAL and SYNTHETIC (scripts/lib/walletHarness.ts): in-memory data, the real app and routes
// with verified identity, ephemeral keys, the chain double. Loopback only. It stops by itself after
// the time bound, or on Ctrl+C; nothing remains.

import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { HARNESS_CSP, harnessControl, walletHarness } from "./lib/walletHarness.ts";

const HOST = "127.0.0.1";
const PORT = 8814;
const at = process.argv.indexOf("--minutes");
const minutes = at > 0 ? Number(process.argv[at + 1]) : 30;
if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 120) {
  console.error("--minutes must be 1 to 120");
  process.exit(2);
}
// Job 003web: a FRESH customer (Dana: no units, no key, her own fictional test tokens) by
// default; --seeded keeps the earlier journey (Cara: 100 units and a fixture key).
const h = await walletHarness({
  origin: `http://${HOST}:${PORT}`,
  customer: process.argv.includes("--seeded") ? "seeded" : "fresh",
});
const dist = "web/dist";
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const site = new Hono();
site.route("/", h.site);
site.get("*", (c) => {
  if (!existsSync(dist)) return c.text("Run `npm run web:build` first.", 503);
  const path = normalize(c.req.path).replace(/^([/\\])+/, "");
  const file = join(dist, path);
  if (path && !path.includes("..") && existsSync(file) && extname(file))
    return c.body(readFileSync(file), 200, {
      "content-type": types[extname(file)] ?? "application/octet-stream",
    });
  // The built app, with the harness label and the synthetic wallet MODULE before it.
  const html = readFileSync(join(dist, "index.html"), "utf8").replace(
    "<head>",
    '<head><script src="/__harness/label.js"></script><script src="/__harness/wallet.js"></script>',
  );
  // No network (Astra's DeviceKeyReview): the browser may connect ONLY to this harness, so the
  // Wallet Selector's default testnet RPC or any other outbound request is refused by the page's
  // own policy. The harness server itself makes no outbound requests.
  return c.html(html, 200, { "content-security-policy": HARNESS_CSP });
});
const app = serve({ fetch: site.fetch, port: PORT, hostname: HOST });

const control = harnessControl(h);
const ctl = serve({ fetch: control.fetch, port: PORT + 1, hostname: HOST });

console.log(
  `Wallet review harness (SYNTHETIC wallet and chain, fictional): http://${HOST}:${PORT}/`,
);
console.log(`  Customer product: http://${HOST}:${PORT}/use/${h.offerId}`);
console.log(`  Controls: http://${HOST}:${PORT + 1}/   Stops in ${minutes} min or on Ctrl+C.`);
let ending = false;
const end = () => {
  if (ending) return;
  ending = true;
  app.close();
  ctl.close();
  process.exit(0);
};
setTimeout(end, minutes * 60_000).unref();
process.on("SIGINT", end);
process.on("SIGTERM", end);
