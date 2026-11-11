// Builds the static site into web/dist-proof (web/src/proofSite.tsx): the front end, then the data
// files its pages read. The two proof files are written from the same functions the server answers
// with (each serves nothing from a record whose digests don't verify); the guided tour's file is
// the committed recording of the demo (data/tour/recording.json). Then fallbacks so a static host serves
// the page for every route (it must sit at the domain root: `base` is `/`), and a manifest of what
// went in.
//
//   npx tsx scripts/build-proof-site.ts
//   npx vite preview --config web/vite.proof.config.ts     (http://localhost:8830)

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { attackSuite, ledgerlineExample } from "../server/src/examples.ts";
import { SECRETISH } from "../server/src/rehearsalRecord.ts";
import { tourData } from "./lib/tourData.ts";

const OUT = join("web", "dist-proof");

execFileSync(
  process.execPath,
  [join("node_modules", "vite", "bin", "vite.js"), "build", "--config", "web/vite.proof.config.ts"],
  { stdio: "inherit" },
);
renameSync(join(OUT, "proof.html"), join(OUT, "index.html"));

// The proof pages read the committed testnet evidence; the guided tour reads the committed recording
// of the demo (the app's own answers, kept by scripts/record-tour.ts).
const data = {
  "ledgerline.json": ledgerlineExample(),
  "attacks.json": attackSuite(),
  "tour.json": tourData(),
};
mkdirSync(join(OUT, "data"), { recursive: true });
for (const [name, value] of Object.entries(data)) {
  const text = `${JSON.stringify(value)}\n`;
  if (SECRETISH.test(text)) throw new Error(`${name} would contain key or token material`);
  writeFileSync(join(OUT, "data", name), text);
}

// Every route serves the page: Cloudflare Pages and Netlify read _redirects, Vercel vercel.json,
// GitHub Pages serves 404.html for an unknown path (the page itself, so the router takes over).
// A host with none of these answers 404 to a deep link; serve index.html for every route there.
writeFileSync(join(OUT, "_redirects"), "/*  /index.html  200\n");
writeFileSync(join(OUT, "404.html"), readFileSync(join(OUT, "index.html")));
// noindex on every path: the copy is a proof to open from the README, not a page to be found by search.
const vercel = {
  headers: [{ source: "/(.*)", headers: [{ key: "X-Robots-Tag", value: "noindex" }] }],
  rewrites: [{ source: "/((?!data/|assets/).*)", destination: "/index.html" }],
};
writeFileSync(join(OUT, "vercel.json"), `${JSON.stringify(vercel, null, 2)}\n`);

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });

// Nothing secret leaves in any file: key and token shapes, and no value from a local .env (read here,
// never printed). Stops the build and names the file, not the match.
const TOKENISH =
  /-----BEGIN [A-Z ]*PRIVATE KEY|VERCEL_OIDC_TOKEN|gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9_-]{20,}/;
const envValues = [".env", ".env.local"]
  .filter((f) => existsSync(f))
  .flatMap((f) => readFileSync(f, "utf8").split(/\r?\n/))
  .map((l) =>
    l.replace(/^\s*(export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*/, "").replace(/^["']|["']$/g, ""),
  )
  .filter((v) => v.length >= 8);
for (const p of files(OUT)) {
  if (/(^|[\\/])\.env/.test(relative(OUT, p))) throw new Error(`${p} is an env file`);
  const text = readFileSync(p, "latin1");
  if (SECRETISH.test(text) || TOKENISH.test(text) || envValues.some((v) => text.includes(v)))
    throw new Error(`${p} would contain key or token material`);
}
const commit = execFileSync("git", ["rev-parse", "HEAD"]).toString().trim();
const manifest = {
  format: "everstreet.proof-site",
  commit,
  built_at: new Date().toISOString(),
  files: files(OUT)
    .filter((p) => !p.endsWith("manifest.json"))
    .map((p) => ({
      path: relative(OUT, p).replaceAll("\\", "/"),
      sha256: createHash("sha256").update(readFileSync(p)).digest("hex"),
    })),
};
writeFileSync(join(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`✓ ${OUT}: ${manifest.files.length} files at ${commit.slice(0, 7)}`);
