// Runs Everstreet on this computer: the API plus the built web app on one port.
//   npm run app        builds the web app, then serves http://localhost:8800
//   npm run dev        API on 8800 with the Vite dev server on 5173 (live reload)

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { everstreetApi } from "./app.ts";
import { openDb } from "./db.ts";
import { Store } from "./store.ts";

const port = Number(process.env.PORT ?? 8800);
mkdirSync("data/runtime", { recursive: true });
const store = new Store(openDb(process.env.EVERSTREET_DB ?? "data/runtime/everstreet.db"));

const app = new Hono();
app.route("/", everstreetApi(store, { localPreview: true, environment: "Local preview" }));

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
app.get("*", (c) => {
  if (!existsSync(dist)) return c.text("Run `npm run app` to build the web app first.", 503);
  const path = normalize(c.req.path).replace(/^([/\\])+/, "");
  const file = join(dist, path);
  if (path && !path.includes("..") && existsSync(file) && extname(file)) {
    return c.body(readFileSync(file), 200, {
      "content-type": types[extname(file)] ?? "application/octet-stream",
    });
  }
  return c.html(readFileSync(join(dist, "index.html"), "utf8"));
});

serve({ fetch: app.fetch, port });
console.log(`Everstreet is running: http://localhost:${port}`);
