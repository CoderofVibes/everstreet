// The recording proxy behind scripts/record-tour.ts: it sits in front of the running demo, passes
// every request through unchanged, and keeps what the pages read, per viewer:
//   - every successful GET /api read ("path?query" → the body);
//   - every successful POST to a .../prepare route ("POST path body" → the body). Those are reads
//     made by POST: the server builds the exact request for the person to review and stores nothing;
//   - the routes the page showed.
// Nothing is invented or edited. FICTIONAL and SYNTHETIC, like the demo it records.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";

const HOST = "127.0.0.1";

interface Viewer {
  routes: Set<string>;
  reads: Map<string, unknown>;
}

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

/** A POST the replay may answer: the server prepares a request for review and stores nothing. */
export const isPreparedRead = (method: string, path: string) =>
  method === "POST" && /^\/api\/(sales|companions)\/[^/]+\/prepare$/.test(path);

export function startRecorder(opts: { demo: string; port: number; out: string }) {
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
  const summary = () =>
    Object.fromEntries(
      [...viewers].map(([k, v]) => [k, { routes: v.routes.size, reads: v.reads.size }]),
    );
  const save = () => {
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
    mkdirSync(dirname(opts.out), { recursive: true });
    writeFileSync(opts.out, `${JSON.stringify(out, null, 1)}\n`);
    return { saved: opts.out, viewers: summary() };
  };

  const site = new Hono();
  site.get("/__record/hook.js", (c) => c.body(HOOK, 200, { "content-type": "text/javascript" }));
  site.get("/__record", (c) => c.json({ current, viewers: summary() }));
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
  site.post("/__record/save", (c) => c.json(save()));

  site.all("*", async (c) => {
    const url = new URL(c.req.url);
    const headers = new Headers(c.req.raw.headers);
    headers.delete("host");
    headers.delete("accept-encoding");
    const method = c.req.method;
    const sent = method === "GET" || method === "HEAD" ? undefined : await c.req.text();
    const res = await fetch(`${opts.demo}${url.pathname}${url.search}`, {
      method,
      headers,
      body: sent,
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
    const read = method === "GET" && url.pathname.startsWith("/api/");
    if ((read || isPreparedRead(method, url.pathname)) && res.ok && type.includes("json")) {
      const text = await res.text();
      const key = read
        ? `${url.pathname}${url.search}`
        : `POST ${url.pathname} ${JSON.stringify(JSON.parse(sent || "{}"))}`;
      viewer()?.reads.set(key, JSON.parse(text));
      return new Response(text, { status: res.status, headers: out });
    }
    return new Response(res.body, { status: res.status, headers: out });
  });

  const server = serve({ fetch: site.fetch, port: opts.port, hostname: HOST });
  return {
    url: `http://${HOST}:${opts.port}`,
    setViewer: (name: string) => {
      current = name;
      viewer();
    },
    /** Forgets a viewer (reads made while setting something up, not while walking). */
    dropViewer: (name: string) => viewers.delete(name),
    save,
    summary,
    close: () => server.close(),
  };
}
