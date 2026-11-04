// Job 003q: a disposable local preview of the customer product workspace, for review in a browser.
//
//   npm run web:build
//   npx tsx scripts/preview-customer.ts
//
// FICTIONAL and SYNTHETIC (scripts/lib/customerPreview.ts): an in-memory database, the real app
// and routes, the labelled chain double (seeded from contract JSON), a scripted extractor, an
// in-memory protection store and a preview-only signer with the contract tests' synthetic key.
// No wallet, model, NEAR endpoint, credentials or runtime database is used; nothing leaves this
// computer. Two listeners on 127.0.0.1 only: the site on :8812 and the controls on :8813 (a
// separate server: no control route exists in the app). Ctrl+C ends it and nothing remains.

import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { customerPreview, type LoseRoute } from "./lib/customerPreview.ts";

const HOST = "127.0.0.1";
const p = await customerPreview();
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
  // The preview's own page: the built app, plus the preview-only authorizer before it.
  const html = readFileSync(join(dist, "index.html"), "utf8").replace(
    "<head>",
    '<head><script src="/__preview/authorizer.js"></script>',
  );
  return c.html(html);
});
serve({ fetch: site.fetch, port: 8812, hostname: HOST });

const control = new Hono();
control.get("/", (c) => c.json(p.controls.summary()));
control.post("/lose/:route", (c) => {
  const r = c.req.param("route") as LoseRoute;
  if (!["prepare", "confirm", "execute", "units"].includes(r))
    return c.json({ error: "unknown route" }, 400);
  p.controls.lose(r);
  return c.json({ lose_next: r });
});
control.post("/storage/fail", (c) => {
  p.controls.storageFails();
  return c.json({ next_result_protection: "fails" });
});
control.post("/hold/expire", (c) => {
  p.controls.expireHold();
  return c.json({ clock: "+11 minutes" });
});
control.post("/key/revoke", (c) => {
  p.controls.revokeKey();
  return c.json({ key: "revoked" });
});
control.post("/provider/fail", (c) => {
  p.controls.providerFails();
  return c.json({ next_run: "provider fails" });
});
control.post("/authorizer/:on", (c) => {
  const on = c.req.param("on") === "on";
  p.controls.authorizer(on);
  return c.json({ authorizer: on ? "on" : "off" });
});
control.post("/sale", (c) => {
  p.controls.sale();
  return c.json({ sold_to: "Noah Fenn", platform: "regranted METERING" });
});
serve({ fetch: control.fetch, port: 8813, hostname: HOST });

console.log(
  "Customer workspace preview: FICTIONAL, SYNTHETIC, in memory. Nothing is real or sent.",
);
console.log(`  Site:     http://${HOST}:8812/b/ledgerline   (Use this product)`);
console.log(`  Direct:   http://${HOST}:8812/use/${p.offerId}`);
console.log("  People (switch with the acting-context menu, local preview):");
console.log(`    Cara Okafor, the customer (100 units)  ${p.people.cara}`);
console.log(`    Ava Chen, the owner                    ${p.people.ava}`);
console.log(`    Noah Fenn, the buyer after /sale       ${p.people.noah}`);
console.log(
  `  Controls: http://${HOST}:8813/  GET state; POST /lose/prepare|confirm|execute|units,`,
);
console.log("            /storage/fail, /hold/expire, /key/revoke, /provider/fail,");
console.log("            /authorizer/off|on, /sale");
