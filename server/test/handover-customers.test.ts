// Job 003wf3 (MANAGED_HANDOVER.md §10.3 S-2, S-5, S-8, S-9, S-16): customer boundaries across a
// managed Gated handover, through the configured composition in one process (handoverWorld.ts)
// with deterministic barriers in the synthetic RPC, the synthetic model and the protection seam.
// Cara's existing fixture key signs (no browser enrollment). Fictional people and accounts.

import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { preimageOfHold, verifiesEd25519 } from "../src/customerSigning.ts";
import { CustomerUses } from "../src/customerUse.ts";
import { openHandover } from "../src/handover.ts";
import { CUSTOMER, type Json } from "./customer-world.ts";
import { BUYER, type HandoverWorld, handoverWorld } from "./handoverWorld.ts";
import { barrier, FOUNDER } from "./lifecycleWorld.ts";

const worlds: HandoverWorld[] = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.cleanup();
});
const world = async (o: Parameters<typeof handoverWorld>[0] = {}) => {
  const w = await handoverWorld(o);
  worlds.push(w);
  return w;
};

const INVOICE =
  "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD";
let keys = 0;
const prepare = (w: HandoverWorld) =>
  w.cara(`/api/customer/offers/${w.b.offer}/prepare`, "POST", {
    idempotency_key: `handover-customers-${String(++keys).padStart(4, "0")}`,
    input: INVOICE,
  });
const confirm = (w: HandoverWorld, use: Json) =>
  w.cara(`/api/customer/uses/${use.id}/confirm`, "POST", w.b.w.signed(use.envelope));
const sellerAccepts = async (w: HandoverWorld) => {
  const c = await w.act(w.seller, FOUNDER, "accept");
  expect(c.check?.body.resolution).toMatchObject({ kind: "confirmed", result: "closing" });
};
async function passUntil(w: HandoverWorld, done: (state: string) => boolean, max = 40) {
  const seen: string[] = [];
  for (let i = 0; i < max; i++) {
    const r = await w.coordinator.pass();
    seen.push(r[w.biz] as string);
    if (r[w.biz] === "busy") await new Promise((d) => setTimeout(d, 100));
    if (done(String(w.handoverRow()?.state))) return seen;
  }
  throw new Error(`still ${w.handoverRow()?.state} after ${max} passes: ${seen.join(", ")}`);
}
/** The coordinator's own CustomerUses (it shares the composition's adapters and protection). */
const usesOf = (w: HandoverWorld) =>
  (w.coordinator as unknown as { uses: unknown }).uses as {
    settleDue: CustomerUses["settleDue"];
    sweepProtected: CustomerUses["sweepProtected"];
    protection: { protect: (i: Json) => Promise<string> };
  };
const request = (w: HandoverWorld, id: string) =>
  w.rows("SELECT * FROM customer_requests WHERE id = ?", id)[0] as Json;
const applied = (w: HandoverWorld, method: string) =>
  w.b.rpc.applied.filter((a) => a.method === method).length;

describe("003wf3 S-2: an execute that passed its chain read before the gate", () => {
  it("is refused in its dispatch transaction after the gate: nothing runs, its unit is returned, then the close", async () => {
    const w = await world();
    const p = await prepare(w);
    expect((await confirm(w, p.body.use)).body.use?.state).toBe("reserved");
    const id = p.body.use.id as string;
    await w.toBuyerAccepted();
    // The execute's view read answers from a block BEFORE the closing, and waits there.
    const held = w.b.rpc.holdNextQuery();
    const running = w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    await held.entered;
    await sellerAccepts(w); // the closing starts while the execute is between read and dispatch
    expect(w.handoverRow()?.state, "armed by the sale's own read").toBe("gated");
    held.open();
    const x = await running;
    expect([x.status, x.body.code, x.body.detail?.unit], JSON.stringify(x.body)).toEqual([
      409,
      "handover_pause",
      "returning",
    ]);
    expect(w.rows("SELECT 1 FROM customer_executions WHERE request_id = ?", id)).toHaveLength(0);
    expect(w.rows("SELECT 1 FROM runtime_invocations WHERE purpose = 'customer_use'")).toHaveLength(
      0,
    );
    await passUntil(w, (s) => s === "released_to_buyer");
    expect(applied(w, "release_hold_for")).toBe(1);
    expect(applied(w, "settle_hold")).toBe(0);
    expect(applied(w, "close_sale")).toBe(1);
    const mine = (await w.cara(`/api/customer/uses/${id}`)).body;
    expect(mine.use?.units?.unit ?? mine.units?.unit).toBe("returned");
  }, 90_000);
});

describe("003wf3 S-5: unsent versus submitted reservations across the gate", () => {
  it("a confirmed request never submitted (the process ended after its confirm) is cancelled with its allocation freed; nothing is sent", async () => {
    const w = await world();
    const p = await prepare(w);
    const id = p.body.use.id as string;
    // The confirm's transaction commits; the process "ends" before its submit step runs.
    const step = CustomerUses.prototype.step;
    let skipped = 0;
    CustomerUses.prototype.step = async function (this: CustomerUses, rid: string) {
      if (rid === id && skipped === 0) {
        skipped++;
        return "process_ended";
      }
      return step.call(this, rid);
    };
    try {
      const c = await confirm(w, p.body.use);
      expect(c.status, JSON.stringify(c.body)).toBe(200);
    } finally {
      CustomerUses.prototype.step = step;
    }
    expect(request(w, id)).toMatchObject({ state: "reserve_requested", submissions: 0 });
    expect(
      w.rows("SELECT 1 FROM chain_tx_attempts WHERE operation LIKE ?", `${id}|%`),
    ).toHaveLength(0);
    await w.toBuyerAccepted();
    await sellerAccepts(w);
    await passUntil(w, (s) => s === "released_to_buyer");
    expect(request(w, id)).toMatchObject({
      state: "cancelled",
      reason: "handover_pause",
      allocation: null,
      submissions: 0,
    });
    expect(
      w.rows("SELECT 1 FROM chain_tx_attempts WHERE operation LIKE ?", `${id}|%`),
    ).toHaveLength(0);
    expect(applied(w, "open_hold")).toBe(0);
    expect(
      w
        .rows("SELECT kind FROM customer_request_events WHERE request_id = ?", id)
        .map((e) => e.kind),
    ).toContain("cancelled_for_handover");
  }, 90_000);
  it("a submitted reservation whose answer was lost is never resent while gated: only its original transaction decides it (the contract refuses it during the closing)", async () => {
    const w = await world();
    const p = await prepare(w);
    const id = p.body.use.id as string;
    await w.toBuyerAccepted();
    // The writer records and sends the original; its answer never arrives in time.
    const held = w.b.rpc.holdNextSend();
    const confirming = confirm(w, p.body.use);
    await held.entered;
    await sellerAccepts(w);
    const c = await confirming; // after the writer's own timeout (20 s): unknown
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(request(w, id)).toMatchObject({ state: "reserve_unknown", submissions: 1 });
    const attempts = () =>
      w.rows(
        "SELECT attempt, state, code FROM chain_tx_attempts WHERE operation LIKE ?",
        `${id}|%`,
      );
    expect(attempts()).toHaveLength(1);
    const sends = w.b.rpc.sends;
    // While gated, the coordinator's drain only reads it back: never a second send or attempt.
    for (let i = 0; i < 3; i++) {
      const r = await w.coordinator.pass();
      expect(r[w.biz]).toMatch(/^not_ready:customers_reservations_pending$|^busy$/);
    }
    expect(w.b.rpc.sends).toBe(sends);
    expect(attempts()).toHaveLength(1);
    expect(request(w, id)).toMatchObject({ submissions: 1 });
    expect(w.rows("SELECT 1 FROM close_orders")).toHaveLength(0);
    // The original finally reaches the contract: no new hold while closing (E_CLOSING).
    held.open();
    await new Promise((r) => setTimeout(r, 200));
    const r2 = await w.coordinator.pass();
    expect(r2[w.biz], "a refused original is not proof: still pending").toBe(
      "not_ready:customers_reservations_pending",
    );
    expect(w.b.rpc.sends).toBe(sends);
    // Only the contract's own clock proves it can never open: past its accept-by time (still
    // well before the close deadline), the readback decides it dead and frees the allocation.
    const acceptBy = BigInt(request(w, id).accept_by_ms as string);
    const deadline = BigInt(w.handoverRow()?.deadline_ms as string);
    const chain = w.b.w.chain;
    expect(deadline - acceptBy > 5n * 60_000n, "accept-by well before the close deadline").toBe(
      true,
    );
    chain.tick(acceptBy + 1_000n - chain.ts);
    await passUntil(w, (s) => s === "released_to_buyer", 20);
    expect(applied(w, "open_hold")).toBe(0);
    expect(attempts()).toHaveLength(1);
    expect(request(w, id).state).not.toMatch(/^reserve_/);
    expect(applied(w, "close_sale")).toBe(1);
    expect(w.sale.controlView()).toMatchObject({ owner: BUYER, generation: 2 });
  }, 120_000);
});

describe("003wf3 S-8: a hold opened outside the platform", () => {
  it("blocks readiness by name (holds_active) and no order is made; once that hold is released the close follows", async () => {
    const w = await world();
    const chain = w.b.w.chain;
    const e = chain.ent(CUSTOMER) as Json;
    const slot = (e.keys as Json[]).findIndex((k) => k?.state === "active");
    const key = (e.keys as Json[])[slot] as Json;
    const auth = {
      hold_seq: Number(e.hold_seq) + 1,
      units: 1,
      serve_until_ms: String(chain.ts + 10n * 60_000n),
      key_slot: slot,
      key_epoch: Number(key.epoch),
    };
    const ref = {
      business: chain.business,
      plan_id: 1,
      customer: CUSTOMER,
      reg_id: e.reg_id as string,
      key_slot: auth.key_slot,
      key_epoch: auth.key_epoch,
    };
    const message = createHash("sha256").update(preimageOfHold(ref, auth)).digest("hex");
    // Cara's own key signs; the seller sends it from their own wallet (the owner meters).
    expect(chain.openHold(FOUNDER, CUSTOMER, auth, w.b.w.sign1(message), verifiesEd25519)).toBe(
      "opened",
    );
    expect(BigInt(w.sale.treasuryView().ent_held_value as string) > 0n).toBe(true);
    expect(w.rows("SELECT 1 FROM customer_requests")).toHaveLength(0); // not the platform's
    await w.toBuyerAccepted();
    await sellerAccepts(w);
    for (let i = 0; i < 3; i++)
      expect((await w.coordinator.pass())[w.biz]).toBe("not_ready:holds_active");
    expect(w.rows("SELECT 1 FROM close_orders")).toHaveLength(0);
    const page = (await w.seller(`/api/sales/${w.biz}`)).body.handover;
    expect(page.waiting_for).toBe("holds_active");
    chain.releaseHoldFor(FOUNDER, CUSTOMER, ref.reg_id, auth.hold_seq);
    await passUntil(w, (s) => s === "released_to_buyer");
    expect(applied(w, "close_sale")).toBe(1);
  }, 90_000);
});

describe("003wf3 S-9: the agreed floor", () => {
  it("an acceptance below the floor is refused; after a customer's settlement lands it passes and the close follows; the coordinator's own floor check (defensive: the contract never lowers available while closing) refuses below it", async () => {
    const w = await world();
    const before = BigInt(w.sale.treasuryView().available as string);
    const floor = String(before + 1n);
    const proposed = await w.act(w.seller, FOUNDER, "propose", w.terms({ available_floor: floor }));
    expect(proposed.check?.body.resolution?.kind, JSON.stringify(proposed.p.body)).toBe(
      "confirmed",
    );
    for (const k of ["register", "fund"])
      expect((await w.act(w.buyer, BUYER, k)).check?.body.resolution?.kind, k).toBe("confirmed");
    const early = await w.act(w.buyer, BUYER, "accept");
    const refusedHow =
      early.p.status !== 200
        ? `prepare:${early.p.body.code}`
        : `contract:${early.check?.body.resolution?.kind}`;
    // Refused before the wallet is asked (the contract would refuse it too: E_FLOOR).
    expect(refusedHow, JSON.stringify(early.p.body)).toBe("prepare:floor");
    expect(early.p.body.error).toContain("is below the agreed floor");
    expect(w.sale.controlView().live_deal?.buyer_accepted).toBe(false);
    // A customer's use is served and settled through the composition: available rises.
    const p = await prepare(w);
    expect((await confirm(w, p.body.use)).body.use?.state).toBe("reserved");
    const run = await w.cara(`/api/customer/uses/${p.body.use.id}/execute`, "POST", {});
    expect(run.body.use?.execution?.fulfilled, JSON.stringify(run.body)).toBe(true);
    await usesOf(w).settleDue();
    expect(applied(w, "settle_hold")).toBe(1);
    expect(BigInt(w.sale.treasuryView().available as string) >= BigInt(floor)).toBe(true);
    expect((await w.act(w.buyer, BUYER, "accept")).check?.body.resolution?.kind).toBe("confirmed");
    await sellerAccepts(w);
    // The coordinator's check, on its own pinned read with available set below the floor.
    const c = w.coordinator as unknown as {
      read: (b: unknown) => Promise<{ snapshot: Json; block: Json }>;
      readiness: (h: unknown, s: unknown, b: unknown, cap: unknown) => string | null;
      obs: { bindingFor: (id: string) => unknown };
    };
    const r = await c.read(c.obs.bindingFor(w.biz));
    const h = openHandover(w.composed.store.db, w.biz);
    expect(h?.state).toBe("gated");
    const low = { ...r.snapshot, treasury: { ...(r.snapshot.treasury as Json), available: "0" } };
    expect(c.readiness(h, low, r.block, { ready: true, reason: null })).toBe("below_floor");
    await passUntil(w, (s) => s === "released_to_buyer");
    expect(applied(w, "close_sale")).toBe(1);
  }, 120_000);
});

describe("003wf3 S-16: a provider result whose protection is pending or fails", () => {
  const holdProtect = (w: HandoverWorld, mode: "hold" | "fail_after_write") => {
    const prot = usesOf(w).protection;
    const real = prot.protect.bind(prot);
    const gate = barrier();
    prot.protect = async (i: Json) => {
      if (i.kind !== "result") return real(i);
      gate.arrive();
      await gate.release;
      if (mode === "hold") return real(i);
      await real(i); // the copy is written; then the seam fails: an orphan to sweep
      throw new Error("synthetic: protection failed after writing");
    };
    return gate;
  };

  it("completed while its protection is held: readiness waits; on release the same result is kept, the unit charged, then the close", async () => {
    const w = await world();
    const p = await prepare(w);
    const id = p.body.use.id as string;
    expect((await confirm(w, p.body.use)).body.use?.state).toBe("reserved");
    await w.toBuyerAccepted();
    const gate = holdProtect(w, "hold");
    const running = w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    await gate.entered;
    expect(w.rows("SELECT state FROM runtime_invocations WHERE purpose = 'customer_use'")).toEqual([
      { state: "completed" },
    ]);
    expect(w.rows("SELECT delivery FROM customer_executions WHERE request_id = ?", id)).toEqual([
      { delivery: "protecting" },
    ]);
    await sellerAccepts(w);
    const r1 = await w.coordinator.pass();
    expect(r1[w.biz]).toMatch(/^not_ready:(holds_active|customers_deliveries_pending)$/);
    expect(w.rows("SELECT 1 FROM close_orders")).toHaveLength(0);
    gate.open();
    const done = await running;
    expect(done.body.use?.execution?.fulfilled, JSON.stringify(done.body)).toBe(true);
    const kept = w.rows(
      "SELECT result_ref, result_outcome, delivery FROM customer_executions WHERE request_id = ?",
      id,
    )[0] as Json;
    expect(kept.delivery).toBe("delivered");
    const holdSeq = request(w, id).hold_seq;
    await passUntil(w, (s) => s === "released_to_buyer");
    expect(applied(w, "settle_hold")).toBe(1);
    expect(applied(w, "release_hold_for")).toBe(0);
    const after = w.rows(
      "SELECT result_ref, result_outcome FROM customer_executions WHERE request_id = ?",
      id,
    )[0] as Json;
    expect(after).toEqual({ result_ref: kept.result_ref, result_outcome: kept.result_outcome });
    expect(request(w, id).hold_seq).toBe(holdSeq);
    expect((await w.cara(`/api/customer/uses/${id}/result`)).status).toBe(200);
  }, 90_000);

  it("a protection failure after the copy was written: not delivered, the unit returned (not charged), the run's usage kept on its record, the orphan copy swept, then the close", async () => {
    const w = await world();
    const p = await prepare(w);
    const id = p.body.use.id as string;
    expect((await confirm(w, p.body.use)).body.use?.state).toBe("reserved");
    await w.toBuyerAccepted();
    const gate = holdProtect(w, "fail_after_write");
    const running = w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    await gate.entered;
    await sellerAccepts(w);
    gate.open();
    const done = await running;
    expect(done.body.use?.execution?.fulfilled ?? false, JSON.stringify(done.body)).toBe(false);
    expect(
      w.rows(
        "SELECT delivery, result_state, result_ref FROM customer_executions WHERE request_id = ?",
        id,
      ),
    ).toEqual([{ delivery: "not_delivered", result_state: "unavailable", result_ref: null }]);
    const prot = usesOf(w).protection as unknown as {
      list: (after: string | null, n: number) => Promise<Json[]>;
    };
    const results = async () =>
      (await prot.list(null, 50)).filter((o) => o.request_id === id && o.kind === "result");
    expect(await results()).toHaveLength(1); // the orphan copy
    await passUntil(w, (s) => s === "released_to_buyer");
    expect(applied(w, "settle_hold")).toBe(0);
    expect(applied(w, "release_hold_for")).toBe(1);
    const mine = (await w.cara(`/api/customer/uses/${id}`)).body;
    expect(mine.use?.units?.unit ?? mine.units?.unit).toBe("returned");
    expect(w.rows("SELECT state FROM runtime_invocations WHERE purpose = 'customer_use'")).toEqual([
      { state: "completed" },
    ]);
    const swept = await usesOf(w).sweepProtected();
    expect(swept).toMatchObject({ deleted: 1, failed: 0 });
    expect(await results()).toHaveLength(0);
    expect((await w.cara(`/api/customer/uses/${id}/result`)).status).toBe(409);
  }, 90_000);
});
