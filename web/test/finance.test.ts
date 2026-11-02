// Job 003f: chart and comparison rules. Unknown is never zero; gaps are never bridged.

import { describe, expect, it } from "vitest";
import {
  categories,
  compare,
  type FinMonth,
  money,
  niceScale,
  segments,
  yOf,
} from "../src/finance.ts";

const m = (yyyymm: number, profit: number | null, over: Partial<FinMonth> = {}): FinMonth => ({
  yyyymm,
  label: `M${yyyymm}`,
  coverage: "complete",
  complete: true,
  chain: profit === null ? "unavailable" : "observed",
  chain_reason: null,
  revenue_cents: profit,
  revenue_basis: profit === null ? "unknown" : "observed",
  seeded_cents: null,
  mixed: false,
  direct_cents: 0,
  overhead_cents: 0,
  profit_cents: profit,
  revenue_sources: [],
  cost_sources: [],
  cash: null,
  ...over,
});

describe("financial chart rules", () => {
  it("unknown money is a dash, never $0", () => {
    expect(money(null)).toBe("—");
    expect(money(undefined)).toBe("—");
    expect(money(0)).toBe("$0.00");
    expect(money(-12345)).toBe("−$123.45");
  });

  it("the axis always includes zero and covers negatives", () => {
    const s = niceScale([12_000, -3_000, null]);
    expect(s.min).toBeLessThanOrEqual(-3_000);
    expect(s.max).toBeGreaterThanOrEqual(12_000);
    expect(s.ticks).toContain(0);
    expect(yOf(s, s.max, 100)).toBe(0);
    expect(yOf(s, s.min, 100)).toBe(100);
  });

  it("an empty or all-zero chart still has a usable axis", () => {
    for (const v of [[], [0, 0], [null, null]]) {
      const s = niceScale(v);
      expect(s.max).toBeGreaterThan(s.min);
      expect(s.ticks.length).toBeGreaterThan(1);
    }
  });

  it("the contribution line breaks at unknown months instead of bridging them", () => {
    const parts = segments([m(1, 100), m(2, 200), m(3, null), m(4, 50)]);
    expect(parts.map((p) => p.map((x) => x.index))).toEqual([[0, 1], [3]]);
  });

  it("comparisons explain missing, partial, zero and negative baselines", () => {
    expect(compare(m(1, null), m(2, 500))).toMatch(/Can't compare: M1 couldn't be read/);
    expect(compare(m(1, 100), m(2, 500, { coverage: "current_partial" }))).toMatch(
      /isn't a whole month/,
    );
    expect(compare(m(1, 0), m(2, 500))).toMatch(/no percentage from a zero baseline/);
    expect(compare(m(1, -200), m(2, 100))).toMatch(
      /no percentage: that month's contribution was negative/,
    );
    expect(compare(m(1, 1_000), m(2, 1_500))).toBe("+50% ($10.00 in M1 → $15.00 in M2).");
    expect(compare(undefined, m(2, 1))).toMatch(/Not enough months/);
  });

  it("cost categories add up across months, largest first", () => {
    const lines = (cat: string, cents: number) => ({
      kind: "direct" as const,
      label: cat,
      cents,
      source: "Founder supplied",
      category: cat,
    });
    const out = categories([
      m(1, 0, { lines: [lines("Hosting and compute", 300), lines("AI model usage", 100)] }),
      m(2, 0, { lines: [lines("AI model usage", 500)] }),
    ]);
    expect(out.map((c) => [c.category, c.cents])).toEqual([
      ["AI model usage", 600],
      ["Hosting and compute", 300],
    ]);
    expect(out[0]?.share).toBeCloseTo(600 / 900);
  });
});
