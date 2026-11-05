// Job 003wf4 (docs/design/OWNER_PLAN_SETUP.md §5, Astra D1/D2): whether this server can serve a
// plan's holds, and the operational cutoffs of one hold, through the real app factory over the
// TypeScript chain TEST DOUBLE (customer-world.ts). The contract expiry (accept_by) is never
// shortened: an unknown attempt keeps its allocation until it, and an original that opens too late
// to run is reconciled to its own request and returned uncharged. Every producer is finite.

import { describe, expect, it } from "vitest";
import {
  cutoffs,
  minGraceMs,
  minUsableHoldMs,
  planUsability,
  reserveMs,
  type ServeTiming,
} from "../src/servePolicy.ts";
import {
  type CustomerWorld,
  customerWorld,
  type Json,
  SyntheticProtection,
  T0,
} from "./customer-world.ts";

const INVOICE =
  "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD";

const DEFAULTS: ServeTiming = {
  serveWindowMs: 600_000,
  submitMarginMs: 120_000,
  executionMarginMs: 60_000,
  deliveryTimeoutMs: 300_000,
  maxBlockAgeMs: 120_000,
  maxFutureSkewMs: 30_000,
  timeoutMs: 60_000,
};
const plan = (hold: number, grace = 600_000) => ({
  hold_ttl_ms: String(hold),
  settle_grace_ms: String(grace),
});

/** The clocks: local `now` and the chain's block time, set explicitly. */
const at = (w: CustomerWorld, local: bigint, chain: bigint = local) => {
  w.clock.now = Number(local);
  w.chain.ts = chain;
  w.chain.height += 1;
};
const all = (w: CustomerWorld, sql: string, ...a: string[]) =>
  w.state.store.db.prepare(sql).all(...a) as Json[];
const row = (w: CustomerWorld, id: string) =>
  all(w, "SELECT * FROM customer_requests WHERE id = ?", id)[0] as Json;
const flush = () => new Promise((r) => setTimeout(r, 0));

async function world(extra: Parameters<typeof customerWorld>[0] = {}) {
  const protection = new SyntheticProtection();
  return customerWorld({ ...extra, customer: { protection, ...extra.customer } });
}

let keys = 0;
async function prepare(w: CustomerWorld, offer?: string) {
  const o = offer ?? (await w.offer());
  const p = await w.cara(`/api/customer/offers/${o}/prepare`, "POST", {
    idempotency_key: `serve-key-${String(++keys).padStart(4, "0")}`,
    input: INVOICE,
  });
  return p;
}
const confirm = (w: CustomerWorld, use: Json) =>
  w.cara(`/api/customer/uses/${use.id}/confirm`, "POST", w.signed(use.envelope));
const reconcile = (w: CustomerWorld, id: string) =>
  w.cara(`/api/customer/uses/${id}/reconcile`, "POST");
const execute = (w: CustomerWorld, id: string) =>
  w.cara(`/api/customer/uses/${id}/execute`, "POST", {});

describe("003wf4 servePolicy: one policy from the configured margins (§5)", () => {
  it("defaults: reserve 120 000, minimum usable hold 450 000, settlement grace 360 000", () => {
    expect(reserveMs(DEFAULTS)).toBe(120_000);
    expect(minUsableHoldMs(DEFAULTS)).toBe(450_000);
    expect(minGraceMs(DEFAULTS)).toBe(360_000);
    // The reproduced short plans are unusable here; 450 000 and the guided 600 000 are usable.
    for (const hold of [60_000, 180_000, 180_001, 449_999])
      expect(planUsability(DEFAULTS, plan(hold)).usable, String(hold)).toBe(false);
    for (const hold of [450_000, 600_000, 1_800_000])
      expect(planUsability(DEFAULTS, plan(hold)).usable, String(hold)).toBe(true);
    const short = planUsability(DEFAULTS, plan(180_000));
    expect(short.reason).toContain("at least 450 s");
    expect(short.min_hold_ms).toBe(450_000);
    // The grace is a separate warning: below it the plan is still usable for service.
    expect(planUsability(DEFAULTS, plan(600_000, 359_999))).toMatchObject({
      usable: true,
      grace_ok: false,
    });
    expect(planUsability(DEFAULTS, plan(600_000, 360_000)).grace_ok).toBe(true);
  });

  it("the server's serve window caps the hold; a longer runtime limit raises the reserve", () => {
    expect(planUsability({ ...DEFAULTS, serveWindowMs: 449_999 }, plan(1_800_000)).usable).toBe(
      false,
    );
    // The reserve is the larger of the contract's minute and the execution's own need.
    const slow = { ...DEFAULTS, timeoutMs: 120_000 };
    expect(reserveMs(slow)).toBe(180_000);
    expect(minUsableHoldMs(slow)).toBe(510_000);
    expect(planUsability(slow, plan(509_999)).usable).toBe(false);
    expect(planUsability(slow, plan(510_000)).usable).toBe(true);
    // A short runtime limit never lowers it below the contract's minute.
    expect(reserveMs({ ...DEFAULTS, timeoutMs: 1_000, executionMarginMs: 1_000 })).toBe(60_000);
  });

  it("cutoffs are absolute from serve_until: execute_by, submit_by, then sign_by", () => {
    const c = cutoffs(DEFAULTS, 1_600_000n);
    expect(c).toEqual({ executeBy: 1_480_000n, submitBy: 1_360_000n, signBy: 1_330_000n });
  });
});

describe("003wf4 an unusable plan can't become or stay an offer (§5)", () => {
  it("inspection shows the reason; offer creation refuses plan_unusable, at 449 999 and not 450 000", async () => {
    const w = await world();
    at(w, T0);
    const inspect = () =>
      w.owner(`/api/businesses/${w.f.business}/customer-offer-inspections`, "POST", {
        release_id: w.release,
        plan_id: 1,
        retention_days: 30,
      });
    const create = (digest: string, key: string) =>
      w.owner(`/api/businesses/${w.f.business}/customer-offers`, "POST", {
        idempotency_key: key,
        release_id: w.release,
        plan_id: 1,
        retention_days: 30,
        reviewed_terms: digest,
      });
    w.chain.plan = { ...w.chain.plan, hold_ttl_ms: "449999" };
    const bad = await inspect();
    expect(bad.status).toBe(200);
    expect(bad.body.inspection.serve).toMatchObject({ usable: false, min_hold_ms: 450_000 });
    const refused = await create(bad.body.inspection.terms_digest, "offer-key-short1");
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("plan_unusable");
    expect(all(w, "SELECT id FROM customer_offers")).toHaveLength(0);
    w.chain.plan = { ...w.chain.plan, hold_ttl_ms: "450000" };
    const ok = await inspect();
    expect(ok.body.inspection.serve).toMatchObject({ usable: true });
    expect((await create(ok.body.inspection.terms_digest, "offer-key-short2")).status).toBe(201);
  });

  it("a configuration change makes an existing offer unavailable: prepare and readiness say so", async () => {
    // The same options object the world reads at every rebuild (no copy).
    const custom: Record<string, unknown> = { protection: new SyntheticProtection() };
    const w = await customerWorld({ customer: custom });
    at(w, T0);
    const offer = await w.offer();
    const ready = () =>
      w.service().serviceReadiness(w.f.business, w.chain.control as never).reasons as string[];
    expect(ready()).not.toContain("plan_unusable");
    // The operator shortens the serve window below the minimum usable hold.
    custom.serveWindowMs = 400_000;
    w.state.app = w.make(w.state.store);
    expect(ready()).toContain("plan_unusable");
    const p = await prepare(w, offer);
    expect(p.status).toBe(409);
    expect(p.body.code).toBe("plan_unusable");
    expect(all(w, "SELECT id FROM customer_requests")).toHaveLength(0);
  });

  it("a non-default supported configuration has its own boundary", async () => {
    const w = await world({
      runtime: { timeoutMs: 30_000 },
      customer: {
        serveWindowMs: 300_000,
        submitMarginMs: 60_000,
        executionMarginMs: 30_000,
        maxBlockAgeMs: 60_000,
        maxFutureSkewMs: 10_000,
      },
    });
    at(w, T0);
    const s = w.service();
    // reserve 60 000; minimum 60 000 + 60 000 + 60 000 + 10 000 + 60 000.
    expect(s.planUsability(plan(249_999)).usable).toBe(false);
    expect(s.planUsability(plan(250_000)).usable).toBe(true);
    // A use under it: sign_by = serve_until − 60 000 − 60 000 − 10 000.
    const p = await prepare(w);
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    const consent = p.body.use.envelope.consent;
    expect(BigInt(consent.sign_by_ms)).toBe(T0 + 300_000n - 130_000n);
    expect(BigInt(consent.accept_by_ms)).toBe(T0 + 300_000n - 60_000n);
  });
});

describe("003wf4 D1: the contract expiry stays the proof; operational cutoffs are separate", () => {
  it("prepare: accept_by is unchanged; sign_by and submit_by count back from serve_until", async () => {
    const w = await world();
    at(w, T0);
    const p = await prepare(w);
    expect(p.status).toBe(201);
    const r = row(w, p.body.use.id);
    expect(BigInt(r.serve_until_ms)).toBe(T0 + 600_000n);
    expect(BigInt(r.accept_by_ms)).toBe(T0 + 540_000n);
    expect(BigInt(r.submit_by_ms)).toBe(T0 + 360_000n);
    expect(BigInt(r.sign_by_ms)).toBe(T0 + 330_000n);
    expect(p.body.use.envelope.consent.accept_by_ms).toBe(String(T0 + 540_000n));
  });

  it("an unknown attempt past submit_by is never expired early; a delayed original in the gap is returned uncharged", async () => {
    const w = await world({ customer: { writeTimeoutMs: 20, maxSubmissions: 1 } });
    at(w, T0);
    const p = await prepare(w);
    const id = p.body.use.id as string;
    // The original is signed and submitted; it waits in the network past the writer's timeout.
    const gate = w.writer.holdNext();
    try {
      at(w, T0 + 1_000n);
      const c = await confirm(w, p.body.use);
      expect(c.body.use).toMatchObject({ state: "reserve_unknown", submissions: 1 });
      // Past submit_by and still before accept_by: unknown, its allocation kept, nothing sent.
      for (const t of [T0 + 360_001n, T0 + 479_999n, T0 + 499_000n]) {
        at(w, t);
        const r = await reconcile(w, id);
        expect(r.body.use.state, String(t)).toBe("reserve_unknown");
        expect(row(w, id).allocation, String(t)).not.toBeNull();
        expect(w.writer.calls).toBe(1);
      }
      // No second hold for the same units while the original may still open.
      const second = await prepare(w, p.body.use.offer_id);
      expect(second.status).toBe(409);
      expect(second.body.code).toBe("use_in_progress");
      // The delayed original lands between execute_by and accept_by.
      at(w, T0 + 500_000n);
      gate.open();
      await flush();
      expect(w.chain.opened).toBe(1);
      const r = await reconcile(w, id);
      // Reconciled to THIS request (its own identity), then returned uncharged: it can't run.
      expect(r.body.use).toMatchObject({ id, state: "reserved" });
      expect(r.body.use.units).toMatchObject({ kind: "release", reason: "too_late_to_run" });
      expect(r.body.use.headline.detail).toContain("opened too late to run safely");
      const events = all(
        w,
        "SELECT kind, code FROM customer_request_events WHERE request_id = ?",
        id,
      );
      expect(events).toContainEqual({ kind: "unit_release_intent", code: "too_late_to_run" });
      // Nothing runs: no provider call, no execution row.
      const calls = w.provider.calls;
      expect((await execute(w, id)).body.code).toBe("unit_settling");
      expect(w.provider.calls).toBe(calls);
      expect(all(w, "SELECT 1 FROM customer_executions")).toHaveLength(0);
      // The existing release path returns the unit; nothing is charged; one hold only.
      await w.service().settleDue(5);
      const u = (await w.cara(`/api/customer/uses/${id}/units/reconcile`, "POST")).body.use.units;
      expect(u).toMatchObject({ unit: "returned", kind: "release" });
      expect([w.chain.opened, w.chain.charged, w.writer.settleCalls]).toEqual([1, 0, 0]);
      expect(w.writer.releaseCalls).toBe(1);
    } finally {
      gate.open();
    }
  });

  it("an original that never lands is expired only by the contract's accept_by, not before", async () => {
    const w = await world({ customer: { writeTimeoutMs: 20, maxSubmissions: 1 } });
    at(w, T0);
    const p = await prepare(w);
    const id = p.body.use.id as string;
    const gate = w.writer.holdNext();
    try {
      at(w, T0 + 1_000n);
      await confirm(w, p.body.use);
      at(w, T0 + 540_000n); // accept_by itself: a block at it can still accept the hold
      expect((await reconcile(w, id)).body.use.state).toBe("reserve_unknown");
      expect(row(w, id).allocation).not.toBeNull();
      at(w, T0 + 540_001n);
      const r = await reconcile(w, id);
      expect(r.body.use).toMatchObject({ state: "refused", reason: "expired_unopened" });
      expect(row(w, id).allocation).toBeNull();
    } finally {
      gate.open();
    }
    await flush();
    // The late original can no longer open (the double applies open_hold's own expiry rule).
    expect(w.chain.opened).toBe(0);
  });

  it("a lost reply read back in the gap: returned uncharged past execute_by, run before it", async () => {
    for (const [readAt, runs] of [
      [T0 + 400_000n, true],
      [T0 + 500_000n, false],
    ] as const) {
      const w = await world();
      at(w, T0);
      const p = await prepare(w);
      const id = p.body.use.id as string;
      // The hold opens, its reply is lost and the readback fails: the outcome is unknown.
      w.writer.modes = ["lose_reply"];
      w.reader.failNext = 1;
      at(w, T0 + 1_000n);
      const c = await confirm(w, p.body.use);
      expect(c.body.use).toMatchObject({ state: "reserve_unknown", submissions: 1 });
      expect(w.chain.opened).toBe(1);
      at(w, readAt);
      const r = await reconcile(w, id);
      expect(r.body.use).toMatchObject({ id, state: "reserved" });
      expect(w.writer.calls, String(readAt)).toBe(1); // never resent: no duplicate
      if (runs) {
        expect(r.body.use.units.unit).not.toBe("release_pending");
        const x = (await execute(w, id)).body.use;
        expect(x.execution.settlement_eligible).toBe(true);
      } else {
        expect(r.body.use.units).toMatchObject({ kind: "release", reason: "too_late_to_run" });
        expect((await execute(w, id)).body.code).toBe("unit_settling");
        await w.service().settleDue(5);
        const u = (await w.cara(`/api/customer/uses/${id}/units/reconcile`, "POST")).body.use.units;
        expect(u.unit).toBe("returned");
        expect(w.chain.charged).toBe(0);
      }
      expect(w.chain.opened).toBe(1);
    }
  });

  it("no first submission after submit_by: a never-sent confirmation is cancelled, at submit_by + 1 only", async () => {
    for (const [stepAt, cancelled] of [
      [T0 + 360_000n, false],
      [T0 + 360_001n, true],
    ] as const) {
      const w = await world();
      at(w, T0);
      const p = await prepare(w);
      const id = p.body.use.id as string;
      // A worker holds the lease across the confirmation (as if it crashed): nothing is sent.
      w.state.store.db
        .prepare("UPDATE customer_requests SET lease_until = ? WHERE id = ?")
        .run(Number(stepAt) - 1, id);
      at(w, T0 + 1_000n);
      const c = await confirm(w, p.body.use);
      expect(c.body.use).toMatchObject({ state: "reserve_requested", submissions: 0 });
      at(w, stepAt);
      const r = await reconcile(w, id);
      if (cancelled) {
        expect(r.body.use).toMatchObject({ state: "cancelled", reason: "submit_cutoff" });
        expect(r.body.use.explanation).toContain("nothing was sent and nothing is held");
        expect(w.writer.calls).toBe(0);
        expect(row(w, id).allocation).toBeNull();
      } else {
        expect(r.body.use.state).toBe("reserved");
        expect(w.writer.calls).toBe(1);
      }
    }
  });
});

describe("003wf4 D2: conservative clocks at prepare; the late-but-permitted signature runs", () => {
  it("a signature at sign_by is submitted and executes; one after it is refused", async () => {
    const w = await world();
    at(w, T0);
    const p = await prepare(w);
    at(w, T0 + 330_000n);
    const c = await confirm(w, p.body.use);
    expect(c.body.use.state).toBe("reserved");
    expect((await execute(w, p.body.use.id)).body.use.execution.settlement_eligible).toBe(true);
    const v = await world();
    at(v, T0);
    const q = await prepare(v);
    at(v, T0 + 330_001n);
    expect((await confirm(v, q.body.use)).body.code).toBe("preparation_expired");
  });

  it("an old block still accepted (maxBlockAge − 1) and future skew (maxFutureSkew − 1)", async () => {
    for (const [name, offset] of [
      ["old", -119_999n],
      ["ahead", 29_999n],
    ] as const) {
      const w = await world();
      at(w, T0, T0 + offset);
      const p = await prepare(w);
      expect(p.status, name).toBe(201);
      const r = row(w, p.body.use.id);
      // serve_until is rooted at the block; every cutoff moves with it.
      expect(BigInt(r.serve_until_ms), name).toBe(T0 + offset + 600_000n);
      expect(BigInt(r.accept_by_ms), name).toBe(T0 + offset + 540_000n);
      expect(BigInt(r.sign_by_ms), name).toBe(T0 + offset + 330_000n);
      // The latest permitted signature, with the same clock offset, still submits and runs.
      const signAt = BigInt(r.sign_by_ms);
      at(w, signAt, signAt + offset);
      const c = await confirm(w, p.body.use);
      expect(c.body.use.state, name).toBe("reserved");
      // The hold landed one block (1 s) later; a later block, the clocks keep the same offset.
      at(w, signAt + 2_000n, signAt + 2_000n + offset);
      const x = await execute(w, p.body.use.id);
      expect(x.body.use?.execution?.settlement_eligible, JSON.stringify(x.body)).toBe(true);
    }
  });

  it("the original regression: signed 1 ms before sign_by, the submission uses all but 1 ms of its margin, then runs", async () => {
    // Astra 05:15: synchronized clocks, and the accepted future skew (block 29 999 ms ahead). The
    // writer holds the submission at its barrier while the clocks advance 119 999 ms locally and
    // 118 999 ms on the chain; the hold's landing adds the double's last 1 000 ms.
    for (const [name, skew] of [
      ["synchronized", 0n],
      ["future skew", 29_999n],
    ] as const) {
      const w = await world();
      at(w, T0, T0 + skew);
      const p = await prepare(w);
      expect(p.status, name).toBe(201);
      const signBy = BigInt(p.body.use.envelope.consent.sign_by_ms);
      expect(signBy, name).toBe(T0 + skew + 330_000n);
      const gate = w.writer.holdNext();
      try {
        at(w, signBy - 1n, signBy - 1n + skew);
        const confirming = confirm(w, p.body.use);
        await gate.entered;
        at(w, signBy - 1n + 119_999n, signBy - 1n + skew + 118_999n);
        gate.open();
        const c = await confirming;
        expect(c.body.use.state, name).toBe("reserved");
        const block = w.chain.ts;
        expect(block - BigInt(w.clock.now), name).toBe(skew);
        const r = row(w, p.body.use.id);
        // The time left is above the execution reserve (120 000), by 3 ms with the skew.
        expect(BigInt(r.serve_until_ms) - block, name).toBe(skew === 0n ? 150_002n : 120_003n);
        // The same block: no new height, so the evidence fence sees the readback's own block.
        const x = await execute(w, p.body.use.id);
        expect(x.body.use?.execution?.settlement_eligible, JSON.stringify(x.body)).toBe(true);
        expect(w.chain.opened, name).toBe(1);
      } finally {
        gate.open();
      }
    }
  });

  it("the oldest accepted block with the shortest usable hold still leaves a minute to sign", async () => {
    const w = await world();
    w.chain.plan = { ...w.chain.plan, hold_ttl_ms: "450000" };
    at(w, T0);
    const digest = await w.reviewed();
    const o = await w.owner(`/api/businesses/${w.f.business}/customer-offers`, "POST", {
      idempotency_key: "offer-key-min450",
      release_id: w.release,
      plan_id: 1,
      retention_days: 30,
      reviewed_terms: digest,
    });
    expect(o.status).toBe(201);
    at(w, T0, T0 - 120_000n);
    const p = await prepare(w, o.body.offer.id);
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    expect(BigInt(p.body.use.envelope.consent.sign_by_ms) - T0).toBe(60_000n);
  });
});
