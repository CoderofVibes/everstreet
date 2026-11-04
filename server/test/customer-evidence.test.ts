// Job 003m1: reservation evidence is historical, fenced and monotonic. Reproductions of Astra's
// three independent findings at 5bb81a0 (docs/astra/jobs/2026-11-03_003m1_*), then the related
// boundary cases. The chain is a labelled test double seeded from contract-produced JSON; each
// historical or forked state below is a labelled synthetic edit of that JSON. Finite throughout.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decideReservation, decodeEntitlement } from "../src/customerRead.ts";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";
import {
  CUSTOMER,
  type CustomerWorld,
  customerWorld,
  type Json,
  OPERATOR,
  view,
} from "./customer-world.ts";

const INPUT = "Fictional invoice 412 USD";

async function prepared(w: CustomerWorld, key = "astra-probe-0001") {
  const offer = await w.offer();
  const r = await w.cara(`/api/customer/offers/${offer}/prepare`, "POST", {
    idempotency_key: key,
    input: INPUT,
  });
  expect(r.status).toBe(201);
  return { offer, use: r.body.use as Json };
}

const row = (w: CustomerWorld) =>
  w.state.store.db.prepare("SELECT * FROM customer_requests").get() as Json;

/** Synthetic: the funded fixture before its key was installed (slot 0 empty, epoch 0). */
function beforeKey() {
  const e = view("funded_100.entitlement");
  e.keys[0] = { ...e.keys[1], slot: 0 };
  e.key_states[0] = 0;
  e.key_epochs[0] = 0;
  return e;
}

/** Synthetic: the funded fixture with key 0 revoked (epoch 2), summaries matching. */
function revokedKey() {
  const e = view("funded_100.entitlement");
  e.keys[0] = { ...e.keys[0], state: "revoked", epoch: 2 };
  e.key_states[0] = 2;
  e.key_epochs[0] = 2;
  return e;
}

const B32 = "B".repeat(32);
const C32 = "C".repeat(32);

describe("003m1 reproductions (Astra, 5bb81a0)", () => {
  it("1: a first readback below the prepared block is stale, never a refusal", async () => {
    const w = await customerWorld();
    const { use } = await prepared(w);
    expect(JSON.parse(row(w).prepared_block).height).toBe("1000");
    w.reader.scripted = {
      block: { height: "999", hash: B32, timestamp_ms: String(w.chain.ts - 1000n) },
      views: { get_entitlement: beforeKey() },
    };
    const c = await w.cara(`/api/customer/uses/${use.id}/confirm`, "POST", w.signed(use.envelope));
    expect(w.chain.opened).toBe(1); // the writer did open one hold
    expect(c.body.use.state).toBe("reserve_unknown");
    expect(c.body.use.reason).not.toBe("key_changed");
    expect(row(w).allocation).not.toBeNull();
    // A current read then finds exactly our hold.
    w.reader.scripted = null;
    const r = await w.cara(`/api/customer/uses/${use.id}/reconcile`, "POST");
    expect(r.body.use.state).toBe("reserved");
    expect(w.chain.opened).toBe(1);
  });

  it("2: a different hash at the evidence height is a sticky conflict: no refusal, release or resend", async () => {
    const w = await customerWorld();
    const { use } = await prepared(w);
    w.writer.modes = ["drop", "drop"];
    const c = await w.cara(`/api/customer/uses/${use.id}/confirm`, "POST", w.signed(use.envelope));
    expect(c.body.use.state).toBe("reserve_unknown");
    const at = JSON.parse(row(w).evidence ?? row(w).prepared_block);
    const height = at.block?.height ?? at.height;
    expect(height).toBe("1000");
    const calls = w.writer.calls;
    w.reader.scripted = {
      block: { height: "1000", hash: C32, timestamp_ms: String(w.chain.ts) },
      views: { get_entitlement: revokedKey() },
    };
    const r = await w.cara(`/api/customer/uses/${use.id}/reconcile`, "POST");
    expect(r.body.use).toMatchObject({
      state: "reserve_unknown",
      reason: "evidence_conflict",
      evidence_conflict: "equal_height_hash_differs",
    });
    expect(row(w).allocation).not.toBeNull();
    expect(w.writer.calls).toBe(calls);
    // Sticky: a later honest block does not silently clear it; nothing is resent.
    w.reader.scripted = null;
    w.chain.tick(1_000n);
    const later = await w.cara(`/api/customer/uses/${use.id}/reconcile`, "POST");
    expect(later.body.use).toMatchObject({ state: "reserve_unknown", reason: "evidence_conflict" });
    expect(w.writer.calls).toBe(calls);
    expect(w.chain.opened).toBe(0);
  });

  it("3: a reservation read after serve_until is historical: serving is false", async () => {
    const w = await customerWorld();
    const { use } = await prepared(w);
    w.reader.failNext = 1;
    const c = await w.cara(`/api/customer/uses/${use.id}/confirm`, "POST", w.signed(use.envelope));
    expect(c.body.use.state).toBe("reserve_unknown");
    expect(w.chain.opened).toBe(1);
    w.chain.tick(BigInt(use.envelope.hold.serve_until_ms) - w.chain.ts + 1n);
    w.clock.now = Number(w.chain.ts);
    const r = await w.cara(`/api/customer/uses/${use.id}/reconcile`, "POST");
    expect(r.body.use).toMatchObject({ state: "reserved", serving: false });
    expect(r.body.use.ready_now).toBe(false);
  });
});

describe("003m1 evidence boundaries", () => {
  it("the same hash with a different view, or a different timestamp, is a conflict", async () => {
    for (const change of ["view", "timestamp"] as const) {
      const w = await customerWorld();
      const { use } = await prepared(w, `probe-${change}-01`);
      w.writer.modes = ["drop", "drop"];
      await w.cara(`/api/customer/uses/${use.id}/confirm`, "POST", w.signed(use.envelope));
      const block = w.chain.block();
      w.reader.scripted = {
        block: change === "timestamp" ? { ...block, timestamp_ms: String(w.chain.ts + 5n) } : block,
        views: {
          get_entitlement:
            change === "view"
              ? { ...view("funded_100.entitlement"), free: "99" }
              : view("funded_100.entitlement"),
        },
      };
      const calls = w.writer.calls;
      const r = await w.cara(`/api/customer/uses/${use.id}/reconcile`, "POST");
      expect(r.body.use, change).toMatchObject({
        state: "reserve_unknown",
        reason: "evidence_conflict",
        evidence_conflict:
          change === "view" ? "equal_block_view_differs" : "equal_block_time_differs",
      });
      expect(w.writer.calls).toBe(calls);
    }
  });

  it("an identical re-read of the evidence block is not a conflict", async () => {
    const w = await customerWorld();
    const { use } = await prepared(w);
    w.writer.modes = ["drop", "drop"];
    await w.cara(`/api/customer/uses/${use.id}/confirm`, "POST", w.signed(use.envelope));
    const r = await w.cara(`/api/customer/uses/${use.id}/reconcile`, "POST");
    expect(r.body.use.reason).not.toBe("evidence_conflict");
    expect(r.body.use.state).toBe("reserve_unknown"); // still pending; resent once more
  });

  it("a later block with a regression (key epoch, hold sequence, registration, time) is inconsistent, never a refusal", async () => {
    const regress: [string, (w: CustomerWorld) => Json, string][] = [
      ["key epoch", () => beforeKey(), "key_epoch_regressed"],
      [
        "hold sequence",
        () => ({ ...view("funded_100.entitlement"), hold_seq: 0 }),
        "hold_sequence_regressed",
      ],
      [
        "registration",
        () => ({ ...view("funded_100.entitlement"), reg_id: "0" }),
        "registration_regressed",
      ],
    ];
    for (const [name, make, reason] of regress) {
      const w = await customerWorld();
      // The baseline: hold sequence 1 already used elsewhere (synthetic skip), so ours is 2.
      if (name === "hold sequence") w.chain.skip();
      const { use } = await prepared(w, `probe-${name.replace(" ", "-")}`);
      w.writer.modes = ["drop", "drop"];
      await w.cara(`/api/customer/uses/${use.id}/confirm`, "POST", w.signed(use.envelope));
      w.chain.tick(1_000n);
      w.reader.scripted = { block: w.chain.block(), views: { get_entitlement: make(w) } };
      const calls = w.writer.calls;
      const r = await w.cara(`/api/customer/uses/${use.id}/reconcile`, "POST");
      expect(r.body.use, name).toMatchObject({
        state: "reserve_unknown",
        reason: "evidence_conflict",
        evidence_conflict: reason,
      });
      expect(row(w).allocation, name).not.toBeNull();
      expect(w.writer.calls, name).toBe(calls);
    }
    // A higher block whose timestamp didn't rise (assumption A1 broken): also a conflict.
    const w = await customerWorld();
    const { use } = await prepared(w, "probe-time-0001");
    w.writer.modes = ["drop", "drop"];
    await w.cara(`/api/customer/uses/${use.id}/confirm`, "POST", w.signed(use.envelope));
    const b = w.chain.block();
    w.reader.scripted = {
      block: { height: String(Number(b.height) + 1), hash: B32, timestamp_ms: b.timestamp_ms },
      views: { get_entitlement: view("funded_100.entitlement") },
    };
    const r = await w.cara(`/api/customer/uses/${use.id}/reconcile`, "POST");
    expect(r.body.use).toMatchObject({
      state: "reserve_unknown",
      reason: "evidence_conflict",
      evidence_conflict: "block_time_not_rising",
    });
  });

  it("a writer or reader on another network is never called with the request", async () => {
    const w = await customerWorld();
    const { use, offer } = await prepared(w);
    Object.defineProperty(w.writer, "network", { value: "mainnet" });
    const c = await w.cara(`/api/customer/uses/${use.id}/confirm`, "POST", w.signed(use.envelope));
    expect([c.status, c.body.code]).toEqual([409, "binding_mismatch"]);
    expect(w.writer.calls).toBe(0);
    expect(row(w).state).toBe("prepared");
    // Preparation refuses up front too, and a step that finds a mismatch sends nothing.
    await w.cara(`/api/customer/uses/${use.id}/cancel`, "POST");
    const p = await w.cara(`/api/customer/offers/${offer}/prepare`, "POST", {
      idempotency_key: "probe-net-0002",
      input: INPUT,
    });
    expect(p.body.code).toBe("binding_mismatch");
    const v = await customerWorld();
    const q = await prepared(v);
    v.writer.modes = ["drop"];
    v.reader.failNext = 1;
    await v.cara(`/api/customer/uses/${q.use.id}/confirm`, "POST", v.signed(q.use.envelope));
    const calls = v.writer.calls;
    Object.defineProperty(v.writer, "network", { value: "mainnet" });
    const r = await v.cara(`/api/customer/uses/${q.use.id}/reconcile`, "POST");
    expect(r.body.use.reason).toBe("binding_mismatch");
    expect(v.writer.calls).toBe(calls);
  });

  it("platform policy is narrower than contract authority: an owner account without a grant is not admitted", async () => {
    const w = await customerWorld();
    // Synthetic: the platform's configured account is the owner, with no operator grant. The
    // contract would let it meter (c01); the platform acts only as a granted operator.
    w.chain.control = { ...w.chain.control, owner: OPERATOR, operators: [] };
    const offer = await w.offer();
    const p = await w.cara(`/api/customer/offers/${offer}/prepare`, "POST", {
      idempotency_key: "probe-own-0001",
      input: INPUT,
    });
    expect([p.status, p.body.code]).toEqual([409, "operator_not_authorized"]);
    const { contractMeters, platformMeters } = await import("../src/customerRead.ts");
    const { decodeControl } = await import("../src/v3read.ts");
    const control = decodeControl(w.chain.control);
    expect([contractMeters(control, OPERATOR), platformMeters(control, OPERATOR)]).toEqual([
      true,
      false,
    ]);
  });

  it("confirm rechecks the account mapping and the offer after preparing", async () => {
    const w = await customerWorld();
    const { use, offer } = await prepared(w);
    w.state.store.db
      .prepare("UPDATE chain_accounts SET account_id = 'cara2.near' WHERE owner_id = ?")
      .run(w.cara.id);
    const c = await w.cara(`/api/customer/uses/${use.id}/confirm`, "POST", w.signed(use.envelope));
    expect(c.body.code).toBe("account_changed");
    w.state.store.db
      .prepare("UPDATE chain_accounts SET account_id = ? WHERE owner_id = ?")
      .run(CUSTOMER, w.cara.id);
    await w.owner(`/api/businesses/${w.f.business}/customer-offers/${offer}/retire`, "POST");
    const d = await w.cara(`/api/customer/uses/${use.id}/confirm`, "POST", w.signed(use.envelope));
    expect(d.body.code).toBe("offer_retired");
    expect(w.writer.calls).toBe(0);
  });
});

describe("003m1 deadline and restart", () => {
  it("serving ends exactly at serve_until (the hold's window; revoke_key lowers it to now)", () => {
    const active = decodeEntitlement(view("active_hold.entitlement"));
    const exp = {
      reg_id: "1",
      key_slot: 0,
      key_epoch: 1,
      hold_seq: 3,
      units: 10,
      serve_until_ms: "1793578800000",
      settle_until_ms: "1793579400000",
      accept_by_ms: "1793578740000",
    };
    expect(decideReservation(exp, active, "1793578799999")).toMatchObject({
      serving: true,
      reason: null,
    });
    expect(decideReservation(exp, active, "1793578800000")).toMatchObject({
      kind: "reserved",
      serving: false,
      reason: "serve_window_passed",
    });
  });

  it("after a restart the fence holds, including for a 003m row without a mark", async () => {
    const dir = mkdtempSync(join(tmpdir(), "customer-evidence-"));
    const open: Store[] = [];
    try {
      const w = await customerWorld({ dbPath: join(dir, "app.db") });
      open.push(w.rw.store);
      const { use } = await prepared(w);
      w.writer.modes = ["drop", "drop"];
      await w.cara(`/api/customer/uses/${use.id}/confirm`, "POST", w.signed(use.envelope));
      // Synthetic: the row as 003m stored it (no mark, no evidence beyond preparation).
      w.state.store.db
        .prepare(
          "UPDATE customer_requests SET evidence_mark = NULL, evidence_height = NULL, evidence = NULL",
        )
        .run();
      const store = new Store(openDb(join(dir, "app.db")));
      open.push(store);
      w.state.store = store;
      w.state.app = w.make(store);
      // Below the prepared block: stale. At it with another hash: a sticky conflict.
      w.reader.scripted = {
        block: { height: "999", hash: B32, timestamp_ms: String(w.chain.ts - 1000n) },
        views: { get_entitlement: beforeKey() },
      };
      const s = await w.cara(`/api/customer/uses/${use.id}/reconcile`, "POST");
      expect(s.body.use.state).toBe("reserve_unknown");
      w.reader.scripted = {
        block: { height: "1000", hash: C32, timestamp_ms: String(w.chain.ts) },
        views: { get_entitlement: revokedKey() },
      };
      const r = await w.cara(`/api/customer/uses/${use.id}/reconcile`, "POST");
      expect(r.body.use).toMatchObject({
        state: "reserve_unknown",
        reason: "evidence_conflict",
        evidence_conflict: "equal_height_hash_differs",
      });
      const kinds = (
        store.db.prepare("SELECT kind FROM customer_request_events ORDER BY seq").all() as Json[]
      ).map((e) => e.kind);
      expect(kinds).toContain("stale_read");
      expect(row(w).allocation).not.toBeNull();
      expect(w.chain.opened).toBe(0);
    } finally {
      for (const s of open)
        try {
          s.db.close();
        } catch {
          // already closed
        }
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
