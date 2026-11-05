// Job 003wf2 (docs/design/DIRECT_SALE.md): a FINITE, no-network browser review of a Direct sale
// through each participant's own (synthetic) wallet, in the normal app composition.
//
//   npm run web:build
//   npx tsx scripts/sale-harness.ts [--minutes 30] [--product relaydesk]
//
// Site: http://127.0.0.1:8814/ . Sign in with the synthetic wallet (it starts as the seller,
// founder.near); the sale page is printed below. Controls on http://127.0.0.1:8815/ (a separate
// listener; no control route exists in the app):
//   POST /account/<id>          the synthetic wallet switches account: founder.near (seller),
//                               buyer.near (buyer) or cara.near (customer); sign out and in again
//                               to act as that person
//   POST /cancel-next           the next wallet window is "closed" by the person
//   POST /lose-next             the next transaction lands but its answer is lost
//   POST /delay-next/<ms>       the next wallet answer arrives late (0 to 30000 ms)
//   POST /fail-next-payout      the next claim's token transfer fails (the claim is restored)
//   POST /advance/<minutes>     the synthetic chain's clock moves forward (e.g. past an expiry)
//   POST /customer-use          one complete customer use by Cara (raises `available`)
//   POST /older-contract | /newer-contract   the business answers without | with the sale capability
//   POST /access/retire-offer   job 003wf4: retire the offer, so Set up customer access needs the founder
//   POST /access/operator/<none|support|metering>   the platform account's operator slot
//   POST /access/guided/<on|off>   the business answers with | without guided plans (get_plan_terms)
//   POST /observations/down | /observations/up   the observation reads fail | work again
//   GET  /                      contract, treasury and who owns the business here
//   GET  /budget                the test doubles' finite budgets: used, and the first one reached
//                               (when one is, every later read fails: restart the harness)
//   GET  /history[?account=<id>]  the synthetic wallet's activity (each transaction's ID and status)
// FICTIONAL and SYNTHETIC (scripts/lib/saleHarness.ts). Loopback only; the page may connect only
// to this harness. It stops by itself after the time bound, or on Ctrl+C; nothing remains.

import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { customerAccessPath, HARNESS_CSP, saleControl, saleHarness } from "./lib/saleHarness.ts";

const HOST = "127.0.0.1";
const PORT = 8814;
const at = process.argv.indexOf("--minutes");
const minutes = at > 0 ? Number(process.argv[at + 1]) : 30;
if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 120) {
  console.error("--minutes must be 1 to 120");
  process.exit(2);
}
// Relaydesk correction (Stage C browser pass): `--product relaydesk` sells Relaydesk instead.
const product = process.argv.includes("--product")
  ? process.argv[process.argv.indexOf("--product") + 1]
  : "ledgerline";
if (product !== "ledgerline" && product !== "relaydesk") {
  console.error("--product must be ledgerline or relaydesk");
  process.exit(2);
}
const h = await saleHarness({ origin: `http://${HOST}:${PORT}`, product });
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
  const html = readFileSync(join(dist, "index.html"), "utf8").replace(
    "<head>",
    '<head><script src="/__harness/label.js"></script><script src="/__harness/wallet.js"></script>',
  );
  return c.html(html, 200, { "content-security-policy": HARNESS_CSP });
});
const app = serve({ fetch: site.fetch, port: PORT, hostname: HOST });
const ctl = serve({ fetch: saleControl(h).fetch, port: PORT + 1, hostname: HOST });
console.log(`Sale review harness (SYNTHETIC wallet and chain, fictional): http://${HOST}:${PORT}/`);
console.log(`  Sale page: http://${HOST}:${PORT}/sales/${h.world.biz}`);
console.log(`  Customer page: http://${HOST}:${PORT}/use/${h.world.offerId}`);
console.log(
  `  Set up customer access (job 003wf4): http://${HOST}:${PORT}${customerAccessPath(h)} (Service, Customer access)`,
);
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
