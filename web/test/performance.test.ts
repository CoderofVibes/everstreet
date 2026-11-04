// Job 003u/003u1: the buyer's Digital performance tab. Withheld figures are the word "Withheld"
// with no size claimed (in text and ARIA alike); not granted, nothing recorded and withheld read
// differently; and the room's view state (per actor, per room, per load) never lets a late
// answer or another person's load bring the section back.

import { describe, expect, it } from "vitest";
import type { PerformanceEvidence, Shown } from "../src/api5.ts";
import { begin, type EvidenceView, initial, settle } from "../src/evidenceView.ts";
import { costShown, describeMonth, performanceState, shownText } from "../src/performance.ts";

const month = (o: Partial<PerformanceEvidence["months"][number]> = {}) => ({
  yyyymm: 202611,
  label: "Nov 2026",
  so_far: true,
  requested: 0 as Shown,
  customers: { calls: 0 as Shown, microcents: "0" },
  founder: { calls: 0, microcents: "0", unknown_cost_calls: 0 },
  ...o,
});

describe("003u1 withheld figures claim no size", () => {
  it("are written as 'Withheld', never as a number or a bound", () => {
    expect(shownText("withheld")).toBe("Withheld");
    expect(shownText(0)).toBe("0");
    expect(costShown("withheld")).toBe("Withheld");
    expect(costShown("2500")).toBe("$0.000025");
    const text = describeMonth(
      month({
        requested: "withheld",
        customers: { calls: "withheld", microcents: "withheld" },
        founder: { calls: 4, microcents: "600000", unknown_cost_calls: 1 },
      }),
    );
    expect(text).toBe(
      "Nov 2026 (so far): customer uses withheld; runtime calls and cost serving customers withheld; founder trials and checks $0.006 over 4 calls, 1 with unknown cost",
    );
    expect(text).not.toMatch(/\bfewer\b|\bless than\b|\bunder\b|[<]/i);
    expect(describeMonth(month())).toContain("no customer uses (recorded zero)");
  });

  it("not granted, nothing recorded and withheld are different states", () => {
    expect(performanceState(undefined).kind).toBe("not_granted");
    expect(performanceState(undefined).text).toContain("isn't in this grant");
    const empty = { state: "not_started", withheld: false } as PerformanceEvidence;
    expect(performanceState(empty)).toMatchObject({ kind: "nothing_recorded" });
    expect(performanceState(empty).text).toContain("recorded zero, not missing data");
    const held = { state: "recorded", withheld: true } as PerformanceEvidence;
    expect(performanceState(held).kind).toBe("withheld");
    expect(performanceState(held).text).not.toMatch(/fewer than|[0-9]/i);
    expect(
      performanceState({ state: "recorded", withheld: false } as PerformanceEvidence).kind,
    ).toBe("recorded");
  });
});

describe("003u the room's late answers can't bring the section back", () => {
  type R = { digital_performance?: { as_of: string } };
  const withPerf: R = { digital_performance: { as_of: "2026-11-04T10:00:00.000Z" } };

  it("a refusal clears it; an older load's late success changes nothing", () => {
    let v: EvidenceView<R> = initial("ana", "req-1");
    v = begin(v, "ana", "req-1");
    const first = v.load;
    v = settle(v, first, "ana", "req-1", { ok: true, data: withPerf });
    expect(v.data?.digital_performance).toBeDefined();
    v = begin(v, "ana", "req-1"); // e.g. returning to the tab
    const second = v.load;
    v = settle(v, second, "ana", "req-1", { ok: false, status: 403, message: "ended" });
    expect(v).toMatchObject({ state: "refused", data: null });
    // The first load's answer arrives late: ignored.
    v = settle(v, first, "ana", "req-1", { ok: true, data: withPerf });
    expect(v.data).toBeNull();
  });

  it("another person, or a check that couldn't complete, never shows it", () => {
    let v: EvidenceView<R> = initial("ana", "req-1");
    v = begin(v, "ana", "req-1");
    v = settle(v, v.load, "ana", "req-1", { ok: true, data: withPerf });
    v = begin(v, "ben", "req-1");
    expect(v.data).toBeNull();
    const load = v.load;
    v = settle(v, load, "ben", "req-1", { ok: false, status: 0, message: "network" });
    expect(v).toMatchObject({ state: "unchecked", data: null });
  });
});
