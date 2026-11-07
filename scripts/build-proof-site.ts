// Builds the static proof site into web/dist-proof (web/src/proofSite.tsx): the front end, then the
// two data files its pages read, written from the same functions the server answers with (each
// serves nothing from a record whose digests don't verify). Then a fallback so a static host serves
// the page for every route, and a manifest of what went in.
//
//   npx tsx scripts/build-proof-site.ts
//   npx vite preview --config web/vite.proof.config.ts     (http://localhost:8830)

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { attackSuite, ledgerlineExample } from "../server/src/examples.ts";
import { SECRETISH } from "../server/src/rehearsalRecord.ts";

const OUT = join("web", "dist-proof");

execFileSync(
  process.execPath,
  [join("node_modules", "vite", "bin", "vite.js"), "build", "--config", "web/vite.proof.config.ts"],
  { stdio: "inherit" },
);
renameSync(join(OUT, "proof.html"), join(OUT, "index.html"));

const data = {
  "ledgerline.json": ledgerlineExample(),
  "attacks.json": attackSuite(),
};
mkdirSync(join(OUT, "data"), { recursive: true });
for (const [name, value] of Object.entries(data)) {
  const text = `${JSON.stringify(value)}\n`;
  if (SECRETISH.test(text)) throw new Error(`${name} would contain key or token material`);
  writeFileSync(join(OUT, "data", name), text);
}

// Every route serves the page (Cloudflare Pages and Netlify read _redirects; Vercel vercel.json).
writeFileSync(join(OUT, "_redirects"), "/data/*  /data/:splat  200\n/*  /index.html  200\n");
writeFileSync(
  join(OUT, "vercel.json"),
  `${JSON.stringify({ rewrites: [{ source: "/((?!data/|assets/).*)", destination: "/index.html" }] }, null, 2)}\n`,
);

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
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
