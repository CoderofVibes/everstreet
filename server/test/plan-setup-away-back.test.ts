// Job 003wf4 S-7 (OWNER_PLAN_SETUP.md §4 "Away and back"; Astra 06:21): the founder's plan and
// permission requests are bound to her person, account and owner generation. After the business is
// sold, the new owner sees none of them and reviews afresh at his generation; after it is sold BACK,
// her earlier requests are history only (never current setup evidence), and an old request that was
// asked but never sent can't land. Real routes over the TypeScript chain TEST DOUBLE; fictional.

import { describe, expect, it } from "vitest";
import type { Json } from "./customer-world.ts";
import { BUYER, proposal, SELLER, saleWorld } from "./sale-world.ts";

const PLAN = {
  unit_price: "150000",
  max_units_per_purchase: 20,
  max_units_outstanding: 100,
  max_hold_units: 1,
  hold_ttl_ms: "600000",
  settle_grace_ms: "360000",
};

describe("003wf4 S-7 away and back: requests are bound to their owner generation", () => {
  it("sold, then sold back: no cross-owner view, a fresh review, history apart, the old request can't land", async () => {
    const s = await saleWorld();
    // Two whole sales are a longer scenario than the double's default 400 calls (reached at 404
    // before this budget was named): its own, still finite, budget.
    s.w.chain.ceiling = 2_000;
    const access = (who = s.ava) =>
      who(`/api/businesses/${s.biz}/customer-access?project=${s.w.f.project}`);
    const step = (b: Json, k: string) => (b.steps as Json[]).find((x) => x.key === k) as Json;

    // Generation 1 (Ava): one confirmed plan, and one plan request asked but never sent.
    const made = await s.act(s.ava, SELLER, "create_plan", { plan: PLAN });
    expect(made.check?.body.action.state).toBe("confirmed");
    const unsent = await s.act(
      s.ava,
      SELLER,
      "create_plan",
      { plan: { ...PLAN, unit_price: "160000" } },
      { send: false },
    );
    const stored = s.w.state.store.db
      .prepare("SELECT state FROM sale_actions WHERE id = ?")
      .get(unsent.action?.id as string) as Json;
    expect(stored.state).toBe("requested");
    const oldCall = unsent.action?.call as Json;
    const a1 = (await access()).body;
    expect(a1.owner_generation).toBe(1);
    expect(step(a1, "plan").action.id).toBe(unsent.action?.id);
    expect(a1.history).toEqual([]);

    // Away: a Direct sale to Noah (as the sale journey: register, fund, uses, both accept).
    expect((await s.act(s.ava, SELLER, "propose", proposal())).check?.body.action.state).toBe(
      "confirmed",
    );
    await s.act(s.noah, BUYER, "register");
    await s.act(s.noah, BUYER, "fund");
    await s.customerUse();
    await s.customerUse();
    expect((await s.act(s.noah, BUYER, "accept")).check?.body.resolution.result).toBe("accepted");
    const close = await s.act(s.ava, SELLER, "accept");
    expect(close.check?.body.resolution, JSON.stringify(close.p.body)).toMatchObject({
      result: "closed",
    });
    expect(s.control()).toMatchObject({ owner: BUYER, generation: 2 });

    // Ava no longer manages it: nothing here for her; her own rows stay hers.
    expect((await access()).status).toBe(404);
    // Noah sees none of Ava's requests, as current setup or history.
    const n = await access(s.noah);
    expect(n.status, JSON.stringify(n.body)).toBe(200);
    expect(n.body.owner_generation).toBe(2);
    expect(n.body.history).toEqual([]);
    expect((n.body.steps as Json[]).every((x) => x.action === null)).toBe(true);
    expect(JSON.stringify(n.body)).not.toContain(unsent.action?.id as string);
    // His own plan request is a fresh review at his generation, for the next plan id.
    const np = await s.prepare(s.noah, "create_plan", { plan: PLAN });
    expect(np.status, JSON.stringify(np.body)).toBe(200);
    expect(np.body.review).toMatchObject({ generation: 2, plan_id: 3 });
    expect(np.body.account).toBe(BUYER);

    // Back: Noah sells it back to Ava.
    s.w.chain.balances.set(SELLER, 1_000_000_000n);
    const back = await s.act(s.noah, BUYER, "propose", { ...proposal(), buyer_account: SELLER });
    expect(back.check?.body.resolution, JSON.stringify(back.p.body)).toMatchObject({
      kind: "confirmed",
    });
    for (const k of ["register", "fund"]) {
      const r = await s.act(s.ava, SELLER, k);
      expect(r.check?.body.resolution?.kind, `${k}: ${JSON.stringify(r.p.body)}`).toBe("confirmed");
    }
    await s.customerUse();
    await s.customerUse();
    expect((await s.act(s.ava, SELLER, "accept")).check?.body.resolution.kind).toBe("confirmed");
    const close2 = await s.act(s.noah, BUYER, "accept");
    expect(close2.check?.body.resolution, JSON.stringify(close2.p.body)).toMatchObject({
      result: "closed",
    });
    expect(s.control()).toMatchObject({ owner: SELLER, generation: 3 });

    // Ava again, at generation 3: her generation-1 requests are history, not this setup.
    const r3 = await access();
    expect(
      r3.status,
      `${JSON.stringify(r3.body)} chain ${s.w.chain.calls}/${s.w.chain.ceiling} reads ${s.w.reader.used}/${s.w.reader.ceiling}`,
    ).toBe(200);
    const a3 = r3.body;
    expect(a3.owner_generation).toBe(3);
    expect(a3.history.map((h: Json) => [h.id, h.generation]).sort()).toEqual(
      [
        [made.action?.id, 1],
        [unsent.action?.id, 1],
      ].sort(),
    );
    expect(step(a3, "plan").action).toBeNull();
    expect(a3.plans).toEqual([]);
    // The old asked-but-unsent request can't land now: the contract refuses it, nothing changes.
    const plans = s.sale.planCount;
    const late = s.wallet(SELLER, oldCall);
    expect(JSON.stringify(late.status)).toMatch(/E_REVIEWED|E_REVIEWED_PLAN/);
    expect(s.sale.planCount).toBe(plans);
    // A new plan needs a fresh review under generation 3.
    const fresh = await s.prepare(s.ava, "create_plan", { plan: PLAN });
    expect(fresh.body.review).toMatchObject({ generation: 3 });
  }, 60_000);
});
