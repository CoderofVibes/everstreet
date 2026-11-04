// Job 001c: a disposable local preview of the digital business desk: a working digital business
// (an active release, recorded customer uses and waiting work, a second brief-only product, an
// imported product and a legacy page offering), a brief-only founder, and a legacy class business.
//
//   npm run web:build
//   npx tsx scripts/preview-desk.ts
//
// FICTIONAL and SYNTHETIC (scripts/lib/deskPreview.ts): an in-memory database, the real app and
// routes, the labelled customer chain double, contract fixture sale views and a preview-only
// synthetic signer. The maintenance worker runs a pass only when POST /maintenance/pass asks. No
// wallet, model, NEAR endpoint, credentials or runtime database; nothing leaves this computer.
// Listeners on 127.0.0.1 only: the site on :8822 and the controls on :8823. Ctrl+C ends it.

import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { deskPreview } from "./lib/deskPreview.ts";

const HOST = "127.0.0.1";
const p = await deskPreview();
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
serve({ fetch: site.fetch, port: 8822, hostname: HOST });

const control = new Hono();
control.get("/", (c) => c.json(p.controls.summary()));
control.post("/maintenance/pass", async (c) => c.json(await p.controls.pass()));
control.post("/use", async (c) => c.json({ use: await p.controls.use() }));
serve({ fetch: control.fetch, port: 8823, hostname: HOST });

console.log("Desk preview: FICTIONAL, SYNTHETIC, in memory. Nothing is real or sent.");
console.log(`  Digital desk:     http://${HOST}:8822/desk/${p.businesses.digital}   (act as Ava)`);
console.log(
  `  Brief-only desk:  http://${HOST}:8822/desk/${p.businesses.briefOnly}   (act as Bea)`,
);
console.log(`  Legacy desk:      http://${HOST}:8822/desk/${p.businesses.legacy}   (act as Dee)`);
console.log(`    Ava Chen ${p.people.ava} · Bea ${p.people.bea} · Dee ${p.people.dee}`);
console.log(`  Controls: http://${HOST}:8823/  GET state; POST /maintenance/pass, /use`);
