// Job 001b: a disposable local preview of the product studio's workspace and navigation, for
// review in a browser.
//
//   npm run web:build
//   npx tsx scripts/preview-studio.ts
//
// FICTIONAL and SYNTHETIC (scripts/lib/studioPreview.ts): an in-memory database and the real app,
// with three product projects made through the real APIs (released with a newer brief; a failed
// release check; a brief only). A scripted runtime, a labelled customer chain double and a
// preview-only signer; building is deliberately not connected. No model, wallet, NEAR endpoint,
// credentials or runtime database. Listeners on 127.0.0.1 only: the site on :8816 and the
// controls on :8817. Ctrl+C ends it and nothing remains.

import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { LOSE_ROUTES, type LoseRoute } from "./lib/customerPreview.ts";
import { studioPreview } from "./lib/studioPreview.ts";

const HOST = "127.0.0.1";
const p = await studioPreview();
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
serve({ fetch: site.fetch, port: 8816, hostname: HOST });

const control = new Hono();
control.get("/", (c) => c.json({ ...p.controls.summary(), projects: p.projects }));
control.post("/lose/:route", (c) => {
  const r = c.req.param("route") as LoseRoute;
  if (!LOSE_ROUTES.includes(r)) return c.json({ error: "unknown route" }, 400);
  p.controls.lose(r);
  return c.json({ lose_next: r });
});
control.post("/provider/fail", (c) => {
  p.controls.providerFails();
  return c.json({ next_run: "provider fails" });
});
serve({ fetch: control.fetch, port: 8817, hostname: HOST });

console.log("Studio preview: FICTIONAL, SYNTHETIC, in memory. Nothing is real or sent.");
console.log("  As Ava Chen (the acting-context menu, local preview):");
console.log(`    Released, newer brief:  http://${HOST}:8816/build/${p.projects.released}`);
console.log(`    Failed release check:   http://${HOST}:8816/build/${p.projects.failed}`);
console.log(`    Empty, brief only:      http://${HOST}:8816/build/${p.projects.draft}`);
console.log(
  `    Customer access:        http://${HOST}:8816/build/${p.projects.released}?view=service&task=customers`,
);
console.log(`    Business desk:          http://${HOST}:8816/desk/${p.businesses.main}`);
console.log(`  People: Ava ${p.people.ava}, Cara ${p.people.cara}, Noah ${p.people.noah}`);
console.log(`  Controls: http://${HOST}:8817/  GET state; POST /lose/${LOSE_ROUTES.join("|")},`);
console.log("            /provider/fail. Try the 390 px Menu and the companion toggle on Service.");
console.log(
  "  Canvas studio (001g): Preview or Brief, then Edit; select a part (Enter), change it in",
);
console.log("  the tools, Escape returns to it; Undo/Redo; Try it adds sample entries again.");
