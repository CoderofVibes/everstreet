// Job 003u: a disposable local preview of digital performance evidence for an acquirer. A
// published digital business with recorded fictional customer uses, listed privately to two
// fictional buying teams whose evidence requests are pending: Fenn Holdings asked for digital
// performance, Ruiz Ventures only for financials. The owner decides in the browser.
//
//   npm run web:build
//   npx tsx scripts/preview-evidence.ts
//
// FICTIONAL and SYNTHETIC (scripts/lib/evidencePreview.ts): an in-memory database, the real app
// and routes, the labelled customer chain double, contract fixture sale views and a preview-only
// synthetic signer. No buyer is contacted; no wallet, model, NEAR endpoint, credentials or runtime
// database; nothing leaves this computer. Listeners on 127.0.0.1 only: the site on :8824 and the
// controls on :8825. Ctrl+C ends it.

import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { DEAL_CONTROLS, type DealControl } from "./lib/acquisitionPreview.ts";
import { evidencePreview } from "./lib/evidencePreview.ts";

const HOST = "127.0.0.1";
const p = await evidencePreview();
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
    '<head><script src="/__preview/label.js"></script><script src="/__preview/authorizer.js"></script>',
  );
  return c.html(html);
});
serve({ fetch: site.fetch, port: 8824, hostname: HOST });

const control = new Hono();
control.get("/", (c) => c.json(p.controls.summary()));
control.post("/maintenance/pass", async (c) => c.json(await p.controls.pass()));
control.post("/use", async (c) => c.json({ use: await p.controls.use() }));
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
control.post("/legacy-payments/:shape", (c) => {
  const s = c.req.param("shape") as (typeof p.legacyShapes)[number];
  if (!p.legacyShapes.includes(s)) return c.json({ error: "unknown shape" }, 400);
  return c.json(p.legacyPayments(s));
});
serve({ fetch: control.fetch, port: 8825, hostname: HOST });

console.log("Evidence preview: FICTIONAL, SYNTHETIC, in memory. Nothing is real or sent.");
console.log(`  Seller (Ava):  http://${HOST}:8824/desk/${p.businessId}/sale   grant or decline`);
console.log(
  `  Fenn's room:   http://${HOST}:8824/acquire/room/${p.requests.fenn}   (act as Noah Fenn (buyer))`,
);
console.log(
  `  Ruiz's room:   http://${HOST}:8824/acquire/room/${p.requests.ruiz}   (act as Ana Ruiz (buyer))`,
);
console.log(`  Sale:          http://${HOST}:8824/desk/${p.businessId}/handover   (fixture views)`);
console.log(`  Controls: http://${HOST}:8825/  GET state; POST /maintenance/pass, /use,`);
console.log(`            /deal/${DEAL_CONTROLS.join("|")}`);
console.log(
  `  Customers summary (003u2): http://${HOST}:8824/acquire/room/${p.requests.marsh}   (act as Cole Marsh (buyer); Ava grants first)`,
);
console.log(
  `            POST /legacy-payments/${p.legacyShapes.join("|")}  (starts as small: 4 orders, 3 delivered, 1 refunded)`,
);
