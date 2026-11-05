// Job 003wf4 (OWNER_PLAN_SETUP.md §2, §8, §9): GET /api/businesses/:id/customer-access through the
// real app over the TypeScript chain TEST DOUBLE (the sale world). Each step's state comes from the
// owner's durable rows and one fresh contract reading; nothing is written by reading it.

import { describe, expect, it } from "vitest";
import { type Json, OPERATOR } from "./customer-world.ts";
import { type SaleWorld, SELLER, saleWorld } from "./sale-world.ts";

const PLAN = {
  unit_price: "150000",
  max_units_per_purchase: 20,
  max_units_outstanding: 100,
  max_hold_units: 1,
  hold_ttl_ms: "600000",
  settle_grace_ms: "360000",
};

const access = (s: SaleWorld, who = s.ava) =>
  who(`/api/businesses/${s.biz}/customer-access?project=${s.w.f.project}`);
const step = (b: Json, key: string) => (b.steps as Json[]).find((x) => x.key === key) as Json;

/** The sale world without its customer offer (retired), so plan and offer steps are open. */
async function fresh() {
  const s = await saleWorld();
  const r = await s.ava(`/api/businesses/${s.biz}/customer-offers/${s.offerId}/retire`, "POST");
  expect(r.status).toBe(200);
  return s;
}

describe("003wf4 customer access: the three steps from durable rows and one fresh reading", () => {
  it("an offered business: every step shows its evidence; nothing is next", async () => {
    const s = await saleWorld();
    const a = await access(s);
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(step(a.body, "plan")).toMatchObject({ state: "confirmed" });
    expect(step(a.body, "plan").detail).toContain("Plan 1 is already offered");
    expect(step(a.body, "permissions")).toMatchObject({ state: "confirmed" });
    expect(step(a.body, "offer")).toMatchObject({ state: "confirmed" });
    expect(a.body.next).toBeNull();
    expect(a.body.service.note).toContain("next use");
  });

  it("guided defaults, the quote and the timing bounds; the offer waits for the plan", async () => {
    const s = await fresh();
    const a = (await access(s)).body;
    expect(a.guided).toMatchObject({
      available: true,
      reason: null,
      defaults: { hold_ttl_ms: "600000", settle_grace_ms: "360000" },
      quote: { deposit: String(90n * 10_000_000_000_000_000_000n), plan_bytes: "90" },
      next_plan_id: 2,
      rules: { max_hold_units: 10, max_hold_ttl_ms: "3600000" },
    });
    expect(a.timing).toMatchObject({
      min_hold_ms: 450_000,
      min_grace_ms: 360_000,
      guided_hold_ms: 600_000,
    });
    expect(step(a, "plan").state).toBe("needs_input");
    expect(step(a, "offer")).toMatchObject({ state: "blocked", detail: "After the pricing plan." });
    expect(a.next).toBe("plan");
    // Reading it stores nothing.
    expect(s.w.state.store.db.prepare("SELECT COUNT(*) AS n FROM sale_actions").get()).toEqual({
      n: 0,
    });
  });

  it("an asked plan request is shown apart; once confirmed, the plan is the evidence", async () => {
    const s = await fresh();
    const r = await s.act(s.ava, SELLER, "create_plan", { plan: PLAN }, { lose: true });
    const asked = (await access(s)).body;
    expect(step(asked, "plan")).toMatchObject({ state: "asked" });
    expect(step(asked, "plan").action.id).toBe(r.action?.id);
    // A check without its hash: it can no longer take effect, but whether it did is unknown. The
    // step keeps showing THAT request for recovery by its own ID (never a fresh form as if not).
    await s.ava(`/api/sales/actions/${r.action?.id}/check`, "POST", {});
    const blind = (await access(s)).body;
    expect(step(blind, "plan")).toMatchObject({ state: "unknown" });
    expect(step(blind, "plan").action).toMatchObject({
      id: r.action?.id,
      state: "no_longer_possible",
    });
    expect(step(blind, "plan").detail).toContain("enter its ID");
    await s.ava(`/api/sales/actions/${r.action?.id}/check`, "POST", {
      tx_hash: r.outcome?.transaction.hash,
    });
    const done = (await access(s)).body;
    expect(step(done, "plan")).toMatchObject({ state: "confirmed" });
    expect(done.plans).toEqual([
      expect.objectContaining({
        plan_id: 2,
        plan: { ...PLAN, created_generation: 1 },
        usable: expect.objectContaining({ usable: true }),
      }),
    ]);
    expect(step(done, "offer").state).toBe("needs_input");
    expect(done.next).toBe("offer");
  });

  it("permissions: the current slot and both choices when support is held; unavailable and blocked cases", async () => {
    const s = await fresh();
    s.sale.operators = Array(8).fill(null);
    s.sale.operators[0] = { account: OPERATOR, caps: 2, generation: 1 };
    const a = (await access(s)).body;
    expect(step(a, "permissions")).toMatchObject({
      state: "needs_input",
      detail: "Adds metering and keeps support.",
    });
    expect(a.operator).toMatchObject({
      account: OPERATOR,
      current: { caps: 2, generation: 1 },
      already: false,
      without_support: "Replaces support with metering: support is removed.",
    });
    // An older contract: guided plans unavailable, with the remedy.
    s.sale.planTerms = false;
    const old = (await access(s)).body;
    expect(old.guided.available).toBe(false);
    expect(step(old, "plan").state).toBe("unavailable");
    expect(step(old, "plan").detail).toContain("Use an existing plan");
  });

  it("only the owner: anyone else gets nothing", async () => {
    const s = await saleWorld();
    expect((await access(s, s.stranger)).status).toBe(404);
    expect((await access(s, s.noah)).status).toBe(404);
  });
});
