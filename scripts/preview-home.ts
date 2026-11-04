// Job 001f2: a disposable local preview for repeating the Home account-switch race and the
// read outages in a browser.
//
//   npm run web:build
//   npx tsx scripts/preview-home.ts
//
// FICTIONAL and SYNTHETIC: the publication preview (scripts/lib/publicationPreview.ts: in-memory
// database, the real app and routes, Ava with a digital business, Bea with a brief-only product,
// Dee's legacy page) behind read faults (scripts/lib/readFaults.ts) that only delay a real answer
// or fail one read once. No model, wallet, NEAR endpoint, credentials or runtime database.
// Listeners on 127.0.0.1 only: the site on :8836 and the controls on :8837. Ctrl+C ends it.

import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { publicationPreview } from "./lib/publicationPreview.ts";
import { FAULT_READS, type FaultRead, readFaults } from "./lib/readFaults.ts";

const HOST = "127.0.0.1";
const p = await publicationPreview();
const faults = readFaults();
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
site.use("/api/*", faults.middleware);
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
serve({ fetch: site.fetch, port: 8836, hostname: HOST });

const control = new Hono();
control.get("/", (c) => c.json(faults.summary()));
control.post("/hold/projects", (c) => {
  faults.hold();
  return c.json(faults.summary());
});
control.post("/release", (c) => c.json({ released: faults.release() }));
control.post("/fail/:read", (c) => {
  const r = c.req.param("read") as FaultRead;
  if (!(r in FAULT_READS)) return c.json({ error: "unknown read" }, 400);
  faults.fail(r);
  return c.json(faults.summary());
});
serve({ fetch: control.fetch, port: 8837, hostname: HOST });

console.log("Home read preview: FICTIONAL, SYNTHETIC, in memory. Nothing is real or sent.");
console.log(`  Home: http://${HOST}:8836/   Build: http://${HOST}:8836/build`);
console.log(`  People: Ava ${p.people.ava} · Bea ${p.people.bea} (acting-context menu)`);
console.log(`  Controls on http://${HOST}:8837/ (GET state):`);
console.log("    POST /hold/projects   hold the next project-list answer (released by /release,");
console.log("                          or after 90 s at most)");
console.log("    POST /release         deliver held answers now");
console.log(
  `    POST /fail/<read>     fail the next read once: ${Object.keys(FAULT_READS).join(", ")}`,
);
console.log("  Race: as Ava on Home, /hold/projects, reload, switch to Bea, /release:");
console.log("  Bea's Continue building must show only Tutor Portal.");
