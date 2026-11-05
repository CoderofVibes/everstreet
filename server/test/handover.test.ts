// Job 003wf3 (MANAGED_HANDOVER.md §10.3): the managed handover through the actual services in
// one process (handoverWorld.ts: the production composition with `handover` configured, synthetic
// RPC/model answered here). Each case drives the coordinator's passes itself.

import { afterEach, describe, expect, it } from "vitest";
import { HandoverCoordinator } from "../src/handoverCoordinator.ts";
import type { Json } from "./customer-world.ts";
import { BUYER, CLOSER, type HandoverWorld, handoverWorld, PRICE } from "./handoverWorld.ts";
import { FOUNDER, OP } from "./lifecycleWorld.ts";

const worlds: HandoverWorld[] = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.cleanup();
});
const world = async (o: Parameters<typeof handoverWorld>[0] = {}) => {
  const w = await handoverWorld(o);
  worlds.push(w);
  return w;
};

describe("003wf3 a managed Gated handover through the actual services", () => {
  it("propose, fund and accept through the participants' wallets; the coordinator issues the exact order, the contract closes, the existing reconciliation applies it, and the gate opens to the buyer", async () => {
    const w = await world();
    await w.toBuyerAccepted();
    const closing = await w.act(w.seller, FOUNDER, "accept");
    expect(
      closing.check?.body.resolution,
      JSON.stringify(closing.check?.body ?? closing.created?.body ?? closing.p.body),
    ).toMatchObject({ kind: "confirmed", result: "closing" });
    expect(w.sale.controlView().live_deal).toMatchObject({ state: "closing" });
    // Pass 1: arms, drains (nothing in flight), proves readiness, issues and sends order 1.
    const r1 = await w.coordinator.pass();
    expect(r1[w.biz]).toBe("dispatched:applied");
    const orders = w.rows("SELECT n, order_json FROM close_orders");
    expect(orders).toHaveLength(1);
    const order = JSON.parse(orders[0]?.order_json as string) as Json;
    const d = w.sale.outcomesView()[0] as Json;
    expect(order).toMatchObject({ deal_seq: "1", version: 1, expected_generation: 1 });
    expect(d).toMatchObject({ status: "closed", seq: "1", generation_after: 2 });
    expect(w.sale.controlView()).toMatchObject({ owner: BUYER, generation: 2 });
    // The attempt was durably recorded before broadcast, signed by the closer's FC key.
    const attempt = w.rows("SELECT method, signer, state FROM closer_tx_attempts")[0];
    expect(attempt).toMatchObject({ method: "close_sale", signer: CLOSER, state: "success" });
    // Pass 2: the close is observed, reconciled through V3Intents (system entry), released.
    const r2 = await w.coordinator.pass();
    expect(r2[w.biz]).toMatch(/^reconcile_(applied|already)$/);
    expect(w.handoverRow()).toMatchObject({ state: "released_to_buyer" });
    const owner = w.rows("SELECT owner_id FROM businesses WHERE id = ?", w.biz)[0];
    expect(owner?.owner_id).toBe("person-noah");
    const own = w.rows("SELECT v3_intent_id FROM ownership WHERE business_id = ?", w.biz);
    expect(own.some((x) => x.v3_intent_id)).toBe(true);
    const by = w.rows("SELECT actor FROM events WHERE type = 'v3.reconciled_by_handover'");
    expect(by[0]?.actor).toBe("system:handover");
    // The sale page shows the released handover and the real service readiness (D4).
    const setup = (await w.buyer(`/api/sales/${w.biz}`)).body;
    expect(setup.handover).toMatchObject({ state: "released_to_buyer", deal_seq: "1" });
    expect(setup.handover.service).toMatchObject({
      eligible: expect.any(Boolean),
      reasons: expect.any(Array),
    });
    expect(setup.control.operators.map((o: Json) => o.account)).toContain(OP);
    expect(PRICE).toBe(String(d.price));
  }, 60_000);
});

const INVOICE =
  "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD";
let useKeys = 0;
/** Cara prepares one use through the composition's routes (the real reader at a pinned block). */
const prepare = (w: HandoverWorld) =>
  w.cara(`/api/customer/offers/${w.b.offer}/prepare`, "POST", {
    idempotency_key: `handover-use-${String(++useKeys).padStart(4, "0")}`,
    input: INVOICE,
  });
/** ...and confirms it with her own device key's signatures (the real writer opens the hold). */
const confirm = (w: HandoverWorld, use: Json) =>
  w.cara(`/api/customer/uses/${use.id}/confirm`, "POST", w.b.w.signed(use.envelope));
/** Passes until the handover leaves the given states (bounded). */
async function passUntil(w: HandoverWorld, done: (state: string) => boolean, max = 40) {
  const seen: string[] = [];
  for (let i = 0; i < max; i++) {
    const r = await w.coordinator.pass();
    seen.push(r[w.biz] as string);
    // An earlier step still finishing (its writes refused): give it time, never overlap it.
    if (r[w.biz] === "busy") await new Promise((done) => setTimeout(done, 100));
    const s = String(w.handoverRow()?.state);
    if (done(s)) return seen;
  }
  throw new Error(`still ${w.handoverRow()?.state} after ${max} passes: ${seen.join(", ")}`);
}
const closingNow = async (w: HandoverWorld) => {
  await w.toBuyerAccepted();
  const c = await w.act(w.seller, FOUNDER, "accept");
  expect(c.check?.body.resolution).toMatchObject({ kind: "confirmed", result: "closing" });
};

describe("003wf3 customers across the handover: pause, return, drain and the next use", () => {
  it("a reserved use is returned (not run, not charged) through the real writer; new admissions and owner changes are refused with exact messages; after the close the next use is served under the buyer's grants", async () => {
    const w = await world();
    const p1 = await prepare(w);
    expect(p1.status, JSON.stringify(p1.body)).toBe(201);
    const c1 = await confirm(w, p1.body.use);
    expect(c1.body.use?.state).toBe("reserved");
    const id = p1.body.use.id as string;
    await closingNow(w);
    // A new admission: refused before anything is signed (D6 "none").
    const p2 = await prepare(w);
    expect([p2.status, p2.body.code, p2.body.detail?.unit]).toEqual([
      409,
      "handover_pause",
      "none",
    ]);
    expect(p2.body.error).toMatch(/Nothing was signed, held or charged/);
    // The reserved use can't run now: its unit is being returned (D6 "returning").
    const x = await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    expect([x.status, x.body.code, x.body.detail?.unit]).toEqual([
      409,
      "handover_pause",
      "returning",
    ]);
    // Owner changes are refused while the business is changing hands; reads continue.
    const patch = await w.seller(`/api/businesses/${w.biz}`, "PATCH", { name: "Renamed" });
    expect([patch.status, patch.body.code]).toEqual([409, "handover_in_progress"]);
    const budget = await w.seller(`/api/businesses/${w.biz}/build-budget`, "PUT", {
      limit_cents: 5,
    });
    expect([budget.status, budget.body.code]).toEqual([409, "handover_in_progress"]);
    expect((await w.seller(`/api/businesses/${w.biz}`)).status).toBe(200);
    // The coordinator drains (the unit is released by the real writer), proves readiness, closes.
    const seen = await passUntil(w, (s) => s === "released_to_buyer");
    // The unit was released by the real writer BEFORE the close order (drain, then readiness).
    const order = w.b.rpc.applied.map((a) => a.method);
    expect(order.indexOf("release_hold_for")).toBeGreaterThan(-1);
    expect(order.indexOf("release_hold_for")).toBeLessThan(order.indexOf("close_sale"));
    expect(seen.length).toBeGreaterThan(0);
    expect(w.b.rpc.applied.map((a) => a.method)).toEqual(
      expect.arrayContaining(["open_hold", "release_hold_for", "close_sale"]),
    );
    const mine = (await w.cara(`/api/customer/uses/${id}`)).body;
    expect(mine.use?.units?.unit ?? mine.units?.unit).toBe("returned");
    // Customers keep their units; the next use is served under the buyer's grants (gen 2).
    expect(w.sale.controlView()).toMatchObject({ owner: BUYER, generation: 2 });
    const p3 = await prepare(w);
    expect(p3.status, JSON.stringify(p3.body)).toBe(201);
    expect((await confirm(w, p3.body.use)).body.use?.state).toBe("reserved");
    const run = await w.cara(`/api/customer/uses/${p3.body.use.id}/execute`, "POST", {});
    expect(run.body.use?.execution?.fulfilled, JSON.stringify(run.body)).toBe(true);
  }, 90_000);

  it("a provider call in flight at the handover keeps readiness waiting until its result is delivered and its unit charged; the customer's result is kept", async () => {
    const w = await world();
    const p = await prepare(w);
    expect((await confirm(w, p.body.use)).body.use?.state).toBe("reserved");
    await w.toBuyerAccepted();
    const held = w.b.model.holdNextMessage();
    const running = w.cara(`/api/customer/uses/${p.body.use.id}/execute`, "POST", {});
    await held.entered;
    const c = await w.act(w.seller, FOUNDER, "accept");
    expect(c.check?.body.resolution).toMatchObject({ result: "closing" });
    const r1 = await w.coordinator.pass();
    expect(r1[w.biz]).toMatch(
      /^not_ready:(holds_active|customers_(executions_running|deliveries_pending|settlements_unsettled))$/,
    );
    expect(w.rows("SELECT * FROM close_orders")).toHaveLength(0);
    held.open();
    const done = await running;
    expect(done.body.use?.execution?.fulfilled, JSON.stringify(done.body)).toBe(true);
    await passUntil(w, (s) => s === "released_to_buyer");
    // The delivered use was charged by the real writer before the order; the result is readable.
    expect(w.b.rpc.applied.map((a) => a.method)).toContain("settle_hold");
    const result = await w.cara(`/api/customer/uses/${p.body.use.id}/result`);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
  }, 90_000);
});

describe("003wf3 dispatch, outcome and authority edges", () => {
  it("a lost dispatch answer: the late transaction still lands, the timed-out step writes nothing, the attempt is resolved by its own hash, one order, one close", async () => {
    const w = await world({ handover: { op_deadline_ms: 400, pass_budget_ms: 2_000 } });
    await closingNow(w);
    const held = w.b.rpc.holdNextSend();
    const first = w.coordinator.pass();
    await held.entered;
    expect((await first)[w.biz]).toBe("deadline");
    held.open();
    // The earlier step finishes on its own (its writes refused); the next passes resolve by evidence.
    await passUntil(w, (s) => s === "released_to_buyer");
    expect(w.rows("SELECT n FROM close_orders")).toHaveLength(1);
    expect(w.rows("SELECT state FROM closer_tx_attempts")).toEqual([{ state: "success" }]);
    expect(w.b.rpc.applied.filter((a) => a.method === "close_sale")).toHaveLength(1);
    const kinds = w.rows("SELECT kind FROM handover_journal").map((j) => j.kind);
    expect(kinds).toContain("attempt_final");
  }, 90_000);

  it("the deadline alone never reopens the business; the buyer's wallet abort does, to the seller, with the escrow owed", async () => {
    const w = await world();
    await closingNow(w);
    w.b.w.chain.tick(31n * 60_000n);
    const r = await w.coordinator.pass();
    expect(r[w.biz]).toBe("not_ready:too_late");
    expect(w.handoverRow()?.state).toBe("gated");
    expect(
      (await w.seller(`/api/businesses/${w.biz}`, "PATCH", { name: "Too early" })).status,
    ).toBe(409);
    const ab = await w.act(w.buyer, BUYER, "abort");
    expect(ab.check?.body.resolution).toMatchObject({ kind: "confirmed", result: "aborted" });
    await passUntil(w, (s) => s === "released_to_seller");
    expect(w.sale.controlView()).toMatchObject({ owner: FOUNDER, generation: 1 });
    const party = (await w.buyer(`/api/sales/${w.biz}`)).body.party;
    expect(party.escrow_return_claim).toBe(PRICE);
    expect(
      (await w.seller(`/api/businesses/${w.biz}`, "PATCH", { name: "Mine again" })).status,
    ).toBe(200);
  }, 90_000);

  it("an incompatible live peer blocks orders (D3); a stale one is ignored", async () => {
    const w = await world();
    await closingNow(w);
    const db = w.composed.store.db;
    db.prepare(
      "INSERT INTO process_presence (holder, until_ms, capabilities) VALUES ('old-binary', ?, NULL)",
    ).run(Date.now() + 60_000);
    const r1 = await w.coordinator.pass();
    expect(r1[w.biz]).toBe("not_ready:capability_incompatible_peer");
    expect(w.rows("SELECT * FROM close_orders")).toHaveLength(0);
    db.prepare("UPDATE process_presence SET until_ms = ? WHERE holder = 'old-binary'").run(
      Date.now() - 1,
    );
    await passUntil(w, (s) => s === "released_to_buyer");
  }, 90_000);

  it("capability refusals: a full-access, wider or wrong-receiver closer key, or contract code without the guard, refuse the acceptance that would start closing", async () => {
    for (const [o, reason] of [
      [{ closerKey: "full" }, "full_access_key"],
      [{ closerKey: "other_method" }, "key_permission"],
      [{ closerKey: "other_receiver" }, "key_permission"],
      [{ closerKey: "low_allowance" }, "allowance_low"],
      [{ terms: false }, "contract_upgrade"],
    ] as const) {
      const w = await world(o as never);
      await w.toBuyerAccepted();
      const p = await w.seller(`/api/sales/${w.biz}/prepare`, "POST", {
        kind: "accept",
        input: {},
      });
      expect([p.status, p.body.code], JSON.stringify(o)).toEqual([409, "handover_unavailable"]);
      expect(p.body.error).toContain(reason);
      expect(w.sale.controlView().live_deal?.state).toBe("accepting");
    }
  }, 120_000);

  it("a managed (Gated) proposal must grant the platform's metering account (Q1)", async () => {
    const w = await world();
    const p = await w.seller(`/api/sales/${w.biz}/prepare`, "POST", {
      kind: "propose",
      input: w.terms({ grants: [{ account: "other-meter.testnet", caps: 1 }] }),
    });
    expect([p.status, p.body.code]).toEqual([409, "managed_meter_required"]);
  }, 60_000);

  it("the database refuses a direct owner write for a gated business, whatever the caller (backstop)", async () => {
    const w = await world();
    await closingNow(w);
    await w.coordinator.pass(); // arms (if the sale read hadn't yet)
    const db = w.composed.store.db;
    expect(() =>
      db
        .prepare(
          "INSERT INTO build_budgets (business_id, limit_cents, updated_by, updated_at) VALUES (?, 1, ?, 'now')",
        )
        .run(w.biz, w.b.w.f.ava.id),
    ).toThrow(/handover_in_progress/);
    expect(() => db.prepare("UPDATE businesses SET name = 'x' WHERE id = ?").run(w.biz)).toThrow(
      /handover_in_progress/,
    );
  }, 60_000);
});

describe("003wf3 lease (D7) and bounded journal (D2)", () => {
  it("an expired holder writes nothing even before anyone takes over; a takeover gets the next generation", async () => {
    const w = await world();
    await closingNow(w);
    await w.coordinator.pass();
    const db = w.composed.store.db;
    const lease = () =>
      db
        .prepare("SELECT holder, gen, until_ms FROM handover_lease WHERE business_id = ?")
        .get(w.biz) as Json;
    const before = lease();
    // Expire it without any takeover: the holder's next write is refused at its transaction.
    db.prepare("UPDATE handover_lease SET until_ms = ? WHERE business_id = ?").run(
      Date.now() - 1,
      w.biz,
    );
    const c = w.coordinator as unknown as {
      ops: Map<string, { gen: number; dead: boolean; done: Promise<unknown> }>;
      requireLease: (b: string, g: number) => void;
      tx: <T>(f: () => T) => T;
    };
    c.ops.set(w.biz, { gen: before.gen, dead: false, done: Promise.resolve() });
    expect(() => c.tx(() => c.requireLease(w.biz, before.gen))).toThrow();
    c.ops.delete(w.biz);
    // Another holder takes over at the next generation.
    const other = new HandoverCoordinator(
      db,
      {} as never,
      {} as never,
      null,
      {} as never,
      new Map(),
      {
        holder: "other-process",
        intervalMs: 1_000,
        batch: 1,
        passBudgetMs: 1_000,
        opDeadlineMs: 500,
        dispatchMarginMs: 60_000,
        maxOrders: 1,
      },
    );
    expect(other.claim(w.biz)).toBe(before.gen + 1);
    expect(w.coordinator.claim(w.biz)).toBeNull();
  }, 60_000);

  it("the smallest valid journal: unchanged failing passes stay bounded and the final close is still recorded; an invalid reserve is refused", async () => {
    expect(
      () =>
        new HandoverCoordinator(
          {} as never,
          {} as never,
          {} as never,
          null,
          {} as never,
          new Map(),
          {
            holder: "x",
            intervalMs: 1_000,
            batch: 1,
            passBudgetMs: 1_000,
            opDeadlineMs: 500,
            dispatchMarginMs: 60_000,
            maxOrders: 8,
            journal: { cap: 20, reserve: 10 },
          },
        ),
    ).toThrow(/reserve/);
    const w = await world();
    await closingNow(w);
    const db = w.composed.store.db;
    db.prepare(
      "INSERT INTO process_presence (holder, until_ms, capabilities) VALUES ('old-binary', ?, NULL)",
    ).run(Date.now() + 60_000);
    for (let i = 0; i < 40; i++) await w.coordinator.pass();
    const h = w.handoverRow() as Json;
    expect(h.check_repeat).toBeGreaterThanOrEqual(39);
    const n = (
      db
        .prepare("SELECT COUNT(*) AS n FROM handover_journal WHERE handover_id = ?")
        .get(h.id) as Json
    ).n;
    expect(n).toBeLessThanOrEqual(3); // armed, one coalesced not_ready (unchanged reason)
    db.prepare("DELETE FROM process_presence WHERE holder = 'old-binary'").run();
    await passUntil(w, (s) => s === "released_to_buyer");
    const kinds = w
      .rows("SELECT kind FROM handover_journal WHERE handover_id = ?", h.id)
      .map((j) => j.kind);
    expect(kinds).toEqual(expect.arrayContaining(["order_created", "outcome", "terminal"]));
  }, 90_000);
});
