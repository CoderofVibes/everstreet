// Job 001h: a disposable local preview of the operating workspace: several months and products,
// a released product whose draft brief is named differently, and an empty digital business.
//
//   npm run web:build
//   npx tsx scripts/preview-workspace.ts
//
// FICTIONAL and SYNTHETIC (scripts/lib/workspacePreview.ts): the operations preview's in-memory
// app plus fictional founder costs and labelled example history for earlier months. Customer uses
// are this month only. No wallet, model, NEAR endpoint, credentials or runtime database; nothing
// leaves this computer. Listeners on 127.0.0.1 only: the site on :8850 and the controls on :8851.
// Ctrl+C ends it.

import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { workspacePreview } from "./lib/workspacePreview.ts";

const HOST = "127.0.0.1";
const p = await workspacePreview();
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
serve({ fetch: site.fetch, port: 8850, hostname: HOST });

const control = new Hono();
control.get("/", (c) => c.json(p.controls.summary()));
control.post("/maintenance/pass", async (c) => c.json(await p.controls.pass()));
control.post("/use", async (c) => c.json({ use: await p.controls.use() }));
serve({ fetch: control.fetch, port: 8851, hostname: HOST });

const d = (view = "") => `http://${HOST}:8850/desk/${p.businesses.main}${view}`;
console.log("Workspace preview: FICTIONAL, SYNTHETIC, in memory. Nothing is real or sent.");
console.log(`  As Ava Chen (${p.people.ava}):`);
console.log(`    Overview:     ${d()}`);
console.log(`    Performance:  ${d("?view=performance")}`);
console.log(`    Products:     ${d("?view=products")}   (released name vs draft brief)`);
console.log(`    Growth:       ${d("?view=growth")}`);
console.log(`    Empty desk:   http://${HOST}:8850/desk/${p.businesses.empty}`);
console.log(`  Controls: http://${HOST}:8851/  GET state; POST /maintenance/pass, /use`);
