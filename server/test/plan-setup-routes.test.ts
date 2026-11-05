// Job 003wf4 (OWNER_PLAN_SETUP.md §4-§6, §10 S-1..S-9): guided plan creation and the reviewed
// appointment through the REAL routes (everstreetApi) over the TypeScript chain TEST DOUBLE (the
// sale world; its plan creation is anchored by plan-setup-chain.test.ts). The founder's "wallet" is
// the double's walletCall with exactly the stored call: no signing, no network, no real NEAR.

import { describe, expect, it } from "vitest";
import { appointmentFor } from "../src/saleActions.ts";
import { type Json, OPERATOR } from "./customer-world.ts";
import { PLAN_BYTES } from "./sale-chain.ts";
import { proposal, type SaleWorld, SELLER, saleWorld } from "./sale-world.ts";

/** The guided defaults (§5: a 600 000 ms hold, the derived 360 000 ms grace). */
const PLAN = {
  unit_price: "150000",
  max_units_per_purchase: 20,
  max_units_outstanding: 100,
  max_hold_units: 1,
  hold_ttl_ms: "600000",
  settle_grace_ms: "360000",
};
const QUOTE = String(PLAN_BYTES * 10_000_000_000_000_000_000n);

let keys = 0;
const key = () => `plan-key-${String(++keys).padStart(6, "0")}`;
const store = (s: SaleWorld, p: Json, k = key()) =>
  s.ava(`/api/sales/${s.biz}/actions`, "POST", {
    kind: p.kind,
    input: p.input,
    action_digest: p.action_digest,
    idempotency_key: k,
  });
const ask = (s: SaleWorld, id: string, body: Json = {}) =>
  s.ava(`/api/sales/actions/${id}/requested`, "POST", body);
const check = (s: SaleWorld, id: string, body: Json = {}) =>
  s.ava(`/api/sales/actions/${id}/check`, "POST", body);
const rows = (s: SaleWorld) =>
  s.w.state.store.db.prepare("SELECT id, kind, state FROM sale_actions").all() as Json[];

describe("003wf4 S-1 guided plan creation: prepare, store, ask, check", () => {
  it("is confirmed only by its own transaction, the reviewed id, the full readback and generation", async () => {
    const s = await saleWorld();
    const p = await s.prepare(s.ava, "create_plan", { plan: PLAN });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body.call).toEqual({
      receiverId: s.BUSINESS,
      methodName: "create_plan_guarded",
      args: { input: PLAN, expected_control_seq: "2", expected_plan_id: 2 },
      gas: "30000000000000",
      deposit: QUOTE,
    });
    expect(p.body.review).toMatchObject({
      plan: PLAN,
      plan_id: 2,
      generation: 1,
      deposit: QUOTE,
      plan_bytes: "90",
      price: { base: "150000", amount: "0.15", symbol: "TUSD" },
      timing: { min_hold_ms: 450_000, min_grace_ms: 360_000 },
      control_seq: "2",
    });
    expect(p.body.review.effects.join(" ")).toContain("permanent");
    expect(p.body.identity).toBe("control:2");
    // Nothing is stored by a preview.
    expect(rows(s)).toHaveLength(0);
    const r = await s.act(s.ava, SELLER, "create_plan", { plan: PLAN });
    expect(r.check?.body.resolution).toMatchObject({ kind: "confirmed", result: "created" });
    expect(r.check?.body.action.state).toBe("confirmed");
    expect(r.check?.body.effects).toMatchObject({
      finished: true,
      plan: { plan_id: 2, plan: { ...PLAN, created_generation: 1 } },
    });
    expect(s.sale.plans.get(2)).toMatchObject(PLAN);
    // A repeated check changes nothing and creates nothing.
    const again = await check(s, r.action?.id);
    expect(again.body.action.state).toBe("confirmed");
    expect(s.sale.planCount).toBe(2);
  });

  it("a lookalike plan never confirms: the readback must equal the review", async () => {
    const s = await saleWorld();
    const r = await s.act(s.ava, SELLER, "create_plan", { plan: PLAN }, { lose: true });
    const id = r.action?.id as string;
    const hash = r.outcome?.transaction.hash as string;
    // Synthetic: the double's stored plan 2 differs from the review (never possible on chain).
    const real = s.sale.plans.get(2) as Json;
    s.sale.plans.set(2, { ...real, unit_price: "150001" });
    const c = await check(s, id, { tx_hash: hash });
    expect(c.body.resolution.kind).toBe("unknown");
    expect(c.body.resolution.message).toContain("doesn't read back as reviewed");
    expect(c.body.action.state).toBe("requested");
    s.sale.plans.set(2, real);
    const ok = await check(s, id, { tx_hash: hash });
    expect(ok.body.action.state).toBe("confirmed");
  });
});

describe("003wf4 S-2 recovery: a lost answer, a wrong hash, a second create, a restart", () => {
  it("is recovered by its own hash only; no duplicate; the same row after a rebuild", async () => {
    const s = await saleWorld();
    const r = await s.act(s.ava, SELLER, "create_plan", { plan: PLAN }, { lose: true });
    const id = r.action?.id as string;
    // No hash: control moved (the plan landed), so it can't take effect from now on.
    const blind = await check(s, id);
    expect(blind.body.action.state).toBe("no_longer_possible");
    expect(blind.body.resolution.message).toContain("control changed");
    // Another transaction's hash isn't this request's.
    const other = s.wallet(SELLER, {
      receiverId: s.BUSINESS,
      methodName: "appoint_operator_guarded",
      args: { account: "helper.near", caps: 2, expected_control_seq: "3" },
      gas: "30000000000000",
      deposit: "1",
    });
    const wrong = await check(s, id, { tx_hash: other.transaction.hash });
    expect(wrong.body.transaction).toEqual({ hash: other.transaction.hash, matched: false });
    expect(wrong.body.action.state).toBe("no_longer_possible");
    // Its own hash confirms it, with the readback.
    const own = await check(s, id, { tx_hash: r.outcome?.transaction.hash });
    expect(own.body.transaction.matched).toBe(true);
    expect(own.body.action.state).toBe("confirmed");
    expect(s.sale.planCount).toBe(2);
    // A rebuilt app (a restart) reads the same durable row.
    s.w.state.app = s.w.make(s.w.state.store);
    const after = await s.setup(s.ava);
    const mine = (after.body.actions as Json[]).find((a) => a.id === id);
    expect(mine).toMatchObject({ kind: "create_plan", state: "confirmed" });
  });

  it("a second create is refused while the first is asked and unresolved", async () => {
    const s = await saleWorld();
    const p = await s.prepare(s.ava, "create_plan", { plan: PLAN });
    const first = await store(s, p.body);
    expect(first.status).toBe(201);
    expect((await ask(s, first.body.action.id)).body.ask).toBe("granted");
    const second = await store(s, p.body);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("action_open");
    expect(rows(s).filter((r) => r.kind === "create_plan")).toHaveLength(1);
  });
});

describe("003wf4 S-3 refusals: stale quote, stale control, cap, live deal, an older contract", () => {
  it("a stale quote and stale control are the contract's refusals; nothing is created", async () => {
    const s = await saleWorld();
    // The byte cost rises after the review (synthetic): E_STORAGE, nothing created.
    const p = await s.prepare(s.ava, "create_plan", { plan: PLAN });
    const a = await store(s, p.body);
    await ask(s, a.body.action.id);
    (s.sale as unknown as { byteCost: bigint }).byteCost = 20_000_000_000_000_000_000n;
    const o = s.wallet(SELLER, a.body.action.call);
    await ask(s, a.body.action.id, { tx_hash: o.transaction.hash });
    const c = await check(s, a.body.action.id);
    expect(c.body.resolution).toMatchObject({ kind: "refused", reason: "E_STORAGE" });
    expect(s.sale.planCount).toBe(1);
    (s.sale as unknown as { byteCost: bigint }).byteCost = 10_000_000_000_000_000_000n;
    // Control moves after the review (another owner action): E_REVIEWED.
    const q = await s.prepare(s.ava, "create_plan", { plan: PLAN });
    const b = await store(s, q.body);
    await ask(s, b.body.action.id);
    s.wallet(SELLER, {
      receiverId: s.BUSINESS,
      methodName: "appoint_operator_guarded",
      args: { account: "helper.near", caps: 2, expected_control_seq: "2" },
      gas: "30000000000000",
      deposit: "1",
    });
    const o2 = s.wallet(SELLER, b.body.action.call);
    await ask(s, b.body.action.id, { tx_hash: o2.transaction.hash });
    const c2 = await check(s, b.body.action.id);
    expect(c2.body.resolution).toMatchObject({ kind: "refused", reason: "E_REVIEWED" });
    expect(s.sale.planCount).toBe(1);
  });

  it("prepare refuses: the cap, a live deal, unusable timing, a short grace, bad terms, an older contract, a non-owner", async () => {
    const s = await saleWorld();
    const code = async (who = s.ava, plan: Json = PLAN) =>
      (await s.prepare(who, "create_plan", { plan })).body.code;
    expect(await code(s.ava, { ...PLAN, hold_ttl_ms: "449999" })).toBe("plan_unusable");
    expect(await code(s.ava, { ...PLAN, hold_ttl_ms: "450000" })).toBeUndefined();
    expect(await code(s.ava, { ...PLAN, settle_grace_ms: "359999" })).toBe("grace_too_short");
    expect(await code(s.ava, { ...PLAN, unit_price: "0" })).toBe("bad_plan");
    expect(await code(s.ava, { ...PLAN, max_units_outstanding: 19 })).toBe("bad_plan");
    expect(await code(s.ava, { ...PLAN, max_hold_units: 11 })).toBe("bad_plan");
    expect(await code(s.ava, { ...PLAN, hold_ttl_ms: "3600001" })).toBe("bad_plan");
    s.sale.planCount = 32;
    expect(await code()).toBe("plan_limit");
    s.sale.planCount = 1;
    s.sale.planTerms = false;
    expect(await code()).toBe("guided_plans_unavailable");
    // S-6: the existing plan stays inspectable on that older code.
    const i = await s.ava(`/api/businesses/${s.biz}/customer-offer-inspections`, "POST", {
      release_id: s.w.release,
      plan_id: 1,
      retention_days: 30,
    });
    expect(i.status).toBe(200);
    s.sale.planTerms = true;
    const deal = await s.act(s.ava, SELLER, "propose", proposal());
    expect(deal.check?.body.action.state).toBe("confirmed");
    expect(await code()).toBe("deal_live");
    // The buyer is a participant now, not the owner.
    expect(await code(s.noah)).toBe("not_owner");
  });
});

describe("003wf4 S-9 conflicting plan requests under one control identity (§5a)", () => {
  it("different terms are a request_conflict, prepared or asked; the identical one is recovered", async () => {
    const s = await saleWorld();
    const a = await s.prepare(s.ava, "create_plan", { plan: PLAN });
    const b = await s.prepare(s.ava, "create_plan", { plan: { ...PLAN, unit_price: "175000" } });
    expect(a.body.identity).toBe(b.body.identity);
    const first = await store(s, a.body);
    expect(first.status).toBe(201);
    const clash = await store(s, b.body);
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe("request_conflict");
    expect(clash.body.detail.action.review.plan.unit_price).toBe("150000");
    // The identical request is the open one, for recovery (never a second row).
    const same = await store(s, a.body);
    expect(same.body.code).toBe("action_open");
    await ask(s, first.body.action.id);
    const asked = await store(s, b.body);
    expect(asked.body.code).toBe("request_conflict");
    expect(rows(s).filter((r) => r.kind === "create_plan")).toHaveLength(1);
  });
});

describe("003wf4 S-5 the appointment is an explicit replacement mask (§6)", () => {
  const slot = (s: SaleWorld, caps: number | null, generation = 1) => {
    s.sale.operators = Array(8).fill(null);
    if (caps !== null) s.sale.operators[0] = { account: OPERATOR, caps, generation };
  };
  const review = async (s: SaleWorld, input: Json = {}) => {
    const p = await s.prepare(s.ava, "appoint", input);
    return p.status === 200 ? p.body.review : { code: p.body.code };
  };

  it("every slot case: the pure review (older generations included) and the reachable routes", async () => {
    // Older-generation slots: business-v3 replaces every slot at a close (Rust p07) and the
    // server refuses a reading that shows one (v3read coherent: "an operator belongs to another
    // generation"). The review still names them correctly, from a control view only.
    const ctl = (caps: number | null, gen: number) =>
      ({
        generation: 2,
        operators: caps === null ? [] : [{ account: OPERATOR, caps, generation: gen }],
      }) as never;
    const cases: [number | null, number, boolean, number | "already", string][] = [
      [null, 2, true, 1, "Adds metering."],
      [1, 1, true, 1, "Renews metering for this owner."],
      [2, 2, true, 3, "Adds metering and keeps support."],
      [2, 2, false, 1, "Replaces support with metering: support is removed."],
      [2, 1, true, 3, "Renews support for this owner and adds metering."],
      [2, 1, false, 1, "Adds metering; support isn't renewed."],
      [3, 1, true, 3, "Renews metering and support for this owner."],
      [3, 1, false, 1, "Renews metering; support is removed."],
      [3, 2, true, "already", "Already appointed."],
      [1, 2, true, "already", "Already appointed."],
    ];
    for (const [caps, gen, keep, want, change] of cases) {
      const r = appointmentFor(ctl(caps, gen), OPERATOR, keep);
      const name = `${caps}@${gen} keep=${keep}`;
      expect(r.change, name).toBe(change);
      if (want === "already") expect(r.already, name).toBe(true);
      else
        expect([r.already, r.caps, r.current], name).toEqual([
          false,
          want,
          caps === null ? null : { caps, generation: gen },
        ]);
    }
    // Through the routes, every case a coherent reading can show (the current generation).
    const s = await saleWorld();
    const route: [number | null, Json, number | string, string][] = [
      [null, {}, 1, "Adds metering."],
      [2, {}, 3, "Adds metering and keeps support."],
      [2, { keep_support: false }, 1, "Replaces support with metering: support is removed."],
      [3, {}, "already_appointed", ""],
      [1, {}, "already_appointed", ""],
    ];
    for (const [caps, input, want, change] of route) {
      slot(s, caps, 1);
      const r = await review(s, input);
      const name = `${caps} ${JSON.stringify(input)}`;
      if (typeof want === "string") expect(r.code, name).toBe(want);
      else {
        expect([r.caps, r.change, r.current], name).toEqual([
          want,
          change,
          caps === null ? null : { caps, generation: 1 },
        ]);
        expect(r.effects.join(" "), name).toContain("permission only");
      }
    }
    expect((await review(s, { keep_support: "no" })).code).toBe("bad_keep_support");
    // An older-generation slot in a reading: refused as incoherent, never reviewed.
    slot(s, 2, 0);
    expect((await review(s)).code).toBe("read_failed");
    // An unchanged state gives the same digest; a different choice a different one.
    slot(s, 2, 1);
    const d1 = (await s.prepare(s.ava, "appoint", {})).body.action_digest;
    const d2 = (await s.prepare(s.ava, "appoint", {})).body.action_digest;
    const d3 = (await s.prepare(s.ava, "appoint", { keep_support: false })).body.action_digest;
    expect(d1).toBe(d2);
    expect(d3).not.toBe(d1);
  });

  it("support is kept by default and confirmed exactly; removal only as chosen; stale control is refused", async () => {
    const s = await saleWorld();
    s.sale.generation = 1;
    slot(s, 2, 1);
    const kept = await s.act(s.ava, SELLER, "appoint", {});
    expect(kept.check?.body.action.state).toBe("confirmed");
    expect(kept.check?.body.resolution.message).toContain("metering and support");
    expect(kept.check?.body.resolution.message).not.toContain("new uses can be served");
    expect(s.sale.operators[0]).toEqual({ account: OPERATOR, caps: 3, generation: 1 });
    // Removal is the explicit choice only.
    slot(s, 2, 1);
    const removed = await s.act(s.ava, SELLER, "appoint", { keep_support: false });
    expect(removed.check?.body.action.state).toBe("confirmed");
    expect(s.sale.operators[0]).toEqual({ account: OPERATOR, caps: 1, generation: 1 });
    // Stale: control moved between the review and the send.
    slot(s, 2, 1);
    const p = await s.prepare(s.ava, "appoint", {});
    const a = await store(s, p.body);
    await ask(s, a.body.action.id);
    s.sale.controlSeq += 1n;
    const o = s.wallet(SELLER, a.body.action.call);
    await ask(s, a.body.action.id, { tx_hash: o.transaction.hash });
    const c = await check(s, a.body.action.id);
    expect(c.body.resolution).toMatchObject({ kind: "refused", reason: "E_REVIEWED" });
  });
});

describe("003wf4 S-7 another participant never sees the founder's plan requests", () => {
  it("the buyer's sale page lists none of them", async () => {
    const s = await saleWorld();
    await s.act(s.ava, SELLER, "create_plan", { plan: PLAN });
    await s.act(s.ava, SELLER, "propose", proposal());
    const noah = await s.setup(s.noah);
    expect(noah.status).toBe(200);
    expect((noah.body.actions as Json[]).some((a) => a.kind === "create_plan")).toBe(false);
  });
});
