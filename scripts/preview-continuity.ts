// Job 003j: a disposable preview for reviewing the Ownership and continuity page in a browser.
//
//   npm run web:build && npx tsx scripts/preview-continuity.ts          (normal states)
//   npx tsx scripts/preview-continuity.ts --paused                       (the paused state)
//
// The scenario (scripts/lib/continuityPreview.ts) is in memory, fictional and SYNTHETIC: the real
// API and the real Rust-produced view JSON, served by an in-memory transport; no NEAR endpoint is
// contacted. This file only adds two listeners, both on 127.0.0.1: the app on :8802, and preview
// controls on :8803 (a separate server, so no control route exists in the app). No keys, secrets,
// runtime data or external requests. Ctrl+C ends it and nothing remains.

import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { continuityPreview, MODES, type PreviewMode } from "./lib/continuityPreview.ts";

const HOST = "127.0.0.1";
const paused = process.argv.includes("--paused");
const p = await continuityPreview({ paused });

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
site.route("/", p.app);
site.get("*", (c) => {
  if (!existsSync(dist)) return c.text("Run `npm run web:build` first.", 503);
  const path = normalize(c.req.path).replace(/^([/\\])+/, "");
  const file = join(dist, path);
  if (path && !path.includes("..") && existsSync(file) && extname(file))
    return c.body(readFileSync(file), 200, {
      "content-type": types[extname(file)] ?? "application/octet-stream",
    });
  return c.html(readFileSync(join(dist, "index.html"), "utf8"));
});
serve({ fetch: site.fetch, port: 8802, hostname: HOST });

const control = new Hono();
control.get("/", (c) => c.json({ mode: p.transport.mode, modes: MODES }));
control.post("/mode/:m", (c) => {
  const m = c.req.param("m") as PreviewMode;
  if (!MODES.includes(m)) return c.json({ error: "unknown mode" }, 400);
  p.transport.mode = m;
  return c.json({ mode: m });
});
control.post("/transfer/:business", (c) => {
  p.transfer(c.req.param("business"));
  return c.json({ moved: c.req.param("business"), to: "Noah Fenn" });
});
serve({ fetch: control.fetch, port: 8803, hostname: HOST });

const page = (id: string) => `http://${HOST}:8802/desk/${id}/continuity`;
console.log(
  `Ownership and continuity preview: fictional, synthetic provenance, in memory${paused ? ", PAUSED" : ""}`,
);
console.log(
  `Act as Mara with the acting-context switcher (local preview), or POST /api/session/as/${p.mara.id}`,
);
console.log(`Unrelated person: Noah Fenn (${p.noah.id})`);
for (const [label, id] of [
  ["Ledgerline Labs: fresh, direct sale accepting, November read", p.ids.ledger],
  ["Harbor Analytics: stale, owner mismatch, conflict flag", p.ids.harbor],
  ["Quayside Agents: gated sale closing", p.ids.quay],
  ["Tidewater Tools: unknown owner mapping, history gap", p.ids.tide],
  ["Quillmark Studio: connected, never read", p.ids.quill],
  ["Northline Tools: not connected", p.ids.north],
] as const)
  console.log(`  ${label}\n    ${page(id)}`);
console.log(
  `Controls: http://${HOST}:8803/  (POST /mode/offline|slow|block_unavailable|ok, POST /transfer/<businessId>)`,
);
