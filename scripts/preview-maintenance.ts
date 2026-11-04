// Job 002d: a disposable local preview of customer maintenance: a customer use that reaches its
// charged evidence without a settle click once the background worker runs, cleanup, and the
// worker's stopped / running / attention states in the owner's Customer access readiness.
//
//   npm run web:build
//   npx tsx scripts/preview-maintenance.ts
//
// FICTIONAL and SYNTHETIC (scripts/lib/maintenancePreview.ts). The worker starts ONLY when you
// POST /maintenance/start to the controls. Listeners on 127.0.0.1 only: the site on :8818 and the
// controls on :8819. POST /maintenance/stop stops the worker; Ctrl+C ends everything.

import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { LOSE_ROUTES, type LoseRoute } from "./lib/customerPreview.ts";
import { maintenancePreview } from "./lib/maintenancePreview.ts";

const HOST = "127.0.0.1";
const p = await maintenancePreview();
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
serve({ fetch: site.fetch, port: 8818, hostname: HOST });

const control = new Hono();
control.get("/", (c) => c.json(p.controls.summary()));
control.post("/maintenance/start", (c) => {
  p.controls.start();
  return c.json({ maintenance: "started" });
});
control.post("/maintenance/stop", async (c) => {
  await p.controls.stop();
  return c.json({ maintenance: "stopped" });
});
control.post("/maintenance/pass", async (c) => c.json(await p.controls.pass()));
control.post("/writer/hang", (c) => {
  p.controls.hangWriter();
  return c.json({ writer: "settle and release never answer" });
});
control.post("/writer/heal", (c) => {
  p.controls.healWriter();
  return c.json({ writer: "answers again" });
});
control.post("/sale", (c) => {
  p.controls.sale();
  return c.json({ sold_to: "Noah Fenn" });
});
control.post("/hold/expire", (c) => {
  p.controls.expireHold();
  return c.json({ clock: "+11 minutes" });
});
control.post("/lose/:route", (c) => {
  const r = c.req.param("route") as LoseRoute;
  if (!LOSE_ROUTES.includes(r)) return c.json({ error: "unknown route" }, 400);
  p.controls.lose(r);
  return c.json({ lose_next: r });
});
serve({ fetch: control.fetch, port: 8819, hostname: HOST });

console.log("Maintenance preview: FICTIONAL, SYNTHETIC, in memory. Nothing is real or sent.");
console.log(`  Customer: http://${HOST}:8818/use/${p.offerId}   (act as Cara)`);
console.log(
  `  Owner:    http://${HOST}:8818/build/${p.w.f.project}?view=service&task=customers   (act as Ava)`,
);
console.log(`  Controls: http://${HOST}:8819/  GET state; POST /maintenance/start|stop|pass,`);
console.log("            /writer/hang|heal, /sale, /hold/expire, /lose/<route>");
console.log("  The worker is NOT running until POST /maintenance/start.");
