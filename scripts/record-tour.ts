// Records the guided tour's data (the static proof site's app pages, web/src/proofSite.tsx).
//
// A local proxy in front of the running demo (`npm run demo`): every page is the demo's own, and
// every successful GET /api read the pages make while someone walks them is kept, with the routes
// visited, per viewer. Nothing is invented or edited: the static site later answers the same reads
// with the same bodies and refuses everything else. FICTIONAL and SYNTHETIC, like the demo itself.
//
//   npm run demo                              (the demo on 8820, its controls on 8821)
//   npx tsx scripts/record-tour.ts            (this proxy on 8852)
//   POST http://127.0.0.1:8852/__record/viewer/delphine   name who is about to browse
//   open http://127.0.0.1:8852/ , sign in, walk every page and tab the tour should hold
//   POST http://127.0.0.1:8852/__record/save  writes data/tour/recording.json
//
// To record another viewer: POST http://127.0.0.1:8821/account/<account>, name the viewer here,
// then sign out and in again in the browser. Listens on 127.0.0.1 only. Ctrl+C ends it.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { Hono } from "hono";

const HOST = "127.0.0.1";
const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const DEMO = `http://${HOST}:${arg("--demo", 8820)}`;
const PORT = arg("--port", 8852);
const OUT = "data/tour/recording.json";

interface Viewer {
  routes: Set<string>;
  reads: Map<string, unknown>;
}
const viewers = new Map<string, Viewer>();
let current: string | null = null;
const viewer = () => {
  if (!current) return null;
  let v = viewers.get(current);
  if (!v) {
    v = { routes: new Set(), reads: new Map() };
    viewers.set(current, v);
  }
  return v;
};

// The page reports each route it shows (a full load, a pushed link, back and forward).
const HOOK = `// Recording only: reports the routes walked. Never part of the app bundle.
(() => {
  const report = () => fetch("/__record/route", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: location.pathname }) }).catch(() => {});
  for (const k of ["pushState", "replaceState"]) {
    const real = history[k].bind(history);
    history[k] = (...a) => { const r = real(...a); report(); return r; };
  }
  addEventListener("popstate", report);
  report();
})();
`;

const site = new Hono();
site.get("/__record/hook.js", (c) => c.body(HOOK, 200, { "content-type": "text/javascript" }));
site.get("/__record", (c) =>
  c.json({
    current,
    viewers: Object.fromEntries(
      [...viewers].map(([k, v]) => [k, { routes: [...v.routes].sort(), reads: v.reads.size }]),
    ),
  }),
);
site.post("/__record/viewer/:name", (c) => {
  current = c.req.param("name");
  viewer();
  return c.json({ current });
});
site.post("/__record/route", async (c) => {
  const { path } = (await c.req.json()) as { path?: string };
  if (typeof path === "string" && path.startsWith("/")) viewer()?.routes.add(path);
  return c.json({ ok: true });
});
site.post("/__record/save", (c) => {
  const sorted = <T>(m: Map<string, T>) =>
    Object.fromEntries([...m].sort(([a], [b]) => a.localeCompare(b)));
  const out = {
    format: "everstreet.tour-recording",
    note: "The demo's own answers (npm run demo: simulated history, fictional people, synthetic chain), kept while its pages were walked. Recorded by scripts/record-tour.ts.",
    recorded_at: new Date().toISOString(),
    commit: execFileSync("git", ["rev-parse", "HEAD"]).toString().trim(),
    viewers: Object.fromEntries(
      [...viewers].map(([k, v]) => [k, { routes: [...v.routes].sort(), reads: sorted(v.reads) }]),
    ),
  };
  mkdirSync("data/tour", { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
  return c.json({
    saved: OUT,
    viewers: Object.fromEntries(
      Object.entries(out.viewers).map(([k, v]) => [
        k,
        { routes: v.routes.length, reads: Object.keys(v.reads).length },
      ]),
    ),
  });
});

site.all("*", async (c) => {
  const url = new URL(c.req.url);
  const headers = new Headers(c.req.raw.headers);
  headers.delete("host");
  headers.delete("accept-encoding");
  const method = c.req.method;
  const res = await fetch(`${DEMO}${url.pathname}${url.search}`, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : await c.req.arrayBuffer(),
    redirect: "manual",
  });
  const out = new Headers();
  res.headers.forEach((v, k) => {
    if (!["content-length", "content-encoding", "set-cookie", "transfer-encoding"].includes(k))
      out.set(k, v);
  });
  for (const cookie of res.headers.getSetCookie()) out.append("set-cookie", cookie);
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("text/html")) {
    const html = (await res.text()).replace(
      "<head>",
      '<head><script src="/__record/hook.js"></script>',
    );
    return new Response(html, { status: res.status, headers: out });
  }
  if (method === "GET" && url.pathname.startsWith("/api/") && res.status === 200) {
    const text = await res.text();
    if (type.includes("json"))
      viewer()?.reads.set(`${url.pathname}${url.search}`, JSON.parse(text));
    return new Response(text, { status: 200, headers: out });
  }
  return new Response(res.body, { status: res.status, headers: out });
});

serve({ fetch: site.fetch, port: PORT, hostname: HOST });
console.log(`Recording proxy: http://${HOST}:${PORT}/ (in front of ${DEMO})`);
console.log(`  Name the viewer first: POST http://${HOST}:${PORT}/__record/viewer/<name>`);
