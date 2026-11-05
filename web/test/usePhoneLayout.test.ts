// Job 003wea (Astra's WalletBrowserRepeat at 390px: document client 375, scroll 447). A STATIC
// check of the stylesheet: the customer page's grid tracks may shrink, long labels and exact
// values wrap, and nothing on the page is hidden or truncated to fit. It is not a rendered
// measurement (no layout here): the actual 390px repeat is Astra's browser review.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const phone = (css.match(/@media \(max-width: 760px\) \{[^@]*/g) ?? []).join("\n");

describe("003wea the customer page fits a phone without hiding anything", () => {
  it("grid tracks can shrink below their content", () => {
    expect(css).toMatch(/\.use-grid > \*[^{]*\{[^}]*min-width: 0/);
    expect(phone).toMatch(/\.use-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/);
    expect(phone).toMatch(/\.use-terms \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  });

  it("long button labels, hex keys and the raw request wrap", () => {
    expect(css).toMatch(/\.use-page \.btn \{[^}]*white-space: normal/);
    expect(css).toMatch(/\.use-page \.mono, \.use-page p[^{]*\{[^}]*overflow-wrap: anywhere/);
  });

  it("no customer-page rule hides overflow or truncates text", () => {
    const rules = css.match(/[^{}]*\.use-[^{}]*\{[^}]*\}/g) ?? [];
    for (const r of rules) {
      expect(r).not.toMatch(/overflow(-x)?:\s*hidden/);
      expect(r).not.toMatch(/text-overflow:\s*ellipsis/);
    }
    expect(rules.length).toBeGreaterThan(20);
  });
});
