// Job 003m: durable customer preparation and reservation through the real app factory with
// injected adapters (docs/design/CUSTOMER_USE_RUNTIME.md §3, §5, §8). The chain is a labelled test
// double seeded from contract-produced JSON (customer-world.ts); it executes no transaction and
// proves no live authorization. Signatures come from the contract tests' synthetic seed-1 key.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decideReservation, decodeEntitlement, decodePlan } from "../src/customerRead.ts";
import {
  closedRootPreimage,
  preimageOfHold,
  preimageOfUse,
  sha256Hex,
  verifiesEd25519,
} from "../src/customerSigning.ts";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";
import { V3ReadError } from "../src/v3read.ts";
import {
  CUSTOMER,
  type CustomerWorld,
  clientCheck,
  customerWorld,
  type Json,
  keyFromSeed,
  OPERATOR,
  READBACK,
  SIGNING,
  SyntheticProtection,
  view,
} from "./customer-world.ts";

const INPUT = "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD";

async function prepare(w: CustomerWorld, key = "use-key-0001", input = INPUT, who = w.cara) {
  const offer = await w.offer();
  const r = await who(`/api/customer/offers/${offer}/prepare`, "POST", {
    idempotency_key: key,
    input,
  });
  return { offer, r, use: r.body.use as Json };
}

async function reserve(w: CustomerWorld) {
  const { use } = await prepare(w);
  const c = await w.cara(`/api/customer/uses/${use.id}/confirm`, "POST", w.signed(use.envelope));
  return { use, c };
}

const rows = (w: CustomerWorld, sql: string, ...a: string[]) =>
  w.state.store.db.prepare(sql).all(...a) as Json[];

describe("003m canonical bytes match the contract", () => {
  it("encodes the contract's hold and use messages and closed roots byte for byte", () => {
    const k = {
      business: SIGNING.business,
      plan_id: SIGNING.plan_id,
      customer: SIGNING.customer,
      reg_id: SIGNING.reg_id,
      key_slot: SIGNING.key_slot,
      key_epoch: SIGNING.key_epoch,
    };
    expect(preimageOfHold(k, SIGNING.hold).toString("hex")).toBe(SIGNING.hold.preimage_hex);
    expect(
      preimageOfUse(k, {
        hold_seq: SIGNING.use.hold_seq,
        slot: SIGNING.use.slot,
        fingerprint: SIGNING.use.fingerprint_hex,
      }).toString("hex"),
    ).toBe(SIGNING.use.preimage_hex);
    for (const r of [SIGNING.closed_root_one, SIGNING.closed_root_partial]) {
      const used = Object.entries(r.used as Record<string, string>).map(
        ([s, f]) => [Number(s), f] as const,
      );
      expect(sha256Hex(closedRootPreimage(used))).toBe(r.root_hex);
    }
    expect(sha256Hex(closedRootPreimage([]))).toBe(SIGNING.closed_root_empty.root_hex);
    expect(
      verifiesEd25519(SIGNING.public_key_hex, SIGNING.hold.message_hex, SIGNING.hold.signature_hex),
    ).toBe(true);
    expect(
      verifiesEd25519(SIGNING.public_key_hex, SIGNING.use.message_hex, SIGNING.hold.signature_hex),
    ).toBe(false);
    expect(verifiesEd25519(SIGNING.public_key_hex, SIGNING.hold.message_hex, "zz")).toBe(false);
    // The test client's seed-1 key is the contract tests' key.
    expect(keyFromSeed(1)(SIGNING.hold.message_hex)).toBe(SIGNING.hold.signature_hex);
  });
});

describe("003m strict readback decoding (contract-produced JSON)", () => {
  it("decodes every entitlement and the plan the contract produced", () => {
    for (const k of Object.keys(READBACK).filter((k) => k.endsWith(".entitlement")))
      expect(decodeEntitlement(view(k))?.reg_id).toBe("1");
    expect(decodePlan(view("plan_1"))?.hold_ttl_ms).toBe("1800000");
    expect(decodeEntitlement(null)).toBeNull();
  });

  it("refuses synthetic mutations: an extra or missing field, a slot count, a key summary, a decimal", () => {
    const e = view("active_hold.entitlement");
    const refuses = (v: unknown) => expect(() => decodeEntitlement(v)).toThrow(V3ReadError);
    refuses({ ...e, extra: 1 });
    const { paused: _p, ...missing } = e;
    refuses(missing);
    refuses({ ...e, hold_slots: e.hold_slots.slice(1) });
    refuses({ ...e, key_epochs: [2, 0, 0, 0] });
    refuses({ ...e, free: "070" });
    refuses({ ...e, hold_seq: -1 });
  });
});

describe("003m the reservation decision table (§5.2)", () => {
  // The active fixture hold: seq 3, 10 units, key 0 at epoch 1.
  const active = decodeEntitlement(view("active_hold.entitlement"));
  const exact = {
    reg_id: "1",
    key_slot: 0,
    key_epoch: 1,
    hold_seq: 3,
    units: 10,
    serve_until_ms: "1793578800000",
    settle_until_ms: "1793579400000",
    accept_by_ms: "1793578740000",
  };
  const ts = "1793577600000";

  it("row 2: exactly our hold is reserved; rows 1 and 4 otherwise", () => {
    expect(decideReservation(exact, active, ts)).toMatchObject({
      kind: "reserved",
      serving: true,
      row: 2,
    });
    expect(decideReservation({ ...exact, reg_id: "2" }, active, ts)).toMatchObject({
      row: 1,
      kind: "unresolved",
    });
    expect(decideReservation(exact, null, ts)).toMatchObject({ row: 1 });
    // Same sequence, another HoldAuth (one unit, not ten): ours can never open.
    expect(decideReservation({ ...exact, units: 1 }, active, ts)).toMatchObject({
      kind: "refused",
      reason: "superseded",
      row: 4,
    });
    expect(decideReservation({ ...exact, settle_until_ms: "1" }, active, ts)).toMatchObject({
      row: 4,
    });
  });

  it("row 3: revoked after it opened (synthetic: revoke_key's effect on the fixture)", () => {
    const revoked = decodeEntitlement({
      ...view("active_hold.entitlement"),
      serve_until_ms: "1793578000000",
      key_states: [2, 0, 0, 0],
      key_epochs: [2, 0, 0, 0],
      keys: view("active_hold.entitlement").keys.map((k: Json, i: number) =>
        i === 0 ? { ...k, state: "revoked", epoch: 2 } : k,
      ),
    });
    expect(decideReservation(exact, revoked, ts)).toMatchObject({
      kind: "reserved",
      serving: false,
      reason: "key_revoked",
      row: 3,
    });
    // A lower serving time without a revocation is not explainable: flagged, never resolved.
    const lower = decodeEntitlement({
      ...view("active_hold.entitlement"),
      serve_until_ms: "1793578000000",
    });
    expect(decideReservation(exact, lower, ts)).toMatchObject({ kind: "inconsistent", row: 5 });
  });

  it("rows 5–9 on closed and pending holds", () => {
    const consumed = decodeEntitlement(view("consumed_20.entitlement")); // hold_seq 2, closed
    const next = { ...exact, hold_seq: 3, units: 1 };
    expect(decideReservation(next, consumed, ts)).toMatchObject({
      kind: "pending",
      blocked: null,
      row: 8,
    });
    expect(decideReservation({ ...next, key_epoch: 2 }, consumed, ts)).toMatchObject({
      kind: "refused",
      reason: "key_changed",
      row: 6,
    });
    expect(decideReservation(next, consumed, "1793578740001")).toMatchObject({
      kind: "refused",
      reason: "expired_unopened",
      row: 7,
    });
    expect(decideReservation(next, consumed, "1793578740000")).toMatchObject({
      kind: "pending",
      row: 8,
    });
    expect(decideReservation({ ...next, hold_seq: 5 }, consumed, ts)).toMatchObject({
      kind: "inconsistent",
      row: 5,
    });
    // Released after its deadline (hold_seq 3, closed): which HoldAuth opened 3 isn't readable.
    const released = decodeEntitlement(view("released_after_deadline.entitlement"));
    expect(decideReservation(next, released, ts)).toMatchObject({
      kind: "unresolved",
      reason: "sequence_used",
      row: 9,
    });
    expect(decideReservation({ ...next, hold_seq: 2 }, active, ts)).toMatchObject({
      kind: "unresolved",
      row: 9,
    });
    const paused = decodeEntitlement({ ...view("consumed_20.entitlement"), paused: true });
    expect(decideReservation(next, paused, ts)).toMatchObject({
      kind: "pending",
      blocked: "paused",
    });
  });
});

describe("003m customer preparation and reservation (real API, injected adapters)", () => {
  it("with nothing configured, answers unavailable and creates nothing", async () => {
    const w = await customerWorld({ noReader: true, noWriter: true });
    const r = await w.owner(`/api/businesses/${w.f.business}/customer-offers`, "POST", {
      idempotency_key: "offer-key-0001",
      release_id: w.release,
      plan_id: 1,
    });
    expect([r.status, r.body.code]).toEqual([503, "customer_use_unavailable"]);
    expect(rows(w, "SELECT * FROM customer_offers")).toHaveLength(0);
    expect(w.chain.calls).toBe(0);
  });

  it("offers are the owner's, fenced, exact and idempotent; they carry no customer data", async () => {
    const w = await customerWorld();
    const stranger = w.person("Noah Fenn");
    const body = { idempotency_key: "offer-key-0001", release_id: w.release, plan_id: 1 };
    expect(
      (await stranger(`/api/businesses/${w.f.business}/customer-offers`, "POST", body)).status,
    ).toBe(404);
    expect(
      (
        await w.owner(`/api/businesses/${w.f.business}/customer-offers`, "POST", {
          ...body,
          plan_id: 7,
        })
      ).body.code,
    ).toBe("no_such_plan");
    const first = await w.owner(`/api/businesses/${w.f.business}/customer-offers`, "POST", body);
    expect(first.status).toBe(201);
    expect(first.body.offer).toMatchObject({
      plan_id: 1,
      asset: "tusd.near",
      retention_days: 30,
      state: "active",
    });
    expect(first.body.offer.plan.unit_price).toBe("50000");
    const again = await w.owner(`/api/businesses/${w.f.business}/customer-offers`, "POST", body);
    expect([again.status, again.body.offer.id]).toEqual([200, first.body.offer.id]);
    const changed = await w.owner(`/api/businesses/${w.f.business}/customer-offers`, "POST", {
      ...body,
      retention_days: 7,
    });
    expect(changed.body.code).toBe("idempotency_conflict");
    const other = await w.owner(`/api/businesses/${w.f.business}/customer-offers`, "POST", {
      ...body,
      idempotency_key: "offer-key-0002",
    });
    expect(other.body.code).toBe("offer_exists");
    // Retired: preparation is refused.
    await w.owner(
      `/api/businesses/${w.f.business}/customer-offers/${first.body.offer.id}/retire`,
      "POST",
    );
    const p = await w.cara(`/api/customer/offers/${first.body.offer.id}/prepare`, "POST", {
      idempotency_key: "use-key-0001",
      input: INPUT,
    });
    expect(p.body.code).toBe("offer_retired");
    // The trigger keeps an offer immutable but for retirement.
    expect(() => w.state.store.db.prepare("UPDATE customer_offers SET plan_id = 2").run()).toThrow(
      /immutable/,
    );
  });

  it("prepares an exact envelope the client can check, then reserves it from exact readback", async () => {
    const w = await customerWorld();
    const { r, use } = await prepare(w);
    expect(r.status).toBe(201);
    expect(use).toMatchObject({
      state: "prepared",
      label: "Prepared",
      reservation: { hold_seq: 1, units: 1, customer_account: CUSTOMER },
    });
    const env = use.envelope;
    expect(clientCheck(env)).toBe(true);
    expect(env).toMatchObject({
      network: "testnet",
      business_account: "studio.biz.near",
      public_key: SIGNING.public_key_hex,
      consent: { unit_price: "50000", asset: "tusd.near", units: 1 },
    });
    // serve_until = block time + 10 min; accept_by = serve_until − 60 s; sign_by 2 min earlier.
    expect(BigInt(env.hold.serve_until_ms) - BigInt(w.chain.ts)).toBe(600_000n);
    expect(BigInt(env.consent.accept_by_ms)).toBe(BigInt(env.hold.serve_until_ms) - 60_000n);
    const c = await w.cara(`/api/customer/uses/${use.id}/confirm`, "POST", w.signed(env));
    expect(c.status).toBe(200);
    expect(c.body.use).toMatchObject({
      state: "reserved",
      label: "Reserved",
      serving: true,
      envelope: null,
    });
    expect(c.body.use.evidence).toMatchObject({
      decision: "reserved",
      row: 2,
      block: { timestamp_ms: String(w.chain.ts) },
    });
    expect(w.chain.opened).toBe(1);
    expect(w.chain.ent()?.hold_seq).toBe(1);
    // Events carry codes and blocks only: no salt, no signatures, no input.
    const events = JSON.stringify(rows(w, "SELECT * FROM customer_request_events"));
    for (const secret of [env.commitment.salt_hex, w.signed(env).hold_signature, INPUT])
      expect(events).not.toContain(secret);
    expect(
      rows(w, "SELECT kind FROM customer_request_events ORDER BY seq").map((e) => e.kind),
    ).toEqual(["prepared", "confirmed", "submit", "writer_answer", "read"]);
    // No plaintext input anywhere in the database without a protection seam.
    const dump = JSON.stringify(rows(w, "SELECT * FROM customer_requests"));
    expect(dump).not.toContain("Stackline");
    expect(c.body.use.input).toMatchObject({ retained: false, chars: INPUT.length });
  });

  it("idempotency: a lost reply recovers the same preparation; changed input conflicts; a second key waits", async () => {
    const w = await customerWorld();
    const { use, offer } = await prepare(w);
    const again = await w.cara(`/api/customer/offers/${offer}/prepare`, "POST", {
      idempotency_key: "use-key-0001",
      input: INPUT,
    });
    expect([again.status, again.body.use.id, again.body.use.envelope.envelope_digest]).toEqual([
      200,
      use.id,
      use.envelope.envelope_digest,
    ]);
    const changed = await w.cara(`/api/customer/offers/${offer}/prepare`, "POST", {
      idempotency_key: "use-key-0001",
      input: `${INPUT}.`,
    });
    expect([changed.status, changed.body.code]).toEqual([409, "idempotency_conflict"]);
    const second = await w.cara(`/api/customer/offers/${offer}/prepare`, "POST", {
      idempotency_key: "use-key-0002",
      input: INPUT,
    });
    expect([second.status, second.body.code]).toEqual([409, "use_in_progress"]);
    expect(rows(w, "SELECT id FROM customer_requests")).toHaveLength(1);
  });

  it("two requests racing allocate one sequence; the same key racing gives one row", async () => {
    const w = await customerWorld();
    const offer = await w.offer();
    const go = (key: string) =>
      w.cara(`/api/customer/offers/${offer}/prepare`, "POST", {
        idempotency_key: key,
        input: INPUT,
      });
    const [a, b] = await Promise.all([go("use-key-000a"), go("use-key-000b")]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect([a.body.code, b.body.code]).toContain("use_in_progress");
    const winner = a.status === 201 ? "use-key-000a" : "use-key-000b";
    const [c, d] = await Promise.all([go(winner), go(winner)]);
    expect([c.status, d.status]).toEqual([200, 200]);
    expect([c.body.use.id, d.body.use.id]).toEqual([c.body.use.id, c.body.use.id]);
    expect(rows(w, "SELECT id FROM customer_requests")).toHaveLength(1);
  });

  it("refuses the wrong person, envelope, signature, key and deadline without changing anything", async () => {
    const w = await customerWorld();
    const { use } = await prepare(w);
    const env = use.envelope;
    const lena = w.person("Lena Park");
    expect((await lena(`/api/customer/uses/${use.id}`)).status).toBe(404);
    expect((await w.owner(`/api/customer/uses/${use.id}`)).status).toBe(404);
    expect((await lena(`/api/customer/uses/${use.id}/confirm`, "POST", w.signed(env))).status).toBe(
      404,
    );
    const confirm = (b: Json) => w.cara(`/api/customer/uses/${use.id}/confirm`, "POST", b);
    expect((await confirm({ ...w.signed(env), envelope_digest: "0".repeat(64) })).body.code).toBe(
      "envelope_mismatch",
    );
    // Another key (seed 2), the hold signature in the use's place, the preimage signed.
    expect((await confirm(w.signed(env, keyFromSeed(2)))).body.code).toBe("signature_invalid");
    const s = w.signed(env);
    expect((await confirm({ ...s, use_signature: s.hold_signature })).status).toBe(422);
    expect(
      (await confirm({ ...s, hold_signature: w.sign1(env.hold.preimage_hex.slice(0, 64)) })).status,
    ).toBe(422);
    expect((await confirm({ ...s, hold_signature: "ab" })).status).toBe(400);
    expect(w.writer.calls).toBe(0);
    expect((await w.cara(`/api/customer/uses/${use.id}`)).body.use.state).toBe("prepared");
    // Past sign_by (server clock): expired, nothing sent.
    w.clock.now = Number(env.consent.sign_by_ms) + 1;
    expect((await confirm(s)).body.code).toBe("preparation_expired");
    expect((await w.cara(`/api/customer/uses/${use.id}`)).body.use.state).toBe("expired");
    expect(w.writer.calls).toBe(0);
  });

  it("refuses an unlinked account, a missing entitlement, an inactive key and bounds", async () => {
    const w = await customerWorld();
    const offer = await w.offer();
    const go = (who: typeof w.cara, b: Json) =>
      who(`/api/customer/offers/${offer}/prepare`, "POST", b);
    const ok = { idempotency_key: "use-key-0001", input: INPUT };
    const noah = w.person("Noah Fenn");
    expect((await go(noah, ok)).body.code).toBe("no_chain_account");
    w.link(noah.id, "noah.near"); // a linked account with no entitlement on the contract
    expect((await go(noah, ok)).body.code).toBe("no_entitlement");
    expect((await go(w.cara, { ...ok, key_slot: 1 })).body.code).toBe("key_not_active");
    expect((await go(w.cara, { ...ok, key_slot: 9 })).status).toBe(400);
    expect((await go(w.cara, { ...ok, input: "x".repeat(20_001) })).status).toBe(400);
    expect((await go(w.cara, { ...ok, input: "" })).status).toBe(400);
    expect((await go(w.cara, { ...ok, idempotency_key: "short" })).status).toBe(400);
    w.chain.pause(true);
    expect((await go(w.cara, ok)).body.code).toBe("paused");
    w.chain.pause(false);
    // Unreadable or incoherent evidence fails closed.
    w.reader.malformedNext = true;
    expect((await go(w.cara, ok)).body.code).toBe("read_malformed");
    w.reader.mixNext = true;
    expect((await go(w.cara, ok)).body.code).toBe("read_mixed_blocks");
    w.reader.failNext = 1;
    expect((await go(w.cara, ok)).body.code).toBe("read_unavailable");
    expect(rows(w, "SELECT id FROM customer_requests")).toHaveLength(0);
  });

  it("a lost open_hold reply is recovered by readback: one hold, never a second", async () => {
    const w = await customerWorld();
    w.writer.modes = ["lose_reply"];
    const { c } = await reserve(w);
    expect(c.body.use).toMatchObject({ state: "reserved", submissions: 1 });
    expect(w.chain.opened).toBe(1);
    // Reconciling again changes nothing and sends nothing.
    const again = await w.cara(`/api/customer/uses/${c.body.use.id}/reconcile`, "POST");
    expect(again.body.use.state).toBe("reserved");
    expect(w.writer.calls).toBe(1);
  });

  it("a request that never arrived is resent exactly; an exact resend of an open hold is 'already'", async () => {
    const w = await customerWorld();
    w.writer.modes = ["drop"];
    const { c } = await reserve(w);
    // Read pending (row 8), then the identical payload again in the same step.
    expect(c.body.use).toMatchObject({ state: "reserve_unknown", submissions: 2 });
    expect(w.chain.opened).toBe(1);
    const r = await w.cara(`/api/customer/uses/${c.body.use.id}/reconcile`, "POST");
    expect(r.body.use.state).toBe("reserved");
    // The same HoldAuth once more, as a crashed worker would: "already", still one hold.
    w.writer.modes = [];
    const row = rows(w, "SELECT * FROM customer_requests")[0] as Json;
    const answer = await w.writer.openHold({
      network: "testnet",
      account: "studio.biz.near",
      customer: CUSTOMER,
      plan_id: 1,
      auth: {
        hold_seq: 1,
        units: 1,
        serve_until_ms: row.serve_until_ms,
        key_slot: 0,
        key_epoch: 1,
      },
      sig: row.hold_sig,
      signal: new AbortController().signal,
    });
    expect(answer).toEqual({ status: "already" });
    expect(w.chain.opened).toBe(1);
  });

  it("a stale worker's late result never overwrites the newer outcome", async () => {
    const w = await customerWorld();
    const { use } = await prepare(w);
    const gateA = w.writer.holdNext();
    const gateB = w.writer.holdNext();
    const first = w.cara(`/api/customer/uses/${use.id}/confirm`, "POST", w.signed(use.envelope));
    let second: ReturnType<typeof w.cara> = Promise.resolve({ status: 0, body: {} });
    try {
      await gateA.entered; // worker A is inside the writer, under lease generation 1
      w.clock.now += 31_000; // its lease has passed
      // Worker B (generation 2) reads pending and resends; it is held inside the writer too.
      second = w.cara(`/api/customer/uses/${use.id}/reconcile`, "POST");
      await gateB.entered;
      gateA.open(); // A's HoldAuth lands on the chain, but A no longer holds the lease
      const a = await first;
      expect(a.body.use.state).toBe("reserve_unknown"); // A recorded nothing and decided nothing
      expect(
        rows(w, "SELECT * FROM customer_request_events WHERE kind = 'writer_answer'"),
      ).toHaveLength(0);
      gateB.open(); // B's identical resend answers "already"
      expect((await second).body.use.state).toBe("reserve_unknown");
      const done = await w.cara(`/api/customer/uses/${use.id}/reconcile`, "POST");
      expect(done.body.use.state).toBe("reserved");
    } finally {
      gateA.open();
      gateB.open();
      await first.catch(() => {});
      await second.catch(() => {});
    }
    expect(w.writer.answers.map((x) => x.status)).toEqual(["opened", "already"]);
    expect(w.chain.opened).toBe(1);
    const leases = rows(
      w,
      "SELECT lease_gen FROM customer_request_events WHERE kind = 'writer_answer'",
    );
    expect(leases.map((e) => e.lease_gen)).toEqual([2]);
  });

  it("advanced hold history never authorizes a fresh hold: superseded, sequence used, expired", async () => {
    // Another HoldAuth (another device) opened our sequence first: ours can never open.
    const w = await customerWorld();
    w.writer.modes = ["drop", "drop", "drop", "drop", "drop"];
    const { use } = await prepare(w);
    const other = keyFromSeed(1);
    const serve = String(w.chain.ts + 900_000n);
    const ref = {
      business: "studio.biz.near",
      plan_id: 1,
      customer: CUSTOMER,
      reg_id: "1",
      key_slot: 0,
      key_epoch: 1,
    };
    const auth = { hold_seq: 1, units: 2, serve_until_ms: serve, key_slot: 0, key_epoch: 1 };
    expect(
      w.chain.openHold(
        OPERATOR,
        CUSTOMER,
        auth,
        other(sha256Hex(preimageOfHold(ref, auth))),
        verifiesEd25519,
      ),
    ).toBe("opened");
    const c = await w.cara(`/api/customer/uses/${use.id}/confirm`, "POST", w.signed(use.envelope));
    expect(c.body.use).toMatchObject({ state: "refused", reason: "superseded" });
    expect(w.chain.opened).toBe(1);

    // That hold closed, and the sequence advanced: unresolved, allocation freed, no new hold.
    const v = await customerWorld();
    v.writer.modes = ["drop"];
    const p = await prepare(v);
    v.chain.skip(); // the customer burned sequence 1 elsewhere
    v.chain.skip();
    const d = await v.cara(
      `/api/customer/uses/${p.use.id}/confirm`,
      "POST",
      v.signed(p.use.envelope),
    );
    expect(d.body.use).toMatchObject({
      state: "unresolved",
      reason: "sequence_used",
      label: "Unknown",
    });
    expect(v.writer.calls).toBe(1);
    expect(rows(v, "SELECT allocation FROM customer_requests")[0]?.allocation).toBeNull();
    const next = await v.cara(`/api/customer/offers/${p.offer}/prepare`, "POST", {
      idempotency_key: "use-key-0002",
      input: INPUT,
    });
    expect(next.body.use.reservation.hold_seq).toBe(3); // a new request, explicitly, at the next sequence

    // Never opened before any block could accept it: refused by block time (row 7).
    const x = await customerWorld();
    x.writer.modes = ["drop", "drop", "drop", "drop", "drop"];
    const q = await prepare(x);
    const e = await x.cara(
      `/api/customer/uses/${q.use.id}/confirm`,
      "POST",
      x.signed(q.use.envelope),
    );
    expect(e.body.use.state).toBe("reserve_unknown");
    x.chain.tick(BigInt(q.use.envelope.consent.accept_by_ms) - x.chain.ts + 1n);
    x.clock.now = Number(x.chain.ts);
    const f = await x.cara(`/api/customer/uses/${q.use.id}/reconcile`, "POST");
    expect(f.body.use).toMatchObject({ state: "refused", reason: "expired_unopened" });
    expect(x.chain.opened).toBe(0);
  });

  it("revocation: before the open it is refused (key changed); after, reserved but not serving", async () => {
    const w = await customerWorld();
    const { use } = await prepare(w);
    w.chain.revoke(0); // the customer revoked between preparing and the open
    const c = await w.cara(`/api/customer/uses/${use.id}/confirm`, "POST", w.signed(use.envelope));
    expect(c.body.use).toMatchObject({ state: "refused", reason: "key_changed" });
    expect(w.writer.answers).toEqual([{ status: "refused", code: "E_KEY" }]);

    const v = await customerWorld();
    v.writer.modes = ["lose_reply"];
    const p = await prepare(v);
    v.reader.failNext = 1; // the readback after the lost reply fails too
    const d = await v.cara(
      `/api/customer/uses/${p.use.id}/confirm`,
      "POST",
      v.signed(p.use.envelope),
    );
    expect(d.body.use.state).toBe("reserve_unknown");
    v.chain.tick(30_000n);
    v.chain.revoke(0); // after it opened
    const r = await v.cara(`/api/customer/uses/${p.use.id}/reconcile`, "POST");
    expect(r.body.use).toMatchObject({ state: "reserved", serving: false, reason: "key_revoked" });
  });

  it("a stale (lagging) readback is ignored; it never moves the state back", async () => {
    const v = await customerWorld();
    const { use } = await prepare(v);
    v.writer.modes = ["drop", "drop", "drop", "drop", "drop"];
    await v.cara(`/api/customer/uses/${use.id}/confirm`, "POST", v.signed(use.envelope));
    v.chain.tick(1_000n);
    await v.cara(`/api/customer/uses/${use.id}/reconcile`, "POST");
    v.reader.lagging = 1;
    const r = await v.cara(`/api/customer/uses/${use.id}/reconcile`, "POST");
    expect(r.body.use.state).toBe("reserve_unknown");
    expect(
      rows(v, "SELECT kind FROM customer_request_events WHERE kind = 'stale_read'"),
    ).toHaveLength(1);
    expect(v.chain.opened).toBe(0);
  });

  it("cancelled and expired preparations hold their sequence until no block can accept it", async () => {
    const w = await customerWorld();
    const { use, offer } = await prepare(w);
    const cancel = await w.cara(`/api/customer/uses/${use.id}/cancel`, "POST");
    expect(cancel.body.use.state).toBe("cancelled");
    expect(
      (await w.cara(`/api/customer/uses/${use.id}/confirm`, "POST", w.signed(use.envelope))).body
        .code,
    ).toBe("preparation_cancelled");
    const go = (key: string) =>
      w.cara(`/api/customer/offers/${offer}/prepare`, "POST", {
        idempotency_key: key,
        input: INPUT,
      });
    expect((await go("use-key-0002")).body.code).toBe("use_in_progress");
    w.chain.tick(BigInt(use.envelope.consent.accept_by_ms) - w.chain.ts + 1n);
    w.clock.now = Number(w.chain.ts);
    const next = await go("use-key-0003");
    expect([next.status, next.body.use.reservation.hold_seq]).toEqual([201, 1]);
    expect(w.writer.calls).toBe(0);
  });

  it("protects input only through an injected seam; nothing in plaintext either way", async () => {
    const protection = new SyntheticProtection();
    const w = await customerWorld({ customer: { protection } });
    const { use } = await prepare(w);
    expect(use.input.retained).toBe(true);
    expect(protection.kept.size).toBe(1);
    const dump = JSON.stringify(rows(w, "SELECT * FROM customer_requests"));
    expect(dump).not.toContain("Stackline");
    expect(rows(w, "SELECT input_scheme FROM customer_requests")[0]?.input_scheme).toBe(
      "synthetic-test-only",
    );
  });

  it("without a writer, confirming answers unavailable and the preparation stays", async () => {
    const w = await customerWorld({ noWriter: true });
    const { use } = await prepare(w);
    const c = await w.cara(`/api/customer/uses/${use.id}/confirm`, "POST", w.signed(use.envelope));
    expect([c.status, c.body.code]).toEqual([503, "customer_use_unavailable"]);
    expect((await w.cara(`/api/customer/uses/${use.id}`)).body.use.state).toBe("prepared");
  });
});

describe("003m a sale changes the owner, never the customer's request", () => {
  it("keeps the request and its entitlement identity across a sale; neither owner can read it", async () => {
    const w = await customerWorld();
    const { c } = await reserve(w);
    const before = c.body.use;
    const buyer = w.person("Noah Fenn");
    w.rw.transfer(w.f.business, w.f.ava.id, buyer.id);
    w.chain.afterSale(); // the contract-produced control after an actual sale
    const after = (await w.cara(`/api/customer/uses/${before.id}`)).body.use;
    expect(after.reservation).toEqual(before.reservation);
    expect(after.state).toBe("reserved");
    expect((await w.owner(`/api/customer/uses/${before.id}`)).status).toBe(404);
    expect((await buyer(`/api/customer/uses/${before.id}`)).status).toBe(404);
    // Offers stay with the business: the new owner sees them, the former owner can't.
    expect(
      (await buyer(`/api/businesses/${w.f.business}/customer-offers`)).body.offers,
    ).toHaveLength(1);
    expect((await w.owner(`/api/businesses/${w.f.business}/customer-offers`)).status).toBe(404);
  });

  it("accepting alone does not pause service; lost platform authority fails closed until re-appointed", async () => {
    const w = await customerWorld();
    w.chain.accepting(); // contract-produced: a live Direct deal in accepting, grants to meter2 only
    const { use } = await prepare(w);
    expect(use).toMatchObject({ state: "prepared", notice: "under_offer_platform_not_granted" });
    await w.cara(`/api/customer/uses/${use.id}/cancel`, "POST");

    const v = await customerWorld();
    v.chain.afterSale(); // meter2 holds METERING at generation 2; the platform's meter doesn't
    const p = await prepare(v);
    expect([p.r.status, p.r.body.code]).toEqual([409, "operator_not_authorized"]);
    v.chain.reappointPlatform(); // synthetic: the new owner appointed the platform again
    const q = await v.cara(`/api/customer/offers/${p.offer}/prepare`, "POST", {
      idempotency_key: "use-key-0002",
      input: INPUT,
    });
    expect(q.status).toBe(201);
    const c = await v.cara(
      `/api/customer/uses/${q.body.use.id}/confirm`,
      "POST",
      v.signed(q.body.use.envelope),
    );
    expect(c.body.use.state).toBe("reserved");
  });
});

describe("003m file-backed restart", () => {
  it("a restarted app recovers a preparation and an interrupted submission from the same file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "customer-use-"));
    const open: Store[] = [];
    let release = () => {};
    let stuck: Promise<unknown> = Promise.resolve();
    try {
      const w = await customerWorld({ dbPath: join(dir, "app.db") });
      open.push(w.rw.store);
      const { use } = await prepare(w);
      w.writer.holdNext();
      release = () => w.writer.gateOpen();
      // The first process confirms and is stuck inside the writer: it never comes back.
      stuck = w.cara(`/api/customer/uses/${use.id}/confirm`, "POST", w.signed(use.envelope));
      await w.writer.entered;
      // A restarted process: a new connection to the same file, a new app.
      const store = new Store(openDb(join(dir, "app.db")));
      open.push(store);
      w.state.store = store;
      w.state.app = w.make(store);
      const seen = (await w.cara(`/api/customer/uses/${use.id}`)).body.use;
      expect(seen).toMatchObject({ state: "reserve_unknown", submissions: 1 });
      w.clock.now += 31_000; // the lost worker's lease has passed
      const r1 = await w.cara(`/api/customer/uses/${use.id}/reconcile`, "POST");
      expect(r1.body.use.state).toBe("reserve_unknown"); // read pending, resent
      const r2 = await w.cara(`/api/customer/uses/${use.id}/reconcile`, "POST");
      expect(r2.body.use.state).toBe("reserved");
      w.writer.gateOpen();
      await stuck;
      expect(w.chain.opened).toBe(1);
      expect((await w.cara(`/api/customer/uses/${use.id}`)).body.use.state).toBe("reserved");
    } finally {
      // The stuck worker always ends before its database closes (bounded: it is only gated).
      release();
      await stuck.catch(() => {});
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
