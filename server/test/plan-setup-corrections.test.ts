// Job 003wf4: Astra's 05:37 and 05:42 counterexamples, reproduced through the real routes over the
// TypeScript chain TEST DOUBLE, then corrected. A matched receipt's identity is kept durably even
// when the plan readback is temporarily unavailable; the setup summary keeps a refused request
// visible; the guided hold follows the configuration's real minimum, and an incompatible setting
// names which ceiling is in the way. Fictional data; no network.

import { describe, expect, it } from "vitest";
import type { Json } from "./customer-world.ts";
import { customerWorld, SyntheticProtection } from "./customer-world.ts";
import { type SaleWorld, SELLER, saleWorld } from "./sale-world.ts";

const PLAN = {
  unit_price: "150000",
  max_units_per_purchase: 20,
  max_units_outstanding: 100,
  max_hold_units: 1,
  hold_ttl_ms: "600000",
  settle_grace_ms: "360000",
};
const check = (s: SaleWorld, id: string, body: Json = {}) =>
  s.ava(`/api/sales/actions/${id}/check`, "POST", body);
const row = (s: SaleWorld, id: string) =>
  s.w.state.store.db
    .prepare("SELECT state, tx_hash, rev FROM sale_actions WHERE id = ?")
    .get(id) as Json;
const access = (s: SaleWorld) =>
  s.ava(`/api/businesses/${s.biz}/customer-access?project=${s.w.f.project}`);
const planStep = (b: Json) => (b.steps as Json[]).find((x) => x.key === "plan") as Json;

describe("003wf4 (Astra 05:37) a matched receipt is kept while its readback is unavailable", () => {
  it("a restart and a check without the ID confirm it; nothing is created twice", async () => {
    const s = await saleWorld();
    const r = await s.act(s.ava, SELLER, "create_plan", { plan: PLAN }, { lose: true });
    const id = r.action?.id as string;
    const hash = r.outcome?.transaction.hash as string;
    // Its own hash, but the plan readback's read fails once.
    s.w.reader.failNext = 1;
    const c = await check(s, id, { tx_hash: hash });
    expect(c.body.transaction).toEqual({ hash, matched: true });
    expect(c.body.resolution.kind).toBe("unknown");
    expect(row(s, id)).toMatchObject({ state: "requested", tx_hash: hash });
    // A rebuilt app (a restart), then a check WITHOUT the ID: the kept identity recovers it.
    s.w.state.app = s.w.make(s.w.state.store);
    const again = await check(s, id);
    expect(again.body.action.state).toBe("confirmed");
    expect(again.body.effects).toMatchObject({ plan: { plan_id: 2 } });
    expect(s.sale.planCount).toBe(2);
  });

  it("a wrong ID never replaces a kept identity, and a settled result is never downgraded", async () => {
    const s = await saleWorld();
    const r = await s.act(s.ava, SELLER, "create_plan", { plan: PLAN }, { lose: true });
    const id = r.action?.id as string;
    const hash = r.outcome?.transaction.hash as string;
    s.w.reader.failNext = 1;
    await check(s, id, { tx_hash: hash });
    const other = s.wallet(SELLER, {
      receiverId: s.BUSINESS,
      methodName: "appoint_operator_guarded",
      args: { account: "helper.near", caps: 2, expected_control_seq: "3" },
      gas: "30000000000000",
      deposit: "1",
    });
    const wrong = await check(s, id, { tx_hash: other.transaction.hash });
    expect(wrong.body.transaction).toEqual({ hash: other.transaction.hash, matched: false });
    expect(row(s, id).tx_hash).toBe(hash);
    const ok = await check(s, id);
    expect(ok.body.action.state).toBe("confirmed");
    // Once confirmed, a later failed readback can't undo it, and nothing is rewritten.
    const before = row(s, id);
    s.w.reader.failNext = 1;
    const late = await check(s, id, { tx_hash: hash });
    expect(late.body.action.state).toBe("confirmed");
    expect(row(s, id)).toEqual(before);
  });
});

describe("003wf4 (Astra 05:42) the setup summary and the guided default", () => {
  it("a refused newest request is shown with its reason, and a new review is offered", async () => {
    const s = await saleWorld();
    await s.ava(`/api/businesses/${s.biz}/customer-offers/${s.offerId}/retire`, "POST");
    const p = await s.prepare(s.ava, "create_plan", { plan: PLAN });
    const a = await s.ava(`/api/sales/${s.biz}/actions`, "POST", {
      kind: "create_plan",
      input: p.body.input,
      action_digest: p.body.action_digest,
      idempotency_key: "refused-plan-0001",
    });
    await s.ava(`/api/sales/actions/${a.body.action.id}/requested`, "POST", {});
    s.sale.controlSeq += 1n; // control moves before the send: E_REVIEWED
    const o = s.wallet(SELLER, a.body.action.call);
    await s.ava(`/api/sales/actions/${a.body.action.id}/requested`, "POST", {
      tx_hash: o.transaction.hash,
    });
    await check(s, a.body.action.id);
    const b = (await access(s)).body;
    expect(planStep(b)).toMatchObject({ state: "refused" });
    expect(planStep(b).detail).toContain("E_REVIEWED");
    expect(planStep(b).action.id).toBe(a.body.action.id);
  });

  it("a configuration that needs a longer hold gets a longer guided default, within the contract's rules", async () => {
    const wider = async (runtimeMs: number, windowMs: number, maxHold?: bigint) => {
      const w = await customerWorld({
        runtime: { timeoutMs: runtimeMs },
        customer: { protection: new SyntheticProtection(), serveWindowMs: windowMs },
      });
      const sale = w.chain.attachSale();
      if (maxHold !== undefined)
        (sale as unknown as { rules: Json }).rules = { ...sale.rules, max_hold_ttl_ms: maxHold };
      w.v3.transport = w.reader as never;
      w.state.app = w.make(w.state.store);
      w.link(w.f.ava.id, SELLER);
      const r = await w.owner(
        `/api/businesses/${w.f.business}/customer-access?project=${w.f.project}`,
      );
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return r.body;
    };
    // Astra's case: a 300 000 ms runtime limit needs 690 000 ms of hold; the 900 000 ms window and
    // the 3 600 000 ms contract maximum both allow 720 000 (rounded up to a whole minute).
    const ok = await wider(300_000, 900_000);
    expect(ok.timing.min_hold_ms).toBe(690_000);
    expect(ok.timing.guided_hold_ms).toBe(720_000);
    expect(ok.guided).toMatchObject({
      available: true,
      defaults: { hold_ttl_ms: "720000", settle_grace_ms: "360000" },
    });
    // The server's window is the ceiling: named as an operator setting.
    const server = await wider(300_000, 600_000);
    expect(server.guided.available).toBe(false);
    expect(server.guided.reason).toContain("This server serves at most 10 min of a hold");
    expect(server.guided.reason).toContain("11 min 30 s");
    // The contract's rules are the ceiling: named as the business's rules.
    const contract = await wider(300_000, 900_000, 600_000n);
    expect(contract.guided.available).toBe(false);
    expect(contract.guided.reason).toContain("This business's rules allow holds of at most 10 min");
  });
});

describe("003wf4 S-3 no plan is reviewed or stored while the business is changing hands", () => {
  it("prepare and create are refused handover_in_progress; nothing is stored", async () => {
    const s = await saleWorld();
    const p = await s.prepare(s.ava, "create_plan", { plan: PLAN });
    expect(p.status).toBe(200);
    // Synthetic: an open handover row for this business (its own job arms it from a closing deal).
    const now = Date.now();
    s.w.state.store.db
      .prepare(
        `INSERT INTO business_handovers (id, business_id, network, account, deal_seq, version, digest, expected_generation, closing_control_seq, closing_started_ms, deadline_ms, manifest, manifest_seq, price, available_floor, grants, closer, seller_account, buyer_account, armed_block, armed_source, evidence_height, state, created_ms, updated_ms)
         VALUES ('h-synthetic', ?, 'testnet', ?, '1', 1, ?, 1, '3', ?, ?, ?, '0', '250000000', '0', '[]', NULL, ?, 'buyer.near', '{}', 'test', '1', 'gated', ?, ?)`,
      )
      .run(
        s.biz,
        s.BUSINESS,
        "0".repeat(64),
        String(now),
        String(now + 3_600_000),
        "0".repeat(64),
        SELLER,
        now,
        now,
      );
    const again = await s.prepare(s.ava, "create_plan", { plan: PLAN });
    expect([again.status, again.body.code]).toEqual([409, "handover_in_progress"]);
    const stored = await s.ava(`/api/sales/${s.biz}/actions`, "POST", {
      kind: "create_plan",
      input: p.body.input,
      action_digest: p.body.action_digest,
      idempotency_key: "handover-plan-0001",
    });
    expect([stored.status, stored.body.code]).toEqual([409, "handover_in_progress"]);
    expect(s.w.state.store.db.prepare("SELECT COUNT(*) AS n FROM sale_actions").get()).toEqual({
      n: 0,
    });
  });
});

describe("003wf4 (Astra 05:52) a check in flight when another confirms answers with the stored outcome", () => {
  it("the late check's failed readback reports the confirmed result, never unknown beside it", async () => {
    const s = await saleWorld();
    const r = await s.act(s.ava, SELLER, "create_plan", { plan: PLAN }, { lose: true });
    const id = r.action?.id as string;
    const hash = r.outcome?.transaction.hash as string;
    // The first check reaches its readback and waits there.
    const gate = s.w.reader.holdNextRead();
    const first = check(s, id, { tx_hash: hash });
    await gate.entered;
    // A second check confirms it meanwhile.
    const second = await check(s, id, { tx_hash: hash });
    expect(second.body.action.state).toBe("confirmed");
    // The first one's readback then fails: its answer is the stored, coherent result.
    s.w.reader.failNext = 1;
    gate.open();
    const late = await first;
    expect(late.body.action.state).toBe("confirmed");
    expect(late.body.resolution).toMatchObject({ kind: "confirmed", result: "created" });
    expect(late.body.effects).toMatchObject({ plan: { plan_id: 2 } });
    expect(row(s, id)).toMatchObject({ state: "confirmed", tx_hash: hash });
    expect(s.sale.planCount).toBe(2);
  });
});
