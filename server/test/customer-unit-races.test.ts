// Job 003o1: release identity and delivery races. Astra's two reproductions at 3b0e661, then
// the missing branch evidence. Real app; the chain is the labelled TypeScript test double (the
// contract's own ABA proof is Rust unit tests c05/c06); synthetic edits are named. Finite.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";
import {
  CUSTOMER,
  type CustomerWorld,
  customerWorld,
  type Json,
  SyntheticProtection,
} from "./customer-world.ts";

const PROBE = "Fictional invoice 412 USD";
const INVOICE =
  "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD";
const sync = (w: CustomerWorld) => {
  w.clock.now = Number(w.chain.ts);
};
const all = (w: CustomerWorld, sql: string, ...a: string[]) =>
  w.state.store.db.prepare(sql).all(...a) as Json[];

async function world(extra: Parameters<typeof customerWorld>[0] = {}) {
  const protection = new SyntheticProtection();
  const w = await customerWorld({ ...extra, customer: { protection, ...extra.customer } });
  return { w, protection };
}

let n = 0;
async function reserve(w: CustomerWorld, input = PROBE) {
  sync(w);
  const offer = await w.offer();
  const p = await w.cara(`/api/customer/offers/${offer}/prepare`, "POST", {
    idempotency_key: `astra-unit-${String(++n).padStart(4, "0")}`,
    input,
  });
  expect(p.status).toBe(201);
  const c = await w.cara(
    `/api/customer/uses/${p.body.use.id}/confirm`,
    "POST",
    w.signed(p.body.use.envelope),
  );
  expect(c.body.use.state).toBe("reserved");
  return p.body.use.id as string;
}

async function units(w: CustomerWorld, id: string, steps = 4) {
  let u: Json = {};
  for (let i = 0; i < steps; i++) {
    sync(w);
    u = (await w.cara(`/api/customer/uses/${id}/units/reconcile`, "POST")).body.use.units;
    if (["charged", "returned", "conflict", "unknown"].includes(u.unit)) break;
  }
  return u;
}

describe("003o1 reproductions (Astra, 3b0e661)", () => {
  it("1: a delayed release can't close a re-created registration's hold with the same number", async () => {
    const { w } = await world();
    const id = await reserve(w);
    const gate = w.writer.holdNextUnit();
    sync(w);
    const pending = w.cara(`/api/customer/uses/${id}/release`, "POST");
    try {
      await gate.entered;
      // Labelled synthetic replacement: registration 1 gone, registration 2 funded with its own
      // hold 1 open (the contract's actual lifecycle for this is Rust test c05).
      const e2 = structuredClone(w.chain.ent()) as Json;
      e2.reg_id = "2";
      w.chain.ents.set(CUSTOMER, e2);
      w.chain.tick(1n);
    } finally {
      gate.open();
    }
    await pending;
    expect(w.chain.ent()?.hold_active).toBe(true);
    expect(w.writer.answers.at(-1)).toEqual({ status: "refused", code: "E_REGISTRATION" });
    // The next readback sees another registration: unknown, never "returned".
    const u = await units(w, id);
    expect(u).toMatchObject({ unit: "unknown", reason: "registration_changed" });
  });

  it("2: no release while a successful result is still being protected", async () => {
    const { w, protection } = await world();
    const id = await reserve(w, INVOICE);
    const gate = protection.holdResults();
    sync(w);
    const run = w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    try {
      await gate.entered; // the record is completed; the result is still being protected
      const r = await w.cara(`/api/customer/uses/${id}/units/reconcile`, "POST");
      expect(r.body.use.units.unit).toBe("reserved_awaiting_settlement");
      const rel = await w.cara(`/api/customer/uses/${id}/release`, "POST");
      expect(rel.body.code).toBe("delivery_pending");
      expect(w.writer.releaseCalls).toBe(0);
    } finally {
      gate.open();
    }
    await run;
    expect((await units(w, id)).unit).toBe("charged");
    expect(w.writer.releaseCalls).toBe(0);
  });
});

describe("003o1 delivery decision: pending, final, fenced", () => {
  it("a protection that fails after the wait is not delivered: the unit is released", async () => {
    const { w, protection } = await world();
    const id = await reserve(w, INVOICE);
    const gate = protection.holdResults();
    sync(w);
    const run = w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    try {
      await gate.entered;
      // While it waits: pending, so nothing is decided or released.
      const r = await w.cara(`/api/customer/uses/${id}/units/reconcile`, "POST");
      expect(r.body.use.execution.delivery).toBe("pending");
      protection.failProtect = 1; // it fails when it resumes
    } finally {
      gate.open();
    }
    await run;
    expect((await w.cara(`/api/customer/uses/${id}`)).body.use.execution).toMatchObject({
      delivery: "not_delivered",
      settlement_eligible: false,
    });
    expect((await units(w, id)).unit).toBe("returned");
    expect([w.writer.settleCalls, w.writer.releaseCalls]).toEqual([0, 1]);
  });

  it("restart while protecting: pending, then final after the timeout; the late copy is discarded", async () => {
    const dir = mkdtempSync(join(tmpdir(), "customer-delivery-"));
    const open: Store[] = [];
    let release = () => {};
    let stuck: Promise<unknown> = Promise.resolve();
    try {
      const { w, protection } = await world({ dbPath: join(dir, "app.db") });
      open.push(w.state.store);
      const id = await reserve(w, INVOICE);
      const gate = protection.holdResults();
      release = gate.open;
      sync(w);
      stuck = w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
      await gate.entered;
      const store = new Store(openDb(join(dir, "app.db")));
      open.push(store);
      w.state.store = store;
      w.state.app = w.make(store);
      // Undecided: neither the worker nor the customer can release it yet.
      expect(
        (await w.cara(`/api/customer/uses/${id}/units/reconcile`, "POST")).body.use.units.unit,
      ).toBe("reserved_awaiting_settlement");
      expect((await w.cara(`/api/customer/uses/${id}/release`, "POST")).body.code).toBe(
        "delivery_pending",
      );
      expect(await w.service().settleDue(5)).toEqual({ [id]: "not_decidable" });
      // Past the delivery timeout, recovery finalizes "not delivered" and releases the unit.
      w.chain.tick(300_000n);
      const u = await units(w, id);
      expect(u).toMatchObject({ unit: "returned", kind: "release" });
      expect((await w.cara(`/api/customer/uses/${id}`)).body.use.execution.delivery).toBe(
        "not_delivered",
      );
      // The late protection completes now: discarded, its copy deleted; still not delivered.
      gate.open();
      await stuck;
      const x = (await w.cara(`/api/customer/uses/${id}`)).body.use.execution;
      expect(x).toMatchObject({
        delivery: "not_delivered",
        settlement_eligible: false,
        result: "unavailable",
      });
      const kept = [...protection.kinds.entries()].filter(
        ([ref, k]) => k === "result" && protection.kept.has(ref),
      );
      expect(kept).toEqual([]);
      expect(
        all(w, "SELECT kind FROM customer_request_events WHERE kind = 'late_result_discarded'"),
      ).toHaveLength(1);
      expect([w.writer.settleCalls, w.chain.charged]).toEqual([0, 0]);
    } finally {
      release();
      await stuck.catch(() => {});
      for (const s of open)
        try {
          s.db.close();
        } catch {
          // already closed
        }
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});

describe("003o1 settlement branch evidence", () => {
  it("a registration replaced during settlement is unknown, with nothing submitted", async () => {
    const { w } = await world();
    const id = await reserve(w, INVOICE);
    sync(w);
    await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    // Synthetic replacement: the hold closed and another registration of the same account took
    // its place (coherent contract JSON; the actual lifecycle is Rust test c05).
    w.chain.release();
    const e2 = structuredClone(w.chain.ent()) as Json;
    e2.reg_id = "2";
    w.chain.ents.set(CUSTOMER, e2);
    w.chain.tick(1_000n);
    expect(await units(w, id)).toMatchObject({ unit: "unknown", reason: "registration_changed" });
    expect([w.writer.settleCalls, w.writer.releaseCalls]).toEqual([0, 0]);
  });

  it("a changed account mapping doesn't redirect the settlement: it stays the request's account", async () => {
    const { w } = await world();
    const id = await reserve(w, INVOICE);
    sync(w);
    await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    w.state.store.db
      .prepare("UPDATE chain_accounts SET account_id = 'cara2.near' WHERE owner_id = ?")
      .run(w.cara.id);
    expect((await units(w, id)).unit).toBe("charged");
    expect(w.chain.ent(CUSTOMER)?.consumed).toBe("1");
  });

  it("attempts are bounded: after five dropped settles, nothing more is sent", async () => {
    const { w } = await world();
    const id = await reserve(w, INVOICE);
    sync(w);
    await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    w.writer.unitModes = ["drop", "drop", "drop", "drop", "drop"];
    const u = await units(w, id, 8);
    expect(u).toMatchObject({
      unit: "charge_pending",
      reason: "attempts_exhausted",
      retryable: false,
    });
    expect([w.writer.settleCalls, w.chain.charged]).toEqual([5, 0]);
    await units(w, id, 2);
    expect(w.writer.settleCalls).toBe(5);
  });

  it("a lost or dropped release reply returns the unit exactly once", async () => {
    for (const mode of ["lose_reply", "drop"] as const) {
      const { w } = await world();
      const id = await reserve(w); // the probe document: refused by the model, so released
      sync(w);
      await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
      w.writer.unitModes = [mode];
      expect((await units(w, id)).unit, mode).toBe("returned");
      expect([w.writer.releaseCalls, w.chain.released], mode).toEqual([mode === "drop" ? 2 : 1, 1]);
    }
  });

  it("without platform authority, a release waits for the exact contract deadline", async () => {
    const { w } = await world();
    const id = await reserve(w);
    sync(w);
    await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    w.chain.afterSale(); // contract-produced: the platform no longer meters
    const until = BigInt(
      (await w.cara(`/api/customer/uses/${id}`)).body.use.reservation.settle_until_ms,
    );
    w.chain.tick(until - w.chain.ts); // block time exactly settle_until
    expect(await units(w, id, 1)).toMatchObject({
      unit: "release_pending",
      reason: "operator_not_authorized",
    });
    w.chain.tick(1n); // one millisecond later: anyone may release
    expect((await units(w, id)).unit).toBe("returned");
    expect(w.writer.releaseCalls).toBe(1);
  });

  it("a stale worker's conflicting read after a newer worker settled records no conflict", async () => {
    const { w } = await world();
    const id = await reserve(w, INVOICE);
    sync(w);
    await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    const gate = w.reader.holdNextRead();
    sync(w);
    const a = w.cara(`/api/customer/uses/${id}/units/reconcile`, "POST"); // worker A, held reading
    try {
      await gate.entered;
      w.clock.now += 31_000;
      w.chain.tick(31_000n);
      expect((await units(w, id)).unit).toBe("charged"); // worker B settles and confirms
      // A's read now answers from a conflicting block at B's evidence height (synthetic fork).
      const mark = JSON.parse(
        all(w, "SELECT evidence_mark FROM customer_requests")[0]?.evidence_mark,
      );
      w.reader.scripted = {
        block: { height: mark.height, hash: "C".repeat(32), timestamp_ms: mark.timestamp_ms },
        views: {},
      };
    } finally {
      gate.open();
    }
    await a;
    w.reader.scripted = null;
    expect(all(w, "SELECT conflict FROM customer_requests")[0]?.conflict).toBeNull();
    expect((await w.cara(`/api/customer/uses/${id}`)).body.use.units.unit).toBe("charged");
  });
});
