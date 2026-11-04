// Job 003u1: evidence scopes are listed by human names everywhere, and every scope the server
// offers has one; an unknown key is shown as itself, never guessed.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCOPE_LABEL, scopeList, scopeName } from "../src/scopes.ts";

describe("003u1 scope names", () => {
  it("names each scope plainly", () => {
    expect(scopeList(["financials", "digital_performance"])).toBe(
      "Financials, Digital performance",
    );
    expect(scopeName("customers")).toBe("Customer activity");
    expect(scopeName("something_new")).toBe("something_new");
  });

  it("covers every category the server can grant", () => {
    const src = readFileSync("server/src/acquire.ts", "utf8");
    const start = src.indexOf("export const CATEGORIES = {");
    const block = src.slice(start, src.indexOf("} as const;", start));
    const keys = [...block.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThanOrEqual(5);
    for (const k of keys) expect(SCOPE_LABEL[k as string], k).toBeDefined();
  });
});
