// Job 003o: settling one delivered customer use, or releasing an unused unit, through the real
// app with injected adapters (docs/design/CUSTOMER_USE_RUNTIME.md §14). The chain here is the
// TypeScript TEST DOUBLE seeded from contract JSON (customer-world.ts); it models settle_hold,
// release_hold and check_use from lib.rs but executes no contract. The contract's own behaviour
// is evidenced separately by customer_settlement_matches_server_fixture (Rust) and
// customer-settlement-fixture.test.ts. Every producer is finite.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  preimageOfHold,
  preimageOfUse,
  sha256Hex,
  verifiesEd25519,
} from "../src/customerSigning.ts";
import { openDb } from "../src/db.ts";
import { RuntimeFailure } from "../src/runtime.ts";
import { Store } from "../src/store.ts";
import type { BlockRef, ViewTransport } from "../src/v3read.ts";
import {
  CUSTOMER,
  type CustomerWorld,
  customerWorld,
  heldScript,
  type Json,
  keyFromSeed,
  OPERATOR,
  SyntheticProtection,
} from "./customer-world.ts";
import { reply } from "./runtime-world.ts";

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

let keys = 0;
let offerId: string | null = null;
/** Prepare and confirm one use: reserved. */
async function reserve(w: CustomerWorld, input = INVOICE, offer?: string) {
  sync(w);
  offerId = offer ?? ((await w.offer()) as string);
  const p = await w.cara(`/api/customer/offers/${offerId}/prepare`, "POST", {
    idempotency_key: `settle-key-${String(++keys).padStart(4, "0")}`,
    input,
  });
  expect(p.status, JSON.stringify(p.body)).toBe(201);
  const c = await w.cara(
    `/api/customer/uses/${p.body.use.id}/confirm`,
    "POST",
    w.signed(p.body.use.envelope),
  );
  expect(c.body.use.state).toBe("reserved");
  return p.body.use.id as string;
}

async function executeOnce(w: CustomerWorld, id: string) {
  sync(w);
  return (await w.cara(`/api/customer/uses/${id}/execute`, "POST", {})).body.use;
}

/** Bounded unit reconciliation: at most `n` steps until the unit is decided. */
async function units(w: CustomerWorld, id: string, n = 4) {
  let u: Json = {};
  for (let i = 0; i < n; i++) {
    sync(w);
    u = (await w.cara(`/api/customer/uses/${id}/units/reconcile`, "POST")).body.use.units;
    if (["charged", "returned", "conflict", "unknown"].includes(u.unit)) break;
  }
  return u;
}

describe("003o one delivered use: settle once, confirm the charge, close, admit the next", () => {
  it("charges exactly once from readback, frees the allocation, and admits the next request", async () => {
    const { w } = await world();
    const id = await reserve(w);
    expect((await executeOnce(w, id)).execution.settlement_eligible).toBe(true);
    const u = await units(w, id);
    expect(u).toMatchObject({ unit: "charged", kind: "charge", reason: "charged", submissions: 1 });
    expect(u.source.observed).toEqual({ free: "99", consumed: "1" });
    expect(w.writer.settleCalls).toBe(1);
    expect(w.chain.charged).toBe(1);
    expect(all(w, "SELECT allocation FROM customer_requests")[0]?.allocation).toBeNull();
    // The next explicit request takes the next sequence; the first one's result is still hers.
    const next = await reserve(w);
    expect((await w.cara(`/api/customer/uses/${next}`)).body.use.reservation.hold_seq).toBe(2);
    expect((await w.cara(`/api/customer/uses/${id}/result`)).status).toBe(200);
    // A late or duplicate reconcile changes nothing.
    await units(w, id);
    expect(w.writer.settleCalls).toBe(1);
    // Nothing private in the unit view or its events.
    const r = await w.cara(`/api/customer/uses/${id}`);
    const row = all(w, "SELECT use_sig, salt FROM customer_requests WHERE id = ?", id)[0] as Json;
    const text = JSON.stringify([
      r.body.use.units,
      all(w, "SELECT * FROM customer_request_events"),
      all(w, "SELECT * FROM customer_settlements"),
    ]);
    for (const secret of [row.use_sig, row.salt, "Stackline"]) expect(text).not.toContain(secret);
  });
});

describe("003o ineligible outcomes release the unit; nothing is charged", () => {
  it("failed, refused, undeliverable and cancelled executions each return the unit", async () => {
    const cases: [string, (w: CustomerWorld, p: SyntheticProtection) => void, string][] = [
      [
        "unknown",
        (w) => {
          w.provider.script = async () => {
            throw new RuntimeFailure("x", "provider_error", null);
          };
        },
        INVOICE,
      ],
      ["refused", () => {}, "Fictional note with no invoice in it"],
      [
        "undeliverable",
        (_w, p) => {
          p.failProtect = 1;
        },
        INVOICE,
      ],
    ];
    for (const [name, setup, input] of cases) {
      const { w, protection } = await world();
      const id = await reserve(w, input);
      setup(w, protection);
      const x = await executeOnce(w, id);
      expect(x.execution.settlement_eligible, name).toBe(false);
      const u = await units(w, id);
      expect(u, name).toMatchObject({ unit: "returned", kind: "release" });
      expect(u.source.observed, name).toEqual({ free: "100", consumed: "0" });
      expect([w.writer.settleCalls, w.writer.releaseCalls, w.chain.charged], name).toEqual([
        0, 1, 0,
      ]);
    }
    // Cancelled: a late answer isn't kept, so the unit returns.
    const { w } = await world();
    const id = await reserve(w);
    const held = heldScript(async () => reply({ vendor: "Stackline Hosting Ltd" }));
    w.provider.script = held.script;
    sync(w);
    const run = w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    try {
      await held.entered;
      await w.cara(`/api/customer/uses/${id}/execution/cancel`, "POST");
    } finally {
      held.open();
    }
    await run;
    expect((await units(w, id)).unit).toBe("returned");
    expect(w.chain.charged).toBe(0);
  });

  it("an unexecuted request: released on the customer's word, or once it can no longer run", async () => {
    const { w } = await world();
    const id = await reserve(w);
    sync(w);
    const r = await w.cara(`/api/customer/uses/${id}/release`, "POST");
    expect(r.body.use.units.unit).toMatch(/release_pending|returned/);
    expect((await units(w, id)).unit).toBe("returned");
    expect((await w.cara(`/api/customer/uses/${id}/execute`, "POST", {})).body.code).toBe(
      "unit_settling",
    );
    // Not decidable while it may still run; decided once its serving time passed.
    const v = await world();
    const vid = await reserve(v.w);
    expect(await v.w.service().settleDue(5)).toEqual({ [vid]: "not_decidable" });
    v.w.chain.tick(
      BigInt((await v.w.cara(`/api/customer/uses/${vid}`)).body.use.reservation.serve_until_ms) -
        v.w.chain.ts +
        1_000n,
    );
    sync(v.w);
    await v.w.service().settleDue(5);
    expect((await units(v.w, vid)).unit).toBe("returned");
  });

  it("a delivered use can't be released instead of settled", async () => {
    const { w } = await world();
    const id = await reserve(w);
    await executeOnce(w, id);
    expect((await w.cara(`/api/customer/uses/${id}/release`, "POST")).body.code).toBe("delivered");
  });
});

describe("003o lost answers, deadlines and history stay exact or unknown", () => {
  it("a lost settle reply after it applied, and a dropped one, both end charged exactly once", async () => {
    for (const mode of ["lose_reply", "drop"] as const) {
      const { w } = await world();
      const id = await reserve(w);
      await executeOnce(w, id);
      w.writer.unitModes = [mode];
      const u = await units(w, id);
      expect(u.unit, mode).toBe("charged");
      expect(w.chain.charged, mode).toBe(1);
      expect(w.writer.settleCalls, mode).toBe(mode === "drop" ? 2 : 1);
    }
  });

  it("past settle_until the charge can't apply: the unit is released, not charged", async () => {
    const { w } = await world();
    const id = await reserve(w);
    await executeOnce(w, id);
    const until = BigInt(
      (await w.cara(`/api/customer/uses/${id}`)).body.use.reservation.settle_until_ms,
    );
    w.chain.tick(until - w.chain.ts + 1_000n);
    const u = await units(w, id);
    expect(u).toMatchObject({ unit: "returned", kind: "release" });
    expect([w.writer.settleCalls, w.chain.charged]).toEqual([0, 0]);
    expect(
      all(w, "SELECT kind FROM customer_request_events WHERE kind = 'unit_settle_deadline_passed'"),
    ).toHaveLength(1);
  });

  it("another fingerprint in our slot is a conflict: no charge, no release, allocation held", async () => {
    const { w } = await world();
    const id = await reserve(w);
    await executeOnce(w, id);
    // Synthetic: another device's use, signed by the same key, charged our slot first.
    const r = all(w, "SELECT * FROM customer_requests WHERE id = ?", id)[0] as Json;
    const other = "cd".repeat(32);
    const ref = {
      business: "studio.biz.near",
      plan_id: 1,
      customer: CUSTOMER,
      reg_id: "1",
      key_slot: 0,
      key_epoch: 1,
    };
    const sig = keyFromSeed(1)(
      sha256Hex(preimageOfUse(ref, { hold_seq: r.hold_seq, slot: 0, fingerprint: other })),
    );
    w.chain.settleHold(
      OPERATOR,
      CUSTOMER,
      r.hold_seq,
      [{ slot: 0, fingerprint: other, sig }],
      false,
      verifiesEd25519,
    );
    const u = await units(w, id);
    expect(u).toMatchObject({ unit: "conflict", reason: "other_fingerprint" });
    expect([w.writer.settleCalls, w.writer.releaseCalls]).toEqual([0, 0]);
    expect(all(w, "SELECT allocation FROM customer_requests")[0]?.allocation).not.toBeNull();
  });

  it("a closed root that isn't ours, or history that moved on, stays unknown: never charged or refunded", async () => {
    // Synthetic: our hold closed with one used slot whose root isn't our fingerprint's.
    const { w } = await world();
    const id = await reserve(w);
    await executeOnce(w, id);
    const e = w.chain.ent() as Json;
    w.chain.release();
    Object.assign(e, { last_hold_used: 1, last_hold_charged: 1, last_hold_root: "ef".repeat(32) });
    expect(await units(w, id)).toMatchObject({ unit: "unknown", reason: "root_mismatch" });
    // Synthetic: our hold released, then another device's next hold opened and closed.
    const v = await world();
    const vid = await reserve(v.w);
    await executeOnce(v.w, vid);
    const vr = all(v.w, "SELECT * FROM customer_requests WHERE id = ?", vid)[0] as Json;
    v.w.chain.release();
    const auth = {
      hold_seq: vr.hold_seq + 1,
      units: 1,
      serve_until_ms: String(v.w.chain.ts + 600_000n),
      key_slot: 0,
      key_epoch: 1,
    };
    const ref = {
      business: "studio.biz.near",
      plan_id: 1,
      customer: CUSTOMER,
      reg_id: "1",
      key_slot: 0,
      key_epoch: 1,
    };
    v.w.chain.openHold(
      OPERATOR,
      CUSTOMER,
      auth,
      keyFromSeed(1)(sha256Hex(preimageOfHold(ref, auth))),
      verifiesEd25519,
    );
    v.w.chain.release();
    const u = await units(v.w, vid);
    expect(u).toMatchObject({ unit: "unknown", reason: "history_lost" });
    expect([v.w.writer.settleCalls, v.w.writer.releaseCalls]).toEqual([0, 0]);
    // The exposure stays visible; an explicit next request is allowed (the sequence moved on).
    expect(
      all(v.w, "SELECT allocation FROM customer_requests WHERE id = ?", vid)[0]?.allocation,
    ).toBeNull();
  });

  it("a key revoked after the use was signed: the signed use still settles", async () => {
    const { w } = await world();
    const id = await reserve(w);
    await executeOnce(w, id);
    w.chain.revoke(0);
    expect((await units(w, id)).unit).toBe("charged");
  });
});

describe("003o authority, binding, competing workers and restart", () => {
  it("lost platform authority sends nothing; a regrant settles", async () => {
    const { w } = await world();
    const id = await reserve(w);
    await executeOnce(w, id);
    w.chain.afterSale(); // contract-produced control: meter2 only
    const u = await units(w, id, 1);
    expect(u).toMatchObject({
      unit: "charge_pending",
      reason: "operator_not_authorized",
      retryable: true,
    });
    expect(w.writer.settleCalls).toBe(0);
    w.chain.reappointPlatform(); // synthetic: the new owner granted the platform METERING
    expect((await units(w, id)).unit).toBe("charged");
  });

  it("a writer on another network is never called", async () => {
    const { w } = await world();
    const id = await reserve(w);
    await executeOnce(w, id);
    Object.defineProperty(w.writer, "network", { value: "mainnet" });
    const u = await units(w, id, 1);
    expect(u.reason).toBe("binding_mismatch");
    expect(w.writer.settleCalls).toBe(0);
  });

  it("competing workers submit once; a stale worker's late answer is discarded", async () => {
    const { w } = await world();
    const id = await reserve(w);
    await executeOnce(w, id);
    sync(w);
    await Promise.all([
      w.cara(`/api/customer/uses/${id}/units/reconcile`, "POST"),
      w.cara(`/api/customer/uses/${id}/units/reconcile`, "POST"),
    ]);
    expect(w.writer.settleCalls).toBe(1);
    expect((await units(w, id)).unit).toBe("charged");
    // Stale lease: worker A is held inside the settle; B takes over after A's lease.
    const v = await world();
    const vid = await reserve(v.w);
    await executeOnce(v.w, vid);
    const gate = v.w.writer.holdNextUnit();
    sync(v.w);
    const a = v.w.cara(`/api/customer/uses/${vid}/units/reconcile`, "POST");
    try {
      await gate.entered;
      v.w.clock.now += 31_000;
      v.w.chain.tick(31_000n);
      await v.w.cara(`/api/customer/uses/${vid}/units/reconcile`, "POST"); // B: reads unused, settles
    } finally {
      gate.open();
    }
    await a; // A's settle lands on a closed hold: refused; A records nothing
    expect((await units(v.w, vid)).unit).toBe("charged");
    expect(v.w.chain.charged).toBe(1);
    const answers = all(
      v.w,
      "SELECT lease_gen FROM customer_request_events WHERE kind = 'unit_writer_answer'",
    );
    expect(answers.map((x) => x.lease_gen)).toEqual([2]);
  });

  it("a lost reply then a restart on the same file recovers the same charge", async () => {
    const dir = mkdtempSync(join(tmpdir(), "customer-settle-"));
    const open: Store[] = [];
    try {
      const { w } = await world({ dbPath: join(dir, "app.db") });
      open.push(w.state.store);
      const id = await reserve(w);
      await executeOnce(w, id);
      w.writer.unitModes = ["lose_reply"];
      sync(w);
      await w.cara(`/api/customer/uses/${id}/units/reconcile`, "POST");
      expect(w.chain.charged).toBe(1);
      const store = new Store(openDb(join(dir, "app.db")));
      open.push(store);
      w.state.store = store;
      w.state.app = w.make(store);
      expect((await units(w, id)).unit).toBe("charged");
      expect(w.writer.settleCalls).toBe(1);
    } finally {
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

// ---------- 100/20/80 across an acquisition reconciled through the existing v3 intents ----------

const here = join(import.meta.dirname, "fixtures", "v3");
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(here, `${name}.json`), "utf8")) as Record<string, string>;
const DIGEST = "aa53a9ad33a13ba3e609344b36591db8339482e852a6044a52d1cbda5b68dda4";
const hashAt = (h: number) => `A${String(h).replace(/0/g, "z")}`.padEnd(44, "x");

class SaleTransport implements ViewTransport {
  readonly network = "testnet";
  at: BlockRef = { height: "5000", hash: hashAt(5000) };
  views: Record<string, string> = fixture("direct-accepting"); // contract fixture
  async finalBlock() {
    return this.at;
  }
  async view(input: Parameters<ViewTransport["view"]>[0]) {
    const key = input.method === "get_period" ? `get_period:${input.args.yyyymm}` : input.method;
    return { result: this.views[key] as string, block: input.block };
  }
  next(views: Record<string, string>) {
    const h = Number(this.at.height) + 1;
    this.at = { height: String(h), hash: hashAt(h) };
    this.views = views;
  }
}

describe("003o the flagship journey: 100 bought, 20 used, 80 kept across a sale", () => {
  it("twenty delivered uses settle exactly; the reconciled sale keeps the customer's access and 80 units", async () => {
    const transport = new SaleTransport();
    const { w } = await world({ v3Transport: transport });
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      const id = await reserve(w);
      const x = await executeOnce(w, id);
      expect(x.execution.settlement_eligible, `use ${i + 1}`).toBe(true);
      expect((await units(w, id)).unit, `use ${i + 1}`).toBe("charged");
      ids.push(id);
    }
    // The double's entitlement (separate from the contract's own 100/20/80 fixture).
    expect(w.chain.ent()).toMatchObject({
      purchased: "100",
      consumed: "20",
      free: "80",
      hold_active: false,
    });
    expect([w.chain.charged, w.writer.settleCalls, w.writer.releaseCalls]).toEqual([20, 20, 0]);
    // Exact provider ledgers: each use one invocation, its actual cost recorded once.
    const inv = all(
      w,
      "SELECT id, charged_microcents, reserved_cents, state FROM runtime_invocations WHERE purpose = 'customer_use'",
    );
    expect(inv).toHaveLength(20);
    expect(inv.every((r) => r.state === "completed" && r.reserved_cents === 0)).toBe(true);
    const actual = all(
      w,
      "SELECT COALESCE(SUM(u.microcents), 0) AS m FROM runtime_usage u JOIN runtime_invocations i ON i.id = u.invocation_id WHERE i.purpose = 'customer_use' AND u.kind = 'actual'",
    )[0]?.m;
    expect(actual).toBe(inv.reduce((a, r) => a + (r.charged_microcents as number), 0));
    expect(
      all(w, "SELECT state FROM customer_settlements").every((s) => s.state === "charged"),
    ).toBe(true);

    // The acquisition, through the existing exact v3 reconciliation (contract fixtures).
    const buyer = w.person("Noah Fenn");
    w.link(w.f.ava.id, "founder.near");
    w.link(buyer.id, "buyer.near");
    expect((await w.owner(`/api/businesses/${w.f.business}/v3/refresh`, "POST")).body.outcome).toBe(
      "accepted",
    );
    const intent = (
      await w.owner(`/api/businesses/${w.f.business}/v3/intents`, "POST", {
        idempotency_key: "intent-key-0001",
        deal_seq: "1",
        version: 1,
        digest: DIGEST,
      })
    ).body.intent.id as string;
    transport.next(fixture("direct-closed"));
    const applied = await buyer(
      `/api/businesses/${w.f.business}/v3/intents/${intent}/reconcile`,
      "POST",
    );
    expect(applied.body.state).toBe("applied");
    // The customer keeps every result and record; neither owner reads them.
    for (const id of [ids[0], ids[19]] as string[]) {
      expect((await w.cara(`/api/customer/uses/${id}/result`)).status).toBe(200);
      expect((await w.owner(`/api/customer/uses/${id}/result`)).status).toBe(404);
      expect((await buyer(`/api/customer/uses/${id}/result`)).status).toBe(404);
      expect((await w.cara(`/api/customer/uses/${id}`)).body.use.units.unit).toBe("charged");
    }
    // The former owner lost the business; the new owner has it (and its offers, cost only).
    expect((await w.owner(`/api/businesses/${w.f.business}/customer-offers`)).status).toBe(404);
    expect((await buyer(`/api/businesses/${w.f.business}/customer-offers`)).status).toBe(200);
    // On the chain side the sale granted METERING to meter2 only (contract fixture): the
    // platform fails closed until the new owner grants it; then the successor serves use 21.
    w.chain.control = JSON.parse(fixture("direct-closed").get_control as string);
    sync(w);
    const offer = offerId as string;
    const refused = await w.cara(`/api/customer/offers/${offer}/prepare`, "POST", {
      idempotency_key: "settle-key-0999",
      input: INVOICE,
    });
    expect(refused.body.code).toBe("operator_not_authorized");
    w.chain.reappointPlatform();
    const id21 = await reserve(w, INVOICE, offer); // the business's offer, made before the sale
    await executeOnce(w, id21);
    expect((await units(w, id21)).unit).toBe("charged");
    expect(w.chain.ent()).toMatchObject({ consumed: "21", free: "79" });
  });
});
