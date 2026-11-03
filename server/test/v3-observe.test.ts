// Job 003h: read-only business-v3 observations. Real contract JSON (produced by business-v3's
// own unit test into server/test/fixtures/v3), a deterministic in-memory view transport (no
// network), durable ordering, and an owner-only API with operator bindings. Fictional data.

import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { everstreetApi } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";
import { V3Observations, type V3Options } from "../src/v3observe.ts";
import {
  type BlockRef,
  coherent,
  decodeControl,
  decodeOutcomes,
  decodePending,
  decodeTreasury,
  readSnapshot,
  type V3Binding,
  V3ReadError,
  type ViewTransport,
} from "../src/v3read.ts";
import { gate, type Json } from "./deal-world.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(here, "fixtures", "v3", `${name}.json`), "utf8")) as Record<
    string,
    string
  >;
const ACCEPTING = fixture("direct-accepting");
const CLOSED = fixture("direct-closed");
const CLOSING = fixture("gated-closing");

/** A base58-looking block hash for a height (and a variant, for conflicting blocks). */
const hashAt = (h: number | string, v = "A") =>
  `${v}${String(h).replace(/0/g, "z")}`.padEnd(44, "x");
const block = (h: number | string, v = "A"): BlockRef => ({
  height: String(h),
  hash: hashAt(h, v),
});

/** Answers views from fixture text at whatever final block it is told; nothing leaves memory. */
class Transport implements ViewTransport {
  at: BlockRef = block(1000);
  views: Record<string, string> = { ...ACCEPTING };
  /** Answers one method from another block (to model an incoherent source). */
  skew: { method: string; block: BlockRef } | null = null;
  hang = new Set<string>();
  held: Promise<void> | null = null;
  entered = gate();
  throwWith: Error | null = null;
  calls = 0;
  async finalBlock() {
    if (this.throwWith) throw this.throwWith;
    return this.at;
  }
  async view(input: Parameters<ViewTransport["view"]>[0]) {
    this.calls++;
    const pinned = input.block;
    const views = this.views;
    const skew = this.skew;
    if (this.held) {
      this.entered.open();
      await this.held;
    }
    if (this.hang.has(input.method)) await new Promise(() => {});
    const key = input.method === "get_period" ? `get_period:${input.args.yyyymm}` : input.method;
    const result = views[key];
    if (result === undefined) throw new Error(`no fixture for ${key}`);
    return { result, block: skew?.method === input.method ? skew.block : pinned };
  }
}

/** Edits one view's JSON in a copy of a fixture. */
function edit(
  views: Record<string, string>,
  method: string,
  f: (v: Json) => void,
): Record<string, string> {
  const v = JSON.parse(views[method] as string);
  f(v);
  return { ...views, [method]: JSON.stringify(v) };
}

const BINDING_ACCOUNT = "studio.biz.near";

function world(
  opts: {
    dbPath?: string;
    transport?: Transport | null;
    account?: string;
    retention?: number;
    now?: () => number;
  } = {},
) {
  const store = new Store(openDb(opts.dbPath ?? ":memory:"));
  const people = new Map<string, { id: string; token: string }>();
  const person = (name: string) => {
    const existing = people.get(name);
    if (existing) return existing;
    const { person: p, token } = store.createPerson(name);
    const r = { id: p.id, token };
    people.set(name, r);
    return r;
  };
  const mara = person("Mara Solis");
  const ana = person("Ana Ruiz");
  const bid = store.tx(() =>
    store.insertBusiness(store.person(mara.id) as never, "started", "Ledgerline Labs", "software"),
  ).businessId;
  const other = store.tx(() =>
    store.insertBusiness(store.person(ana.id) as never, "started", "Northline Tools", "software"),
  ).businessId;
  // People's NEAR accounts (no secrets): founder.near is Mara's.
  store.db
    .prepare(
      "INSERT INTO chain_accounts (owner_kind, owner_id, account_id, secret, tx, created_at) VALUES ('person', ?, ?, NULL, 'fixture', ?)",
    )
    .run(mara.id, "founder.near", new Date().toISOString());
  const transport = opts.transport === undefined ? new Transport() : opts.transport;
  const v3: V3Options = {
    transport,
    bindings: [{ business_id: bid, network: "testnet", account: opts.account ?? BINDING_ACCOUNT }],
    retention: opts.retention,
    timeoutMs: 50,
    now: opts.now,
  };
  const app = everstreetApi(store, { localPreview: true, environment: "test", v3 });
  const as =
    (token: string) =>
    async (path: string, method = "GET", body?: unknown) => {
      const res = await app.request(path, {
        method,
        headers: { cookie: `es_session=${token}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: (text ? JSON.parse(text) : {}) as Json, text };
    };
  const transfer = (from: string, to: string, business = bid) => {
    const gen = (
      store.db
        .prepare("SELECT COUNT(*) AS n FROM ownership WHERE business_id = ?")
        .get(business) as { n: number }
    ).n;
    store.db.prepare("UPDATE businesses SET owner_id = ? WHERE id = ?").run(to, business);
    store.db
      .prepare(
        "INSERT INTO ownership (business_id, from_id, to_id, generation, at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(business, from, to, gen + 2, new Date().toISOString());
  };
  const count = (t: string) =>
    (store.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  const ownerOf = (b = bid) =>
    (
      store.db.prepare("SELECT owner_id FROM businesses WHERE id = ?").get(b) as {
        owner_id: string;
      }
    ).owner_id;
  return {
    store,
    app,
    // Null only in the world built with { transport: null }, which never touches it.
    transport: transport as Transport,
    bid,
    other,
    mara,
    ana,
    as,
    m: as(mara.token),
    a: as(ana.token),
    transfer,
    count,
    ownerOf,
    person,
  };
}

const binding: V3Binding = { business_id: "b", network: "testnet", account: BINDING_ACCOUNT };

describe("003h decoding the contract's actual JSON", () => {
  it("a Direct accepting snapshot from the real fixture, with amounts above 2^53 kept exact", async () => {
    const t = new Transport();
    const s = await readSnapshot(t, binding, { period: 202611 });
    expect(s.source).toEqual({
      network: "testnet",
      account: BINDING_ACCOUNT,
      schema: "business-v3/003g",
    });
    expect(s.block).toEqual(block(1000));
    expect(s.control).toMatchObject({
      owner: "founder.near",
      generation: 1,
      control_seq: "6",
      close_mode: "direct",
      closer: null,
    });
    expect(s.control.operators).toEqual([{ account: "meter.near", caps: 1, generation: 1 }]);
    expect(s.control.live_deal).toMatchObject({
      state: "accepting",
      seller_accepted: true,
      buyer_accepted: false,
      price: "300000000000000000000",
      escrow: "300000000000000000000",
    });
    expect(s.treasury).toMatchObject({
      held: "400000000000000000000",
      withdrawable: "8999999999999750000",
      escrow_total: "300000000000000000000",
    });
    expect(BigInt(s.treasury.held)).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
    expect(s.pending).toEqual([
      {
        slot: 0,
        state: "in_flight",
        kind: "profit",
        amount: "1000000000000000000",
        to: "founder.near",
        plan_id: 0,
        payout_id: "1",
        started_at_ms: "1793577600000",
      },
    ]);
    expect(s.period?.period?.escrow_in).toEqual({ amount: "300000000000000000000", exact: true });
    expect(t.calls).toBe(5);
  });

  it("Direct closed and Gated closing fixtures decode with their outcome and closer", async () => {
    const t = new Transport();
    t.views = CLOSED;
    const closed = await readSnapshot(t, binding);
    expect(closed.control).toMatchObject({ owner: "buyer.near", generation: 2, live_deal: null });
    expect(closed.outcomes).toEqual([
      expect.objectContaining({
        status: "closed",
        seq: "1",
        generation_after: 2,
        price: "300000000000000000000",
        seller: "founder.near",
        buyer: "buyer.near",
      }),
    ]);
    expect(closed.treasury.claims_total).toBe("300000000000000000000");
    t.views = CLOSING;
    const closing = await readSnapshot(t, binding);
    expect(closing.control).toMatchObject({ close_mode: "gated", closer: "closer.near" });
    expect(closing.control.live_deal).toMatchObject({
      state: "closing",
      closing_control_seq: "7",
      deadline_ms: "1793579400000",
    });
  });

  it("malformed, out-of-range and unknown values are refused, never coerced", () => {
    const control = JSON.parse(ACCEPTING.get_control as string);
    const treasury = JSON.parse(ACCEPTING.get_treasury as string);
    const bad: [() => unknown, string][] = [
      [() => decodeControl({ ...control, extra: 1 }), "malformed"],
      [() => decodeControl({ ...control, owner: undefined }), "malformed"],
      [() => decodeControl({ ...control, control_seq: 6 }), "malformed"], // a number, not a string
      [() => decodeControl({ ...control, control_seq: "06" }), "malformed"],
      [() => decodeControl({ ...control, control_seq: "18446744073709551616" }), "out_of_range"],
      [() => decodeControl({ ...control, generation: 2 ** 32 }), "out_of_range"],
      [() => decodeControl({ ...control, close_mode: "managed" }), "unknown_enum"],
      [
        () =>
          decodeControl({ ...control, live_deal: { ...control.live_deal, state: "closed_ish" } }),
        "unknown_enum",
      ],
      [() => decodeControl({ ...control, close_mode: "gated" }), "malformed"], // gated without a closer
      [() => decodeControl({ ...control, owner: "Not An Account" }), "malformed"],
      [() => decodeControl({ ...control, service_manifest: "AB" }), "malformed"],
      [() => decodeControl({ ...control, operators: [["meter.near", 4, 1]] }), "out_of_range"],
      [
        () => decodeControl({ ...control, operators: Array(9).fill(["meter.near", 1, 1]) }),
        "out_of_range",
      ],
      [() => decodeTreasury({ ...treasury, held: "1" }), "malformed"], // buckets don't add up
      [() => decodeTreasury({ ...treasury, price: "1" }), "malformed"],
      [
        () => decodeTreasury({ ...treasury, held: "340282366920938463463374607431768211456" }),
        "out_of_range",
      ],
    ];
    for (const [f, code] of bad) {
      let got = "";
      try {
        f();
      } catch (e) {
        got = e instanceof V3ReadError ? e.code : `other: ${e}`;
      }
      expect(got).toBe(code);
    }
  });

  it("answers from different blocks, an incoherent snapshot or a timeout refuse the whole snapshot", async () => {
    const t = new Transport();
    t.skew = { method: "get_treasury", block: block(999) };
    await expect(readSnapshot(t, binding)).rejects.toMatchObject({ code: "mixed_blocks" });
    t.skew = { method: "get_pending", block: block(1000, "B") }; // same height, other hash
    await expect(readSnapshot(t, binding)).rejects.toMatchObject({ code: "mixed_blocks" });
    t.skew = null;
    t.views = edit(ACCEPTING, "get_pending", (v) => v.pop()); // pending no longer adds up
    await expect(readSnapshot(t, binding)).rejects.toMatchObject({ code: "malformed" });
    t.views = { ...ACCEPTING, get_control: "{not json" };
    await expect(readSnapshot(t, binding)).rejects.toMatchObject({ code: "malformed" });
    t.views = ACCEPTING;
    t.hang.add("get_outcomes");
    await expect(readSnapshot(t, binding, { timeoutMs: 20 })).rejects.toMatchObject({
      code: "timeout",
    });
  });
});

describe("003h the owner-only API and durable ordering", () => {
  it("records an observation, shows it truthfully, and never changes the app's owner", async () => {
    const w = world();
    expect((await w.m(`/api/businesses/${w.bid}/v3`)).body.state).toBe("never_observed");
    const r = await w.m(`/api/businesses/${w.bid}/v3/refresh`, "POST", { period: 202611 });
    expect([r.status, r.body.outcome]).toEqual([200, "accepted"]);
    const v = (await w.m(`/api/businesses/${w.bid}/v3`)).body;
    expect(v).toMatchObject({
      state: "observed",
      freshness: "fresh",
      owner_match: "matches",
      finality: "final",
    });
    expect(v.block).toEqual(block(1000));
    expect(v.high_water).toEqual({ block_height: "1000", control_seq: "6" });
    expect(v.control.manifest_note).toMatch(/not evidence that any code or artifact is available/);
    expect(v.provenance).toMatch(/not independently verified/);
    expect(v.claims_note).toMatch(/owed/);
    expect(r.text).toContain('"300000000000000000000"');
    // The contract closes the sale; the app's owner of the business is untouched.
    w.transport.at = block(1001);
    w.transport.views = CLOSED;
    expect((await w.m(`/api/businesses/${w.bid}/v3/refresh`, "POST")).body.outcome).toBe(
      "accepted",
    );
    const after = (await w.m(`/api/businesses/${w.bid}/v3`)).body;
    expect(after.control.owner).toBe("buyer.near");
    expect(after.owner_match).toBe("unknown_mapping");
    expect(after.outcomes).toEqual([
      expect.objectContaining({ status: "closed", seq: "1", observed_from_block: "1001" }),
    ]);
    expect(after.history).toMatchObject({ complete: true, missing_count: "0" });
    expect(w.ownerOf()).toBe(w.mara.id);
  });

  it("duplicates are idempotent; older blocks finishing late never overwrite newer ones", async () => {
    const w = world();
    const refresh = () => w.m(`/api/businesses/${w.bid}/v3/refresh`, "POST");
    expect((await refresh()).body.outcome).toBe("accepted");
    expect((await refresh()).body.outcome).toBe("duplicate");
    expect(w.count("v3_observations")).toBe(1);
    // Two refreshes in flight: the newer block's completes first, the older one's last.
    w.transport.at = block(1003);
    const held = gate();
    w.transport.held = held.opened;
    w.transport.entered = gate();
    const older = refresh(); // pinned at 1003...
    await w.transport.entered.opened;
    w.transport.held = null;
    w.transport.at = block(1005);
    expect((await refresh()).body.outcome).toBe("accepted"); // ...while 1005 lands first
    held.open();
    expect((await older).body.outcome).toBe("stale");
    const v = (await w.m(`/api/businesses/${w.bid}/v3`)).body;
    expect(v.block.height).toBe("1005");
    expect(w.count("v3_observations")).toBe(2);
  });

  it("the control sequence can stay the same while money moves; a lower one at a higher block is contradictory", async () => {
    const w = world();
    const refresh = () => w.m(`/api/businesses/${w.bid}/v3/refresh`, "POST");
    await refresh();
    w.transport.at = block(1001);
    w.transport.views = edit(
      edit(ACCEPTING, "get_treasury", (t) => {
        t.held = "401000000000000000000";
        t.ent_free_value = "91000000000000000000";
      }),
      "get_period:202611",
      () => {},
    );
    expect((await refresh()).body.outcome).toBe("accepted");
    expect((await w.m(`/api/businesses/${w.bid}/v3`)).body.treasury.held).toBe(
      "401000000000000000000",
    );
    w.transport.at = block(1002);
    w.transport.views = edit(ACCEPTING, "get_control", (c) => {
      c.control_seq = "5";
    });
    expect((await refresh()).body.outcome).toBe("contradictory");
    const v = (await w.m(`/api/businesses/${w.bid}/v3`)).body;
    expect(v.block.height).toBe("1001");
    expect(v.flag).toMatchObject({ code: "contradictory" });
  });

  it("two different answers for one block or one height fail closed", async () => {
    const w = world();
    const refresh = () => w.m(`/api/businesses/${w.bid}/v3/refresh`, "POST");
    await refresh();
    // The same block hash with different content.
    w.transport.views = edit(ACCEPTING, "get_control", (c) => {
      c.manifest_seq = "0";
      c.operators = [];
    });
    expect((await refresh()).body.outcome).toBe("conflict");
    // Another hash at the same height.
    w.transport.views = ACCEPTING;
    w.transport.at = block(1000, "B");
    expect((await refresh()).body.outcome).toBe("conflict");
    const v = (await w.m(`/api/businesses/${w.bid}/v3`)).body;
    expect(v.flag).toMatchObject({ code: "conflict" });
    expect(v.control.operators).toEqual([{ account: "meter.near", caps: 1, generation: 1 }]);
    expect(w.count("v3_observations")).toBe(1);
  });

  it("a completed sale reported later with a different outcome is a conflict; the first one stands", async () => {
    const w = world();
    const refresh = () => w.m(`/api/businesses/${w.bid}/v3/refresh`, "POST");
    w.transport.views = CLOSED;
    expect((await refresh()).body.outcome).toBe("accepted");
    w.transport.at = block(1001);
    // Synthetic, otherwise coherent (003h1): a later control step, and deal 1's record now has
    // another time and digest. The contract never rewrites an outcome, so this is a conflict.
    w.transport.views = edit(
      edit(CLOSED, "get_outcomes", (os) => {
        os[0].at_ms = "1793577999999";
        os[0].digest = "b".repeat(64);
      }),
      "get_control",
      (c) => {
        c.control_seq = "8";
      },
    );
    expect((await refresh()).body.outcome).toBe("conflict");
    const v = (await w.m(`/api/businesses/${w.bid}/v3`)).body;
    expect(v.flag).toMatchObject({ code: "conflict" });
    expect(v.block.height).toBe("1000");
    expect(v.outcomes).toEqual([expect.objectContaining({ seq: "1", status: "closed" })]);
    expect(() =>
      w.store.db.prepare("UPDATE v3_outcomes SET status = 'cancelled' WHERE seq = '1'").run(),
    ).toThrow();
  });

  it("an outcome ring that wrapped before it was seen reports incomplete history, inventing nothing", async () => {
    const w = world();
    const one = JSON.parse(CLOSED.get_outcomes as string)[0];
    // Synthetic, coherent: ten earlier deals ended without a sale, each in its own control step.
    const ring = [10, 9, 8, 7, 6, 5, 4, 3].map((n) => ({
      ...one,
      seq: String(n),
      status: n % 2 ? "cancelled" : "expired",
      generation_after: 1,
      control_seq: String(3 * n),
      price: "1",
    }));
    w.transport.views = { ...ACCEPTING, get_outcomes: JSON.stringify(ring) };
    w.transport.views = edit(w.transport.views, "get_control", (c) => {
      c.live_deal.seq = "11";
      c.control_seq = "40";
    });
    expect((await w.m(`/api/businesses/${w.bid}/v3/refresh`, "POST")).body.outcome).toBe(
      "accepted",
    );
    const v = (await w.m(`/api/businesses/${w.bid}/v3`)).body;
    expect(v.history).toMatchObject({
      complete: false,
      missing_count: "2",
      first_missing: ["1", "2"],
    });
    expect(v.outcomes.map((o: Json) => o.seq)).toEqual(["10", "9", "8", "7", "6", "5", "4", "3"]);
    expect(v.outcomes.some((o: Json) => o.seq === "1" || o.seq === "2")).toBe(false);
  });

  it("owner match: mismatch and unknown mapping report reconciliation, never reassign", async () => {
    const w = world();
    // The contract's owner is Ana's account; the app says Mara owns the business.
    w.store.db
      .prepare(
        "INSERT INTO chain_accounts (owner_kind, owner_id, account_id, secret, tx, created_at) VALUES ('person', ?, 'buyer.near', NULL, 'fixture', ?)",
      )
      .run(w.ana.id, new Date().toISOString());
    w.transport.views = CLOSED;
    await w.m(`/api/businesses/${w.bid}/v3/refresh`, "POST");
    const v = (await w.m(`/api/businesses/${w.bid}/v3`)).body;
    expect(v.owner_match).toBe("mismatch");
    expect(v.owner_note).toMatch(/never changes who controls this business/);
    expect(w.ownerOf()).toBe(w.mara.id);
    expect((await w.a(`/api/businesses/${w.bid}/v3`)).status).toBe(404); // the chain's owner gains nothing
  });
});

describe("003h access, isolation and trust", () => {
  it("control changing while the read is in flight: nothing recorded (former owner 404, away and back 409)", async () => {
    const w = world();
    const held = gate();
    w.transport.held = held.opened;
    let pending = w.m(`/api/businesses/${w.bid}/v3/refresh`, "POST");
    await w.transport.entered.opened;
    w.transfer(w.mara.id, w.ana.id);
    held.open();
    expect((await pending).status).toBe(404);
    expect(w.count("v3_observations")).toBe(0);
    w.transfer(w.ana.id, w.mara.id);
    const held2 = gate();
    w.transport.held = held2.opened;
    w.transport.entered = gate();
    pending = w.m(`/api/businesses/${w.bid}/v3/refresh`, "POST");
    await w.transport.entered.opened;
    w.transfer(w.mara.id, w.ana.id);
    w.transfer(w.ana.id, w.mara.id);
    held2.open();
    const r = await pending;
    expect([r.status, r.body.error]).toEqual([
      409,
      expect.stringMatching(/Control of this business changed/),
    ]);
    expect(w.count("v3_observations")).toBe(0);
  });

  it("only the current owner reads or refreshes; other businesses, unbound businesses and no transport are truthful", async () => {
    const w = world();
    expect((await w.a(`/api/businesses/${w.bid}/v3`)).status).toBe(404);
    expect((await w.a(`/api/businesses/${w.bid}/v3/refresh`, "POST")).status).toBe(404);
    // Ana's own business has no binding: unbound, and refresh says so without reading anything.
    expect((await w.a(`/api/businesses/${w.other}/v3`)).body.state).toBe("unbound");
    expect((await w.a(`/api/businesses/${w.other}/v3/refresh`, "POST")).status).toBe(409);
    expect(w.transport.calls).toBe(0);
    // A request can't name a binding: extra fields are ignored and the configured one is read.
    await w.m(`/api/businesses/${w.bid}/v3/refresh`, "POST", {
      account: "evil.near",
      network: "mainnet",
    });
    expect((await w.m(`/api/businesses/${w.bid}/v3`)).body.source).toEqual({
      network: "testnet",
      account: BINDING_ACCOUNT,
      schema: "business-v3/003g",
    });
    expect(
      (await w.m(`/api/businesses/${w.bid}/v3/refresh`, "POST", { period: 202613 })).status,
    ).toBe(400);
    // Without a transport the capability is plainly unavailable.
    const none = world({ transport: null });
    const r = await none.m(`/api/businesses/${none.bid}/v3/refresh`, "POST");
    expect(r.body).toMatchObject({ outcome: "refused", code: "unavailable" });
    expect((await none.m(`/api/businesses/${none.bid}/v3`)).body).toMatchObject({
      state: "never_observed",
      transport: "unavailable",
    });
  });

  it("transport errors are reported by code; their raw text never reaches responses or audit events", async () => {
    const w = world();
    w.transport.throwWith = new Error(
      "connect ECONNREFUSED https://rpc.internal.example.invalid/?key=hunter2",
    );
    const r = await w.m(`/api/businesses/${w.bid}/v3/refresh`, "POST");
    expect(r.body).toMatchObject({ outcome: "refused", code: "unavailable" });
    expect(r.text).not.toMatch(/hunter2|rpc\.internal|ECONNREFUSED/);
    const events = JSON.stringify(w.store.db.prepare("SELECT * FROM events").all());
    expect(events).not.toMatch(/hunter2|rpc\.internal|ECONNREFUSED/);
    expect(events).toContain("v3.read_refused");
    w.transport.throwWith = null;
    w.transport.views = { ...ACCEPTING, get_control: JSON.stringify({ secret_field: "hunter2" }) };
    const m = await w.m(`/api/businesses/${w.bid}/v3/refresh`, "POST");
    expect(m.body).toMatchObject({ outcome: "refused", code: "malformed" });
    expect(m.text).not.toContain("hunter2");
    expect(w.count("v3_observations")).toBe(0);
  });

  it("a changed binding (another contract) is refused against the existing record", async () => {
    const path = join(here, `v3-source-${process.pid}-${Date.now()}.db`);
    try {
      const first = world({ dbPath: path });
      await first.m(`/api/businesses/${first.bid}/v3/refresh`, "POST");
      first.store.db.close();
      // Same database, the operator now binds the business to another account.
      const store = new Store(openDb(path));
      const bid = (
        store.db.prepare("SELECT business_id FROM v3_projection").get() as { business_id: string }
      ).business_id;
      const t = new Transport();
      t.at = block(2000);
      const app = everstreetApi(store, {
        localPreview: true,
        environment: "test",
        v3: {
          transport: t,
          bindings: [{ business_id: bid, network: "testnet", account: "elsewhere.near" }],
        },
      });
      const call = async (p: string, method = "GET") => {
        const res = await app.request(p, {
          method,
          headers: { cookie: `es_session=${first.mara.token}` },
        });
        return (await res.json()) as Json;
      };
      expect((await call(`/api/businesses/${bid}/v3/refresh`, "POST")).outcome).toBe(
        "source_changed",
      );
      const v = await call(`/api/businesses/${bid}/v3`);
      expect(v).toMatchObject({
        binding_matches_record: false,
        source: { account: BINDING_ACCOUNT },
      });
      expect(v.block.height).toBe("1000");
      store.db.close();
    } finally {
      for (const s of ["", "-wal", "-shm"]) rmSync(`${path}${s}`, { force: true });
    }
  });

  it("the high-water mark survives a restart and pruning; retention is bounded", async () => {
    const path = join(here, `v3-restart-${process.pid}-${Date.now()}.db`);
    try {
      const first = world({ dbPath: path, retention: 2 });
      for (const h of [1001, 1002, 1003]) {
        first.transport.at = block(h);
        first.transport.views = edit(ACCEPTING, "get_treasury", (t) => {
          t.held = String(400000000000000000000n + BigInt(h));
          t.ent_free_value = String(90000000000000000000n + BigInt(h));
        });
        expect(
          (await first.m(`/api/businesses/${first.bid}/v3/refresh`, "POST")).body.outcome,
        ).toBe("accepted");
      }
      expect(first.count("v3_observations")).toBe(2);
      first.store.db.close();
      // Restart: the pruned first block, if delivered again, is stale; so is anything older.
      const store = new Store(openDb(path));
      const bid = (
        store.db.prepare("SELECT business_id FROM v3_projection").get() as { business_id: string }
      ).business_id;
      const t = new Transport();
      const app = everstreetApi(store, {
        localPreview: true,
        environment: "test",
        v3: {
          transport: t,
          bindings: [{ business_id: bid, network: "testnet", account: BINDING_ACCOUNT }],
          retention: 2,
        },
      });
      const refresh = async () => {
        const res = await app.request(`/api/businesses/${bid}/v3/refresh`, {
          method: "POST",
          headers: { cookie: `es_session=${first.mara.token}` },
        });
        return (await res.json()) as Json;
      };
      t.at = block(1001);
      expect((await refresh()).outcome).toBe("stale");
      t.at = block(999);
      expect((await refresh()).outcome).toBe("stale");
      const hw = store.db
        .prepare("SELECT high_block_height, high_control_seq FROM v3_projection")
        .get() as Json;
      expect(hw).toEqual({ high_block_height: "1003", high_control_seq: "6" });
      store.db.close();
    } finally {
      for (const s of ["", "-wal", "-shm"]) rmSync(`${path}${s}`, { force: true });
    }
  });
});

// ---------- 003h1: Astra's two reproductions, exactly ----------

describe("003h1 reproductions (independent review of e47e289)", () => {
  it("a period read added at an already-recorded block is not a conflict", async () => {
    const w = world();
    const refresh = (body?: unknown) => w.m(`/api/businesses/${w.bid}/v3/refresh`, "POST", body);
    expect((await refresh()).body.outcome).toBe("accepted");
    const r = await refresh({ period: 202611 });
    expect(r.body.outcome).toBe("duplicate");
    expect((await w.m(`/api/businesses/${w.bid}/v3`)).body.flag).toBeNull();
  });

  it("an owner change with the same control sequence is contradictory and never projected", async () => {
    const w = world();
    const refresh = () => w.m(`/api/businesses/${w.bid}/v3/refresh`, "POST");
    expect((await refresh()).body.outcome).toBe("accepted");
    w.transport.at = block(1001);
    // Synthetic mutation of the real fixture: only the owner changes (seq 6, generation 1 kept).
    w.transport.views = edit(ACCEPTING, "get_control", (c) => {
      c.owner = "impostor.near";
    });
    const r = await refresh();
    expect(r.body.outcome).not.toBe("accepted");
    expect((await w.m(`/api/businesses/${w.bid}/v3`)).body.control.owner).toBe("founder.near");
  });
});

// ---------- 003h1 acceptance ----------

/** Synthetic (labelled): the real 202611 answer, renumbered to another month. */
const monthText = (m: number) =>
  (ACCEPTING["get_period:202611"] as string).replaceAll("202611", String(m));
const withMonths = (views: Record<string, string>, ...months: number[]) => ({
  ...views,
  ...Object.fromEntries(months.map((m) => [`get_period:${m}`, monthText(m)])),
});

/**
 * Synthetic (labelled), coherent by every §4a rule: no live deal, and a wrapped ring of ten deals
 * that ended without a sale, so generation and owner aren't pinned by visible closes.
 */
function wrapped(o: {
  gen: number;
  seq: number;
  owner?: string;
  manifestSeq?: string;
  manifest?: string;
  gated?: boolean;
  asset?: string;
  top?: number;
}): Record<string, string> {
  const one = JSON.parse(CLOSED.get_outcomes as string)[0];
  const top = o.top ?? 10;
  const ring = Array.from({ length: 8 }, (_, i) => top - i).map((n) => ({
    ...one,
    seq: String(n),
    status: n % 2 ? "cancelled" : "expired",
    generation_after: 2,
    control_seq: String(3 * n),
    price: "1",
    escrow_returned: "0",
  }));
  const control = {
    ...JSON.parse(CLOSED.get_control as string),
    owner: o.owner ?? "buyer.near",
    generation: o.gen,
    control_seq: String(o.seq),
    operators: [],
    manifest_seq: o.manifestSeq ?? "0",
    service_manifest: o.manifest ?? "0".repeat(64),
    close_mode: o.gated ? "gated" : "direct",
    closer: o.gated ? "closer.near" : null,
  };
  const treasury = { ...JSON.parse(CLOSED.get_treasury as string), asset: o.asset ?? "tusd.near" };
  return {
    ...CLOSED,
    get_control: JSON.stringify(control),
    get_outcomes: JSON.stringify(ring),
    get_treasury: JSON.stringify(treasury),
  };
}

const refresher = (w: ReturnType<typeof world>) => (body?: unknown) =>
  w.m(`/api/businesses/${w.bid}/v3/refresh`, "POST", body);

describe("003h1 period coverage is separate evidence", () => {
  it("no month, a month, another month and a repeat at one block all coexist without a flag", async () => {
    const w = world();
    const refresh = refresher(w);
    w.transport.views = withMonths(ACCEPTING, 202610);
    expect((await refresh()).body).toMatchObject({ outcome: "accepted", period: null });
    expect((await refresh({ period: 202611 })).body).toMatchObject({
      outcome: "duplicate",
      period: { yyyymm: 202611, outcome: "accepted" },
    });
    expect((await refresh({ period: 202610 })).body.period.outcome).toBe("accepted");
    expect((await refresh({ period: 202611 })).body.period.outcome).toBe("duplicate");
    const v = (await w.m(`/api/businesses/${w.bid}/v3`)).body;
    expect(v.flag).toBeNull();
    expect(v.periods.map((p: Json) => [p.yyyymm, p.block.height, p.at_core_block])).toEqual([
      [202611, "1000", true],
      [202610, "1000", true],
    ]);
    expect(v.periods[0].period.escrow_in).toEqual({ amount: "300000000000000000000", exact: true });
    expect(w.count("v3_observations")).toBe(1);
  });

  it("the same month at the same block answering differently is a real conflict", async () => {
    const w = world();
    const refresh = refresher(w);
    await refresh({ period: 202611 });
    // Synthetic: get_period(202611) at block 1000 now gives other bytes.
    w.transport.views = edit(ACCEPTING, "get_period:202611", (p) => {
      p.period.earned.amount = "1";
    });
    const r = (await refresh({ period: 202611 })).body;
    expect(r).toMatchObject({ outcome: "duplicate", period: { outcome: "conflict" } });
    const v = (await w.m(`/api/businesses/${w.bid}/v3`)).body;
    expect(v.flag).toMatchObject({ code: "conflict", detail: "period 202611 at block 1000" });
    expect(v.periods[0].period.earned.amount).toBe("10000000000000000000"); // the first stands
  });

  it("concurrent reads: two months at one block both land; an older block's month never overwrites a newer one", async () => {
    const w = world();
    const refresh = refresher(w);
    w.transport.views = withMonths(ACCEPTING, 202610);
    const held = gate();
    w.transport.held = held.opened;
    const a = refresh({ period: 202611 });
    await w.transport.entered.opened;
    const b = refresh({ period: 202610 });
    held.open();
    const [ra, rb] = [(await a).body, (await b).body];
    expect([ra.outcome, rb.outcome].sort()).toEqual(["accepted", "duplicate"]);
    expect([ra.period.outcome, rb.period.outcome]).toEqual(["accepted", "accepted"]);
    // Reversed completion for one month: 1003 is read first, 1005 finishes first.
    w.transport.held = null;
    w.transport.at = block(1003);
    const late = gate();
    w.transport.held = late.opened;
    w.transport.entered = gate();
    const older = refresh({ period: 202611 });
    await w.transport.entered.opened;
    w.transport.held = null;
    w.transport.at = block(1005);
    expect((await refresh({ period: 202611 })).body.period.outcome).toBe("accepted");
    late.open();
    expect((await older).body).toMatchObject({ outcome: "stale", period: { outcome: "stale" } });
    const v = (await w.m(`/api/businesses/${w.bid}/v3`)).body;
    expect(v.periods.find((p: Json) => p.yyyymm === 202611).block.height).toBe("1005");
    expect(v.periods.find((p: Json) => p.yyyymm === 202610).block.height).toBe("1000");
    expect(v.flag).toBeNull();
  });

  it("a later read without a month keeps the month, labelled with its own block and age", async () => {
    let t = Date.parse("2026-11-03T10:00:00Z");
    const w = world({ now: () => t });
    const refresh = refresher(w);
    await refresh({ period: 202611 });
    t += 20 * 60_000;
    w.transport.at = block(1001);
    expect((await refresh()).body).toMatchObject({ outcome: "accepted", period: null });
    const v = (await w.m(`/api/businesses/${w.bid}/v3`)).body;
    expect(v.block.height).toBe("1001");
    expect(v.freshness).toBe("fresh");
    expect(v.periods).toEqual([
      expect.objectContaining({
        yyyymm: 202611,
        block: block(1000),
        at_core_block: false,
        observed_at: "2026-11-03T10:00:00.000Z",
        age_ms: 20 * 60_000,
        freshness: "stale",
      }),
    ]);
    expect(v.periods_note).toMatch(/absent, not zero/);
  });

  it("a refused core block contributes no month", async () => {
    const w = world();
    const refresh = refresher(w);
    await refresh();
    w.transport.at = block(1001);
    w.transport.views = edit(ACCEPTING, "get_control", (c) => {
      c.control_seq = "5";
    });
    expect((await refresh({ period: 202611 })).body).toMatchObject({
      outcome: "contradictory",
      period: { outcome: "not_recorded" },
    });
    expect(w.count("v3_periods")).toBe(0);
  });

  it("at most 24 months are kept, dropping the oldest evidence; months survive a restart", async () => {
    const path = join(here, `v3-months-${process.pid}-${Date.now()}.db`);
    try {
      const w = world({ dbPath: path });
      const refresh = refresher(w);
      const months = Array.from(
        { length: 25 },
        (_, i) => (2024 + Math.floor(i / 12)) * 100 + (i % 12) + 1,
      );
      for (const [i, m] of months.entries()) {
        w.transport.at = block(1000 + i);
        w.transport.views = withMonths(ACCEPTING, m);
        expect((await refresh({ period: m })).body.period.outcome).toBe("accepted");
      }
      expect(w.count("v3_periods")).toBe(24);
      const kept = (await w.m(`/api/businesses/${w.bid}/v3`)).body.periods.map(
        (p: Json) => p.yyyymm,
      );
      expect(kept).not.toContain(202401); // read at the lowest block
      expect(kept).toContain(202501);
      w.store.db.close();
      const store = new Store(openDb(path));
      const app = everstreetApi(store, {
        localPreview: true,
        environment: "test",
        v3: {
          transport: new Transport(),
          bindings: [{ business_id: w.bid, network: "testnet", account: BINDING_ACCOUNT }],
        },
      });
      const res = await app.request(`/api/businesses/${w.bid}/v3`, {
        headers: { cookie: `es_session=${w.mara.token}` },
      });
      expect(((await res.json()) as Json).periods).toHaveLength(24);
      store.db.close();
    } finally {
      for (const s of ["", "-wal", "-shm"]) rmSync(`${path}${s}`, { force: true });
    }
  });
});

describe("003h1 control changes only the ways the contract changes it", () => {
  /** Records `first` at block 1000 and `next` at 1001; returns the second outcome. */
  async function step(first: Record<string, string>, next: Record<string, string>) {
    const w = world();
    const refresh = refresher(w);
    w.transport.views = first;
    expect((await refresh()).body.outcome).toBe("accepted");
    w.transport.at = block(1001);
    w.transport.views = next;
    const r = (await refresh()).body;
    return { w, r, v: (await w.m(`/api/businesses/${w.bid}/v3`)).body };
  }

  const sameSeq: [string, (c: Json) => void][] = [
    ["operators", (c) => (c.operators = [["meter.near", 3, 1]])],
    [
      "manifest",
      (c) => {
        c.service_manifest = "ab".repeat(32);
        c.manifest_seq = "1";
      },
    ],
    ["live deal", (c) => (c.live_deal.available_floor = "1")],
    [
      "owner",
      (c) => {
        c.owner = "impostor.near";
        c.live_deal.seller = "impostor.near";
      },
    ],
  ];
  for (const [what, change] of sameSeq)
    it(`a ${what} change without a control step is contradictory and never projected`, async () => {
      const { r, v } = await step(ACCEPTING, edit(ACCEPTING, "get_control", change));
      expect(r.outcome).toBe("contradictory");
      expect(v.block.height).toBe("1000");
      expect(v.flag).toMatchObject({ code: "contradictory" });
      expect(v.flag.detail).toMatch(/without a control step/);
    });

  const later: [string, Record<string, string>, Record<string, string>, RegExp][] = [
    [
      "generation going back",
      wrapped({ gen: 3, seq: 50 }),
      wrapped({ gen: 2, seq: 51 }),
      /went back/,
    ],
    [
      "generation rising faster than control",
      wrapped({ gen: 2, seq: 50 }),
      wrapped({ gen: 5, seq: 51 }),
      /too fast/,
    ],
    [
      "owner changing within a generation",
      wrapped({ gen: 2, seq: 50 }),
      wrapped({ gen: 2, seq: 60, owner: "impostor.near" }),
      /owner/,
    ],
    [
      "close mode changing",
      wrapped({ gen: 2, seq: 50 }),
      wrapped({ gen: 2, seq: 51, gated: true }),
      /close mode/,
    ],
    [
      "asset changing",
      wrapped({ gen: 2, seq: 50 }),
      wrapped({ gen: 2, seq: 51, asset: "other.near" }),
      /asset/,
    ],
    [
      "manifest changing without its sequence",
      wrapped({ gen: 2, seq: 50, manifestSeq: "3", manifest: "aa".repeat(32) }),
      wrapped({ gen: 2, seq: 51, manifestSeq: "3", manifest: "bb".repeat(32) }),
      /manifest/,
    ],
    [
      "the latest deal number going back",
      wrapped({ gen: 2, seq: 50, top: 12 }),
      wrapped({ gen: 2, seq: 51, top: 10 }),
      /deal number/,
    ],
  ];
  for (const [what, first, next, why] of later)
    it(`at a higher control step: ${what} is contradictory`, async () => {
      const { r, v } = await step(first, next);
      expect(r.outcome).toBe("contradictory");
      expect(v.flag.detail).toMatch(why);
      expect(v.block.height).toBe("1000");
    });

  it("legitimate changes are accepted: customer activity, manifest, operators, sales, skipped steps", async () => {
    // Same control step, money moves (customer activity).
    const money = edit(ACCEPTING, "get_treasury", (t) => {
      t.held = "401000000000000000000";
      t.ent_free_value = "91000000000000000000";
    });
    expect((await step(ACCEPTING, money)).r.outcome).toBe("accepted");
    // After a direct sale: set_manifest, then appoint and revoke operators, each one control step.
    const manifest = edit(CLOSED, "get_control", (c) => {
      c.control_seq = "8";
      c.manifest_seq = "1";
      c.service_manifest = "ab".repeat(32);
    });
    expect((await step(CLOSED, manifest)).r.outcome).toBe("accepted");
    const operators = edit(CLOSED, "get_control", (c) => {
      c.control_seq = "9";
      c.operators = [
        ["meter2.near", 1, 2],
        ["support.near", 2, 2],
      ];
    });
    expect((await step(CLOSED, operators)).r.outcome).toBe("accepted");
    // The real direct sale (fixtures), and one seen only after many skipped steps.
    expect((await step(ACCEPTING, CLOSED)).r.outcome).toBe("accepted");
    const far = edit(
      edit(CLOSED, "get_control", (c) => (c.control_seq = "40")),
      "get_outcomes",
      (os) => (os[0].control_seq = "38"),
    );
    expect((await step(ACCEPTING, far)).r.outcome).toBe("accepted");
    // A gated close finalized by its closer (synthetic from the closed fixture).
    const gatedClosed = edit(
      edit(CLOSED, "get_control", (c) => {
        c.close_mode = "gated";
        c.closer = "closer.near";
        c.control_seq = "8";
      }),
      "get_outcomes",
      (os) => (os[0].control_seq = "8"),
    );
    const g = await step(CLOSING, gatedClosed);
    expect(g.r.outcome).toBe("accepted");
    expect(g.v.control).toMatchObject({
      owner: "buyer.near",
      generation: 2,
      closer: "closer.near",
    });
    expect(g.w.ownerOf()).toBe(g.w.mara.id); // never app ownership
  });
});

describe("003h1 one snapshot must be coherent with itself", () => {
  const parts = (v: Record<string, string>) => ({
    control: decodeControl(JSON.parse(v.get_control as string)),
    outcomes: decodeOutcomes(JSON.parse(v.get_outcomes as string)),
    treasury: decodeTreasury(JSON.parse(v.get_treasury as string)),
    pending: decodePending(JSON.parse(v.get_pending as string)),
  });

  it("the real fixtures and the synthetic wrapped ring are coherent", () => {
    for (const v of [ACCEPTING, CLOSED, CLOSING, wrapped({ gen: 2, seq: 50 })])
      expect(() => coherent(parts(v))).not.toThrow();
  });

  const bad: [string, Record<string, string>][] = [
    [
      "an operator from another generation",
      edit(ACCEPTING, "get_control", (c) => (c.operators = [["meter.near", 1, 2]])),
    ],
    [
      "a live deal whose seller isn't the owner",
      edit(ACCEPTING, "get_control", (c) => (c.owner = "impostor.near")),
    ],
    [
      "a live deal from another generation",
      edit(ACCEPTING, "get_control", (c) => (c.live_deal.expected_generation = 2)),
    ],
    [
      "a direct deal sitting closing",
      edit(ACCEPTING, "get_control", (c) => (c.live_deal.state = "closing")),
    ],
    [
      "a closing deal off the control sequence",
      edit(CLOSING, "get_control", (c) => (c.live_deal.closing_control_seq = "6")),
    ],
    ["a gap in the outcome ring", edit(CLOSED, "get_outcomes", (os) => (os[0].seq = "2"))],
    [
      "a live deal not following the ring",
      edit(ACCEPTING, "get_control", (c) => (c.live_deal.seq = "3")),
    ],
    [
      "the latest sale's buyer not owning",
      edit(CLOSED, "get_control", (c) => (c.owner = "impostor.near")),
    ],
    [
      "a generation the sales don't explain",
      edit(CLOSED, "get_control", (c) => {
        c.generation = 3;
        c.operators = [];
      }),
    ],
    [
      "an outcome newer than control",
      edit(CLOSED, "get_outcomes", (os) => (os[0].control_seq = "9")),
    ],
  ];
  for (const [what, v] of bad)
    it(`refuses ${what}`, () => {
      let code = "";
      try {
        coherent(parts(v));
      } catch (e) {
        code = e instanceof V3ReadError ? e.code : String(e);
      }
      expect(code).toBe("malformed");
    });
});

describe("003h1 trusted setup is validated at construction", () => {
  it("refuses unsound retention, timing and bindings with a clear error", () => {
    const store = new Store(openDb(":memory:"));
    const ok = { business_id: "b1", network: "testnet", account: "studio.biz.near" };
    const cases: Partial<V3Options>[] = [
      { retention: 0 },
      { retention: -1 },
      { retention: 1.5 },
      { retention: Number.NaN },
      { staleAfterMs: 0 },
      { timeoutMs: -5 },
      { bindings: [{ ...ok, account: "Not An Account" }] },
      { bindings: [{ ...ok, network: "Test Net" }] },
      { bindings: [ok, { ...ok, account: "other.near" }] },
    ];
    for (const c of cases)
      expect(
        () => new V3Observations(store.db, store, { transport: null, bindings: [], ...c }),
      ).toThrow(/^v3 options: /);
    expect(() =>
      everstreetApi(store, {
        localPreview: true,
        environment: "test",
        v3: { transport: null, bindings: [], retention: 0 },
      }),
    ).toThrow(/retention/);
    expect(
      () => new V3Observations(store.db, store, { transport: null, bindings: [ok], retention: 1 }),
    ).not.toThrow();
  });
});
