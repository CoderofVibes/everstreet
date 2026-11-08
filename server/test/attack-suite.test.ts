// The attack suite (scripts/attack-suite.ts) runs and passes, the committed results are its
// format, every recorded case passed, and the public endpoint serves them.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { attackSuite } from "../src/examples.ts";

describe("attack suite", () => {
  it("passes when run now: every attack refused, every planted fault caught", () => {
    const out = execFileSync(
      process.execPath,
      ["--import", "tsx", "scripts/attack-suite.ts", "--check"],
      {
        encoding: "utf8",
        timeout: 240_000,
      },
    );
    expect(out).toMatch(/^OK: (\d+)\/\1 cases, (\d+)\/\2 planted faults caught/m);
  }, 250_000);

  it("the committed results are complete and served publicly", () => {
    const r = JSON.parse(readFileSync("data/evidence/attack-suite.json", "utf8"));
    expect(r).toMatchObject({ format: "everstreet.attack-suite", version: 1, source: "synthetic" });
    expect(r.groups).toHaveLength(10);
    expect(r.cases.every((c: { passed: boolean }) => c.passed)).toBe(true);
    expect(r.planted.every((p: { caught: boolean }) => p.caught)).toBe(true);
    expect(new Set(r.cases.map((c: { group: number }) => c.group)).size).toBe(9);
    // Served as committed, plus the cases that also ran on NEAR testnet (attack-pairs-testnet.json).
    const served = attackSuite() as unknown as typeof r;
    const plain = served.cases.map(({ testnet, ...c }: { testnet?: unknown }) => c);
    expect({ ...served, cases: plain }).toEqual(r);
    const paired = served.cases.filter((c: { testnet?: unknown }) => c.testnet);
    expect(paired.length).toBeGreaterThanOrEqual(5);
    for (const c of paired as { testnet: { explorer: string | null; refusal: string } }[]) {
      expect(c.testnet.refusal).toBeTruthy();
      if (c.testnet.explorer)
        expect(c.testnet.explorer).toMatch(/^https:\/\/testnet\.nearblocks\.io\/txns\//);
    }
  });
});
