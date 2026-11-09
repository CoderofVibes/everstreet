// @vitest-environment jsdom
//
// The static proof site (web/src/proofSite.tsx) answers every public read its pages make from a
// build-time file; a page that starts reading something new must be added there, or it would show
// "not part of this copy" once hosted. The check follows the static entry's imports (every
// relative, non-type import, transitively) to the page files it bundles and looks at every "/api/"
// string in them, template strings included (Nov 7 review: the earlier check read three named
// files for string literals). A shared helper that reads a path of its own, not one the page hands
// it, is outside this check; the pages hand their helpers the path.

import { readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { nextAfter, ROUTE, STATIC_READS } from "../src/proofSite.tsx";

/** Source files the static entry reaches through relative imports that bundle code. */
function reachable(entry: string) {
  const seen = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/import\s+(type\s+)?[^;]*?from\s+"(\.{1,2}\/[^"]+)"/g)) {
      if (m[1]) continue; // a type-only import bundles nothing
      const target = resolve(dirname(file), m[2] as string);
      if (/\.tsx?$/.test(target)) walk(target);
      else if (!/\.(json|css)$/.test(target)) walk(`${target}.ts`);
    }
  };
  walk(resolve(entry));
  return [...seen];
}

describe("the static proof site", () => {
  it("has a data file for every read the pages it bundles can make", () => {
    const files = reachable("web/src/proofSite.tsx");
    const pages = files.filter((f) => f.includes(`${sep}pages${sep}`));
    for (const p of ["RecordedProof.tsx", "AttackDocket.tsx", "Showcase.tsx", "HandoffProof.tsx"])
      expect(
        pages.some((f) => f.endsWith(p)),
        p,
      ).toBe(true);
    const reads: string[] = [];
    for (const f of pages) {
      // Every "/api/..." in a string or template literal; a template with an expression is a read
      // this check can't resolve, so it fails here instead of once hosted.
      for (const m of readFileSync(f, "utf8").matchAll(/["`'](\/api\/[^"`']*)["`']/g)) {
        const path = m[1] as string;
        expect(path, `${f}: a read this copy can't answer`).not.toMatch(/\$\{/);
        reads.push(path);
      }
    }
    expect(reads.length).toBeGreaterThan(0);
    for (const r of reads) expect(STATIC_READS[r], r).toMatch(/^\/data\/[a-z]+\.json$/);
  });

  it("answers any other API read with 404, never a call to a server", async () => {
    const r = await fetch("/api/me/dashboard");
    expect(r.status).toBe(404);
    expect(((await r.json()) as { code: string }).code).toBe("static");
  });
});

// Nov 9 (Anthony): one train of proof a judge can follow, each page leading to the next.
describe("the route through the proof", () => {
  it("goes handoff proof, recorded sale, attacks, agents, then the claims table", () => {
    expect(ROUTE.map((r) => r.label)).toEqual([
      "Handoff proof",
      "The recorded sale",
      "What we tried to break",
      "Agents on NEAR testnet",
    ]);
    expect(nextAfter("/proof/ledgerline")).toMatchObject({ step: 2, label: "The recorded sale" });
    expect(nextAfter("/example/ledgerline")).toMatchObject({ step: 3, to: "/attacks" });
    expect(nextAfter("/attacks")?.to).toBe("https://github.com/CoderofVibes/everstreet#for-agents");
    expect(nextAfter("/")).toBeNull();
  });
});
