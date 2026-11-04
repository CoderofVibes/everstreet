// Job 003t: a disposable local preview of Digital operations in the owner's books: fictional
// customer uses recorded this month (charged, returned, settling, reserved, never reserved), runtime
// cost by purpose, an actual sale applied by the app's reconciliation, and the same history for the
// buyer while customers keep their results.
//
//   npm run web:build
//   npx tsx scripts/preview-operations.ts
//
// FICTIONAL and SYNTHETIC (scripts/lib/operationsPreview.ts): an in-memory database, the real app
// and routes, the labelled customer chain double, contract fixture sale views and a preview-only
// synthetic signer. The maintenance worker runs a pass only when POST /maintenance/pass asks. No
// wallet, model, NEAR endpoint, credentials or runtime database; nothing leaves this computer.
// Listeners on 127.0.0.1 only: the site on :8820 and the controls on :8821. Ctrl+C ends it.

import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { DEAL_CONTROLS, type DealControl } from "./lib/acquisitionPreview.ts";
import { operationsPreview } from "./lib/operationsPreview.ts";

const HOST = "127.0.0.1";
const p = await operationsPreview();
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
serve({ fetch: site.fetch, port: 8820, hostname: HOST });

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
control.post("/metering/appoint", (c) => {
  p.controls.appointMetering();
  return c.json({ metering: "the platform is appointed on the synthetic contract" });
});
serve({ fetch: control.fetch, port: 8821, hostname: HOST });

console.log("Operations preview: FICTIONAL, SYNTHETIC, in memory. Nothing is real or sent.");
console.log(`  Owner books: http://${HOST}:8820/desk/${p.businessId}   (act as Ava, then Noah)`);
console.log(`  Sale:        http://${HOST}:8820/desk/${p.businessId}/handover`);
console.log(`  Customer:    http://${HOST}:8820/uses/${p.useId}   (act as Cara)`);
console.log(`    Ava Chen, the owner (founder.near)   ${p.people.ava}`);
console.log(`    Noah Fenn, the buyer (buyer.near)     ${p.people.noah}`);
console.log(`    Cara Okafor, a customer               ${p.people.cara}`);
console.log(`  Controls: http://${HOST}:8821/  GET state; POST /maintenance/pass, /use,`);
console.log(`            /deal/${DEAL_CONTROLS.join("|")}, /metering/appoint`);
