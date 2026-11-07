// Job 003t: the Digital operations card's rules. Exact cost formatting (no float), whole-unit
// axes, recorded zero vs unknown cost, and the current month always named "so far".

import { describe, expect, it } from "vitest";
import type { OpsCost, OpsMonth } from "../src/api4.ts";
import {
  booksEmptyMessage,
  costText,
  currentWork,
  describeCost,
  describeUsage,
  intScale,
  microcentsUsd,
  settlementText,
  usageSegments,
} from "../src/operations.ts";
import { when } from "../src/when.ts";

describe("003t1 current work, settlement and the books' empty message say exactly what they count", () => {
  it("current work: every group in the total, named, attention first; nothing waiting is said", () => {
    const w = currentWork({
      awaiting_settlement: 1,
      needs_attention: 2,
      reserved_not_settled: 1,
      awaiting_reservation: 0,
      awaiting_signature: 1,
    });
    expect(w.total).toBe(5);
    expect(w.parts.map((p) => `${p.value} ${p.label}`)).toEqual([
      "2 need attention",
      "1 awaiting settlement (outcome not yet read back)",
      "1 reserved, not yet settled",
      "1 prepared, awaiting the customer's signature",
    ]);
    const none = currentWork({
      awaiting_settlement: 0,
      needs_attention: 0,
      reserved_not_settled: 0,
      awaiting_reservation: 0,
      awaiting_signature: 0,
    });
    expect(none).toEqual({ total: 0, parts: [] });
  });

  it("only a running worker is described as settling by itself", () => {
    const s = (
      worker: "running" | "stopped" | "overdue" | "not_scheduled" | "not_started" | "unknown",
      paused = 0,
    ) =>
      settlementText({
        worker,
        heartbeat_at: "2026-11-04T13:45:10.000Z",
        paused_by_authority: paused,
      });
    expect(s("running")).toContain("settles and returns units by itself");
    expect(s("running")).toContain(when("2026-11-04T13:45:10.000Z"));
    expect(s("running", 2)).toContain("2 paused");
    for (const w of ["stopped", "overdue", "not_scheduled", "not_started", "unknown"] as const)
      expect(s(w)).not.toContain("by itself;");
    // 002d2: a pass run on request is named as such, never as a schedule.
    expect(s("not_scheduled")).toContain("No background worker is scheduled");
    expect(s("not_scheduled")).toContain("ran only when asked");
    expect(s("overdue")).toContain("nothing settles by itself");
    expect(s("not_started")).toContain("No background worker has run");
    expect(s("unknown")).toContain("unknown");
  });

  it("the books' empty message names payments and revenue only and never calls them zero", () => {
    expect(booksEmptyMessage(false)).toMatch(/^No payment or revenue records yet\./);
    expect(booksEmptyMessage(false)).not.toContain("zero");
    expect(booksEmptyMessage(false)).not.toContain("below");
    expect(booksEmptyMessage(true)).toContain(
      "Customer uses and runtime cost from this app's own records are shown below.",
    );
  });
});

const cost = (o: Partial<OpsCost> = {}): OpsCost => ({
  microcents: "0",
  calls: 0,
  unknown_cost_calls: 0,
  unknown_held_cents: 0,
  ...o,
});
const month = (o: Partial<OpsMonth> = {}): OpsMonth => ({
  yyyymm: 202611,
  label: "Nov 2026",
  so_far: false,
  usage: {
    requested: 0,
    charged: 0,
    returned: 0,
    settling: 0,
    needs_attention: 0,
    reserved_unsettled: 0,
    awaiting_reservation: 0,
    never_reserved: 0,
  },
  execution: { ran: 0, usable_result: 0, not_usable: 0, undecided: 0, unknown: 0 },
  cost: { customers: cost(), founder: cost() },
  ...o,
});

describe("003t exact cost formatting", () => {
  it("formats millionths of a cent exactly, past the safe-integer limit", () => {
    expect(microcentsUsd("0")).toBe("$0.00");
    expect(microcentsUsd("1")).toBe("$0.00000001");
    expect(microcentsUsd("150000000")).toBe("$1.50");
    expect(microcentsUsd("123456")).toBe("$0.00123456");
    expect(microcentsUsd("9007199254741004")).toBe("$90,071,992.54741004");
    // A float would have lost the last digits here.
    expect(microcentsUsd("9007199254740993")).toBe("$90,071,992.54740993");
  });

  it("a recorded zero, a known cost and an unknown cost read differently", () => {
    expect(costText(cost())).toBe("no runtime calls (recorded zero)");
    expect(costText(cost({ microcents: "2500", calls: 1 }))).toBe("$0.000025 over 1 call");
    const unknown = costText(cost({ calls: 2, unknown_cost_calls: 1, unknown_held_cents: 3 }));
    expect(unknown).toContain("1 of them with unknown cost (3¢ still reserved)");
    expect(unknown).toContain("not counted as zero");
  });
});

describe("003t axes and month text", () => {
  it("whole-unit ticks that never repeat, covering the largest value", () => {
    for (const max of [0, 1, 3, 7, 10, 999, 123_456]) {
      const s = intScale([max]);
      expect(s.max).toBeGreaterThanOrEqual(max);
      expect(new Set(s.ticks).size).toBe(s.ticks.length);
      expect(s.ticks.every(Number.isInteger)).toBe(true);
      expect(s.ticks[0]).toBe(0);
    }
  });

  it("the current month says so far; an empty month is a recorded zero", () => {
    expect(describeUsage(month({ so_far: true }))).toBe(
      "Nov 2026 (so far): no customer uses requested (recorded zero)",
    );
    const m = month({
      usage: {
        requested: 5,
        charged: 2,
        returned: 1,
        settling: 1,
        needs_attention: 0,
        reserved_unsettled: 0,
        awaiting_reservation: 0,
        never_reserved: 1,
      },
      execution: { ran: 4, usable_result: 3, not_usable: 1, undecided: 0, unknown: 0 },
    });
    expect(describeUsage(m)).toBe(
      "Nov 2026: 5 uses requested (2 charged, 1 returned, 1 awaiting settlement, 0 needing attention, 0 reserved, not yet settled, 1 never reserved); 4 ran: 3 usable, 1 not usable",
    );
    // The segments are exclusive and add up to the requested total.
    expect(usageSegments(m.usage).reduce((a, s) => a + s.value, 0)).toBe(5);
    expect(describeCost(month())).toBe(
      "Nov 2026: serving customers no runtime calls (recorded zero); founder trials and checks no runtime calls (recorded zero)",
    );
  });
});
