// Job 005b: a disposable local preview of helper access: authorized, revoked while open, re-granted,
// revoked on the contract only, support only, an unreachable contract, and a real sale on the
// contract double.
//
//   npm run web:build
//   npx tsx scripts/preview-helper.ts
//
// FICTIONAL and SYNTHETIC (scripts/lib/helperPreview.ts). No wallet, NEAR endpoint, provider,
// credentials or runtime database; nothing leaves this computer. Listeners on 127.0.0.1 only: the
// site on :8852 and the controls on :8853. Ctrl+C ends it.

import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { HELPER_CONTROLS, type HelperControl, helperPreview } from "./lib/helperPreview.ts";

const HOST = "127.0.0.1";
const p = await helperPreview();
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
    '<head><script src="/__preview/label.js"></script>',
  );
  return c.html(html);
});
serve({ fetch: site.fetch, port: 8852, hostname: HOST });

const control = new Hono();
control.get("/", (c) => c.json(p.controls.summary()));
control.post("/:control", async (c) => {
  const k = c.req.param("control") as HelperControl;
  if (!HELPER_CONTROLS.includes(k)) return c.json({ error: "unknown control" }, 400);
  const r = await p.controls.run(k);
  return c.json({ control: k, status: r?.status, result: r?.body, state: p.controls.summary() });
});
serve({ fetch: control.fetch, port: 8853, hostname: HOST });

console.log("Helper preview: FICTIONAL, SYNTHETIC, in memory. Nothing is real or sent.");
console.log(`  Helper page:  http://${HOST}:8852/help/${p.businessId}   (act as Ellis Grant)`);
console.log(`  People: Mara ${p.people.mara} (owner) · Ellis ${p.people.ellis} (helper) ·`);
console.log(
  `          Bea ${p.people.bea} (unrelated) · Ana ${p.people.ana} (buyer) · Sam (customer)`,
);
console.log(`  Controls: http://${HOST}:8853/  GET state; POST /${HELPER_CONTROLS.join(" /")}`);
console.log(
  "    contract-revoke, support-only, outage and restore change only the contract double.",
);
console.log(
  "    sale: Mara accepts the co-op's deal (a real close on the double); Ana then owns it.",
);
