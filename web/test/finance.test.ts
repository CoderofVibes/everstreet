// Job 003f: chart and comparison rules. Unknown is never zero; gaps are never bridged.

import { describe, expect, it } from "vitest";
import {
  categories,
  compare,
  type FinMonth,
  latestPair,
  money,
  niceScale,
  partialLabel,
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
    expect(parts.map((p) => p.points.map((x) => x.index))).toEqual([[0, 1], [3]]);
  });

  // ---------- job 003f1 ----------

  const preOpening = (n: number) =>
    m(n, 0, {
      coverage: "before_start",
      complete: false,
      chain: "not_applicable",
      revenue_basis: "none",
    });
  const seeded = (n: number, v: number) =>
    m(n, v, { revenue_basis: "seeded", chain: "not_applicable" });

  it("fictional and observed months are separate segments, never one trend", () => {
    const parts = segments([seeded(1, 100), seeded(2, 120), m(3, 90), m(4, 95)]);
    expect(parts.map((p) => [p.series, p.points.map((x) => x.index)])).toEqual([
      ["fictional", [0, 1]],
      ["observed", [2, 3]],
    ]);
  });

  it("months before opening are never joined to the line", () => {
    const parts = segments([preOpening(1), preOpening(2), m(3, 90)]);
    expect(parts.map((p) => p.points.map((x) => x.index))).toEqual([[2]]);
  });

  it("the headline compares adjacent months and never uses a pre-opening month as a $0 baseline", () => {
    const months = [
      preOpening(1),
      m(2, 0, { coverage: "first_partial", complete: false }),
      m(3, 10_000),
    ];
    const [a, b] = latestPair(months);
    expect([a?.yyyymm, b?.yyyymm]).toEqual([2, 3]); // adjacent, not the before-opening month
    expect(compare(a, b)).toMatch(/isn't a whole month/);
    expect(compare(preOpening(1), m(2, 10_000))).toMatch(/before the business's account opened/);
    expect(compare(seeded(1, 100), m(2, 200))).toMatch(/fictional example history/);
  });

  it("partial months are named for what they are", () => {
    expect(partialLabel(m(1, 0, { coverage: "first_partial" }))).toMatch(/opened mid-month/);
    expect(partialLabel(m(1, 0, { coverage: "current_partial" }))).toBe("so far");
    expect(partialLabel(m(1, 0))).toBeNull();
  });

  it("tiny ranges get distinct whole-cent ticks", () => {
    for (const v of [[1], [0, 1, 2], [-1, 1], [3]]) {
      const s = niceScale(v);
      expect(new Set(s.ticks).size).toBe(s.ticks.length);
      expect(s.ticks.every(Number.isInteger)).toBe(true);
      expect(s.ticks.length).toBeGreaterThan(1);
    }
  });

  it("fictional example costs stay out of the founder's categories", () => {
    const line = (cents: number, source: string) => ({
      kind: "direct" as const,
      label: "Hosting and compute",
      cents,
      source,
      category: "Hosting and compute",
    });
    const out = categories([
      m(1, 0, { lines: [line(300, "Founder supplied"), line(900, "Seeded history · fictional")] }),
    ]);
    expect(out.map((c) => c.cents)).toEqual([300]);
    expect(out.fictional_cents).toBe(900);
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
    expect(compare(undefined, m(2, 1))).toMatch(/Nothing before M2 to compare with yet/);
    expect(compare(undefined, undefined)).toMatch(/Not enough months/);
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
