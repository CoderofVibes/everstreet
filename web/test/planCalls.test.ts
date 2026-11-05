// Job 003wf4: the browser re-derives the guarded plan call and the appointment mask from the
// reviewed facts before any wallet sees them (saleCalls.expectedCall). Fictional values.

import { describe, expect, it } from "vitest";
import type { SalePreview } from "../src/saleApi.ts";
import { expectedCall } from "../src/saleCalls.ts";

const PLAN = {
  unit_price: "150000",
  max_units_per_purchase: 20,
  max_units_outstanding: 100,
  max_hold_units: 1,
  hold_ttl_ms: "600000",
  settle_grace_ms: "360000",
};
const preview = (kind: string, review: Record<string, unknown>, call: unknown = null) =>
  ({
    kind,
    contract: "studio.biz.near",
    review: { control_seq: "2", ...review },
    call,
  }) as never as SalePreview;

describe("003wf4 the browser's own derivation of the plan call", () => {
  it("is the reviewed plan, the reviewed next id and exactly the measured quote", () => {
    const quote = String(90n * 10_000_000_000_000_000_000n);
    const p = preview("create_plan", {
      plan: PLAN,
      plan_id: 2,
      plan_bytes: "90",
      storage_byte_cost: "10000000000000000000",
      deposit: quote,
    });
    expect(expectedCall(p)).toEqual({
      receiverId: "studio.biz.near",
      methodName: "create_plan_guarded",
      args: { input: PLAN, expected_control_seq: "2", expected_plan_id: 2 },
      gas: "30000000000000",
      deposit: quote,
    });
    // A deposit other than the quote determines no call at all.
    expect(
      expectedCall(
        preview("create_plan", {
          plan: PLAN,
          plan_id: 2,
          plan_bytes: "90",
          storage_byte_cost: "10000000000000000000",
          deposit: "1",
        }),
      ),
    ).toBeNull();
  });

  it("the appointment's mask: metering, plus support only when the slot has it and it is kept", () => {
    const caps = (current: unknown, keep: boolean | undefined, reviewed?: number) =>
      (
        expectedCall(
          preview("appoint", {
            operator: "meter.near",
            current,
            keep_support: keep,
            ...(reviewed === undefined ? {} : { caps: reviewed }),
          }),
        )?.args as { caps?: number } | undefined
      )?.caps ?? null;
    expect(caps(null, true, 1)).toBe(1);
    expect(caps({ caps: 2, generation: 1 }, true, 3)).toBe(3);
    expect(caps({ caps: 2, generation: 1 }, false, 1)).toBe(1);
    expect(caps({ caps: 3, generation: 0 }, true, 3)).toBe(3);
    // A server review claiming another mask than these facts give: no call.
    expect(caps({ caps: 2, generation: 1 }, false, 3)).toBeNull();
    expect(caps(null, true, 3)).toBeNull();
    // A row reviewed before 003wf4 (metering alone, no slot recorded).
    expect(caps(undefined, undefined)).toBe(1);
  });
});
