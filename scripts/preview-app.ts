// Job 002e: a disposable local preview of the Studio "Web app" view, for review in a browser.
//
//   npm run web:build
//   npx tsx scripts/preview-app.ts                  (no isolated worker: checks say nothing ran)
//   npx tsx scripts/preview-app.ts --wsl <distro>   (ONLY after the reviewed worker setup)
//
// FICTIONAL and SYNTHETIC (scripts/lib/appPreview.ts): an in-memory database and the real app;
// two web app versions made by a SCRIPTED build provider (no model, no spend); the real check
// worker, with the real WSL/Firecracker adapter only when --wsl names a distro (it starts WSL).
// Open the platform at http://127.0.0.1:8858 (previews are served from http://localhost:8858, a
// different site). Listener on 127.0.0.1 only; Ctrl+C ends it and nothing remains.

import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { appPreview } from "./lib/appPreview.ts";

const PORT = 8858;
const at = process.argv.indexOf("--wsl");
const wslDistro = at > 0 ? process.argv[at + 1] : undefined;
const p = await appPreview({ port: PORT, wslDistro });
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
site.route("/", p.api);
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
    '<head><script src="/__preview/label.js"></script>',
  );
  return c.html(html);
});
// Listens on loopback only; "localhost" and "127.0.0.1" are both this listener, as two sites.
serve({ fetch: site.fetch, port: PORT, hostname: "127.0.0.1" });

// The real check worker, one check at a time, while the preview runs.
let running = false;
setInterval(async () => {
  if (running) return;
  running = true;
  try {
    await p.checkWorker.runNext();
  } finally {
    running = false;
  }
}, 1000);

console.log("Web app preview: FICTIONAL, SYNTHETIC, in memory. Nothing is real or sent.");
console.log(
  `  Studio, Web app view (as Ava Chen): http://127.0.0.1:${PORT}/build/${p.projectId}?view=app`,
);
console.log(
  wslDistro
    ? `  Logic checks: the real isolated worker in WSL "${wslDistro}" (reviewed setup required).`
    : "  Logic checks: no isolated worker configured, so each check says nothing ran.",
);
console.log("  Preview frames load from http://localhost:8858 (a separate site). Ctrl+C to end.");
