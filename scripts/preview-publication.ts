// Job 001d: a disposable local preview of publishing a digital product: Ava drafts, reviews and
// publishes her digital business's public profile; a visitor finds it and opens the product; Bea
// can publish a coming-soon profile for a brief-only product; Dee's legacy class page is unchanged.
//
//   npm run web:build
//   npx tsx scripts/preview-publication.ts
//
// FICTIONAL and SYNTHETIC (scripts/lib/publicationPreview.ts): an in-memory database, the real app
// and routes, the labelled customer chain double, contract fixture views and a preview-only
// synthetic signer. "Publish" here shows the page on this local preview only; nothing leaves this
// computer. Listeners on 127.0.0.1 only: the site on :8826 and the controls on :8827. Ctrl+C ends it.

import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { publicationPreview } from "./lib/publicationPreview.ts";

const HOST = "127.0.0.1";
const p = await publicationPreview();
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
serve({ fetch: site.fetch, port: 8826, hostname: HOST });

const control = new Hono();
control.get("/", (c) => c.json(p.controls.summary()));
control.post("/maintenance/pass", async (c) => c.json(await p.controls.pass()));
serve({ fetch: control.fetch, port: 8827, hostname: HOST });

console.log("Publication preview: FICTIONAL, SYNTHETIC, in memory. Nothing is real or sent.");
console.log(`  Ava's profile editor: http://${HOST}:8826/desk/${p.businesses.digital}/public`);
console.log(
  `  Ava's public page:    http://${HOST}:8826/b/${p.slugs.digital}   (after publishing)`,
);
console.log(`  Bea's editor:         http://${HOST}:8826/desk/${p.businesses.briefOnly}/public`);
console.log(`  Dee's legacy page:    http://${HOST}:8826/b/${p.slugs.legacy}`);
console.log(
  `  Discover (Home):      http://${HOST}:8826/   (the stage features a published product)`,
);
console.log(`  Explore:              http://${HOST}:8826/explore`);
console.log(
  `    Ava ${p.people.ava} · Bea ${p.people.bea} · Dee ${p.people.dee} · Cara ${p.people.cara}`,
);
console.log(`  Controls: http://${HOST}:8827/  GET state; POST /maintenance/pass`);
