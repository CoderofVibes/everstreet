// Job 003s: a disposable local preview of the digital acquisition workspace, for review in a
// browser.
//
//   npm run web:build
//   npx tsx scripts/preview-acquisition.ts            (a Direct sale: proposed → accepting → closed)
//   npx tsx scripts/preview-acquisition.ts --gated    (a Gated sale: closing → closed)
//
// FICTIONAL and SYNTHETIC (scripts/lib/acquisitionPreview.ts): an in-memory database, the real
// app and routes, the contract's own fixture views for the sale, the labelled customer chain
// double and a preview-only synthetic signer for customer uses. No wallet, model, NEAR endpoint,
// credentials or runtime database is used; nothing leaves this computer. The business changes
// hands only through the app's reconciliation. Listeners on 127.0.0.1 only: the site on :8814
// and the controls on :8815 (a separate server). Ctrl+C ends it and nothing remains.

import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { acquisitionPreview, DEAL_CONTROLS, type DealControl } from "./lib/acquisitionPreview.ts";
import { LOSE_ROUTES, type LoseRoute } from "./lib/customerPreview.ts";

const HOST = "127.0.0.1";
const p = await acquisitionPreview({ gated: process.argv.includes("--gated") });
const dist = "web/dist";
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
const site = new Hono();
site.route("/", p.site);
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
    '<head><script src="/__preview/authorizer.js"></script>',
  );
  return c.html(html);
});
serve({ fetch: site.fetch, port: 8814, hostname: HOST });

const control = new Hono();
control.get("/", (c) => c.json(p.controls.summary()));
control.post("/deal/:state", (c) => {
  const s = c.req.param("state") as DealControl;
  if (!DEAL_CONTROLS.includes(s)) return c.json({ error: "unknown state" }, 400);
  try {
    p.controls.deal(s);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
  return c.json({ contract_state: s, note: "Read the contract again in the app to record it." });
});
control.post("/metering/appoint", (c) => {
  p.controls.appointMetering();
  return c.json({ metering: "the platform is appointed on the synthetic contract" });
});
control.post("/lose/:route", (c) => {
  const r = c.req.param("route") as LoseRoute;
  if (!LOSE_ROUTES.includes(r)) return c.json({ error: "unknown route" }, 400);
  p.controls.lose(r);
  return c.json({ lose_next: r });
});
serve({ fetch: control.fetch, port: 8815, hostname: HOST });

console.log("Acquisition preview: FICTIONAL, SYNTHETIC, in memory. Nothing is real or sent.");
console.log(`  Seller:   http://${HOST}:8814/desk/${p.businessId}/handover`);
console.log(`  Buyer:    http://${HOST}:8814/handovers`);
console.log(`  Customer: http://${HOST}:8814/uses/${p.useId}   (one completed use)`);
console.log("  People (switch with the acting-context menu, local preview):");
console.log(`    Ava Chen, the seller (founder.near)     ${p.people.ava}`);
console.log(`    Noah Fenn, the buyer (buyer.near)        ${p.people.noah}`);
console.log(`    Cara Okafor, a customer                  ${p.people.cara}`);
console.log(`  Controls: http://${HOST}:8815/  GET state; POST /deal/${DEAL_CONTROLS.join("|")},`);
console.log(`            /metering/appoint, /lose/${LOSE_ROUTES.join("|")}`);
console.log(
  `  Sale: ${p.gated ? "Gated (closing → closed)" : "Direct (proposed → accepting → closed)"}`,
);
