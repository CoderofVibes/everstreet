// Job 003u1: truthful withholding. Astra's two probes at bcf2346 (a secondary-suppressed count of
// 10 was labelled "fewer than 3"; and for [1,1]/2 the complete output identified both small cells
// among all 256 pairs 0..15), plus an exhaustive check of the COMPLETE public projection over a
// bounded family of inputs: no count or set difference of 1 or 2 is ever uniquely determined by
// what is published. Pure functions; finite.

import { describe, expect, it } from "vitest";
import { disclose, type RawPerformance, suppressPartition } from "../src/performanceEvidence.ts";

describe("003u1 Astra's probes", () => {
  it("probe 1: a withheld count is never described with a bound it doesn't meet", () => {
    const s = suppressPartition([1, 10], 11);
    // Whatever is not shown carries no size claim at all.
    expect(JSON.stringify(s)).not.toContain("fewer_than_3");
    expect(s.cells[1]).not.toBe(10);
  });

  it("probe 2: the complete output of [1,1]/2 doesn't identify the first cell among 0..15 pairs", () => {
    const visible = JSON.stringify(suppressPartition([1, 1], 2));
    const possible = new Set<number>();
    for (let a = 0; a <= 15; a++)
      for (let b = 0; b <= 15; b++)
        if (JSON.stringify(suppressPartition([a, b], a + b)) === visible) possible.add(a);
    expect(possible.size).toBeGreaterThan(1);
  });

  it("secondary counts of 3 or more and small totals with several positive cells", () => {
    expect(suppressPartition([1, 10], 11)).toEqual({
      cells: ["withheld", "withheld"],
      total: 11,
    });
    expect(suppressPartition([1, 1, 0], 2)).toEqual({
      cells: ["withheld", "withheld", "withheld"],
      total: "withheld",
    });
    expect(suppressPartition([4, 3, 0], 7)).toEqual({ cells: [4, 3, 0], total: 7 });
  });

  it("any small partition: every pair (a, b) whose output is withheld shares it with another a", () => {
    const classes = new Map<string, Set<number>>();
    for (let a = 0; a <= 15; a++)
      for (let b = 0; b <= 15; b++) {
        const k = JSON.stringify(suppressPartition([a, b], a + b));
        const set = classes.get(k) ?? new Set<number>();
        set.add(a);
        classes.set(k, set);
      }
    for (const [k, as] of classes)
      if (k.includes("withheld")) expect(as.size, k).toBeGreaterThan(1);
  });
});

/**
 * A bounded family of whole-business inputs: c charged, r returned (both run), s reserved and
 * not run, n never reserved; m1 of the charged uses were requested (and called) in an earlier
 * month, the rest in the current one, in every possible way. Calls equal runs.
 */
function family(): { raw: RawPerformance; q: Record<string, number> }[] {
  const out: { raw: RawPerformance; q: Record<string, number> }[] = [];
  for (let c = 0; c <= 5; c++)
    for (let r = 0; r <= 4; r++)
      for (let s = 0; s <= 3; s++)
        for (let n = 0; n <= 3; n++)
          for (let m1 = 0; m1 <= c; m1++) {
            const split = m1 > 0;
            const requested = c + r + s + n;
            const ran = c + r;
            const m2 = requested - m1;
            const raw: RawPerformance = {
              requested,
              split: [c, r, 0, 0, s, n],
              months: [0, m1, m2],
              ran,
              execution: [c, r, 0],
              current: [0, 0, s, 0],
              calls: [0, m1, ran - m1 < 0 ? 0 : ran - m1],
              unknownCalls: 0,
            };
            out.push({
              raw,
              q: { c, r, s, n, notRun: s + n, m1, m2: split ? m2 : 0 },
            });
          }
  return out;
}

describe("003u1 the complete projection never pins down a small group", () => {
  it("for every published output, no quantity of 1 or 2 is the only value consistent with it", () => {
    const classes = new Map<string, Record<string, Set<number>>>();
    for (const { raw, q } of family()) {
      const key = JSON.stringify(disclose(raw));
      const sets = classes.get(key) ?? {};
      for (const [name, v] of Object.entries(q)) {
        const set = sets[name] ?? new Set<number>();
        set.add(v);
        sets[name] = set;
      }
      classes.set(key, sets);
    }
    let checked = 0;
    for (const [key, sets] of classes)
      for (const [name, values] of Object.entries(sets)) {
        checked++;
        if (values.size === 1) {
          const [only] = [...values];
          expect(only === 1 || only === 2, `${name}=${only} is determined by ${key}`).toBe(false);
        }
      }
    expect(checked).toBeGreaterThan(100);
  });

  it("withheld parts are words with no bound; shown parts are exact", () => {
    const small = disclose({
      requested: 6,
      split: [4, 1, 0, 0, 1, 0],
      months: [0, 0, 6],
      ran: 5,
      execution: [4, 1, 0],
      current: [0, 0, 1, 0],
      calls: [0, 0, 5],
      unknownCalls: 0,
    });
    expect(small.withheld).toBe(true);
    expect(small.requested).toBe(6);
    expect(small.split.every((v) => v === "withheld")).toBe(true);
    expect(small.months.every((v) => v === "withheld")).toBe(true);
    expect(JSON.stringify(small)).not.toMatch(/fewer/i);
    const clear = disclose({
      requested: 9,
      split: [6, 3, 0, 0, 0, 0],
      months: [0, 0, 9],
      ran: 9,
      execution: [6, 3, 0],
      current: [0, 0, 0, 0],
      calls: [0, 0, 9],
      unknownCalls: 0,
    });
    expect(clear.withheld).toBe(false);
    expect(clear.split).toEqual([6, 3, 0, 0, 0, 0]);
  });
});
