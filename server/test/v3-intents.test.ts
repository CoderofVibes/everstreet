// Job 003k: exact v3 acquisition intents and local reconciliation, through the real API.
//
// Evidence kinds, kept apart:
// - CONTRACT FIXTURES: direct-accepting.json and direct-closed.json are views produced by the
//   business-v3 contract's own unit test (actual methods: propose, fund, accept). The live deal in
//   ACCEPTING and the outcome in CLOSED are the same deal (seq 1, version 1, same digest).
// - SYNTHETIC mutations of those fixtures are labelled where used, and kept coherent with the
//   contract's invariants (V3_OBSERVATIONS.md §4a).
// - APP API evidence: everything asserted about owners, ownership history, grants and access.
// The transport is an in-memory double; nothing here reaches a network. Fictional people.

import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { everstreetApi } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";
import type { BlockRef, ViewTransport } from "../src/v3read.ts";

// biome-ignore lint/suspicious/noExplicitAny: tests read deep response fields
type Json = Record<string, any>;

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(here, "fixtures", "v3", `${name}.json`), "utf8")) as Record<
    string,
    string
  >;
const ACCEPTING = fixture("direct-accepting"); // contract fixture
const CLOSED = fixture("direct-closed"); // contract fixture
const DIGEST = "aa53a9ad33a13ba3e609344b36591db8339482e852a6044a52d1cbda5b68dda4";
const ACCOUNT = "studio.biz.testnet";

const hashAt = (h: number, v = "A") => `${v}${String(h).replace(/0/g, "z")}`.padEnd(44, "x");

/** Edits one view of a fixture copy (synthetic; labelled at each use). */
function edit(views: Record<string, string>, method: string, f: (v: Json) => void) {
  const v = JSON.parse(views[method] as string);
  f(v);
  return { ...views, [method]: JSON.stringify(v) };
}

/** In memory. `at` is the final block; `holdOnce` makes the next final-block read wait. */
class Transport implements ViewTransport {
  readonly network = "testnet";
  at: BlockRef = { height: "1000", hash: hashAt(1000) };
  views: Record<string, string> = { ...ACCEPTING };
  skew: { method: string; block: BlockRef } | null = null;
  throwWith: Error | null = null;
  private held: { gate: Promise<void>; entered: () => void } | null = null;
  holdOnce() {
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const arrived = new Promise<void>((r) => {
      entered = r;
    });
    this.held = { gate, entered };
    return { release, arrived };
  }
  async finalBlock() {
    if (this.throwWith) throw this.throwWith;
    const h = this.held;
    const at = this.at;
    if (h) {
      this.held = null;
      h.entered();
      await h.gate;
    }
    return at;
  }
  async view(input: Parameters<ViewTransport["view"]>[0]) {
    const key = input.method === "get_period" ? `get_period:${input.args.yyyymm}` : input.method;
    const result = this.views[key];
    if (result === undefined) throw new Error(`no fixture for ${key}`);
    return { result, block: this.skew?.method === input.method ? this.skew.block : input.block };
  }
  /** Moves to a new final block with these views. */
  next(views: Record<string, string>) {
    const h = Number(this.at.height) + 1;
    this.at = { height: String(h), hash: hashAt(h) };
    this.views = views;
  }
}

function world(
  opts: { dbPath?: string; transport?: Transport; account?: string; store?: Store } = {},
) {
  const store = opts.store ?? new Store(openDb(opts.dbPath ?? ":memory:"));
  const people: Record<string, string> = Object.fromEntries(
    (
      store.db.prepare("SELECT id, display_name FROM people").all() as {
        id: string;
        display_name: string;
      }[]
    ).map((p) => [p.display_name, p.id]),
  );
  const person = (name: string) => {
    if (people[name])
      return { id: people[name] as string, token: store.sessionFor(people[name] as string) };
    const { person: p, token } = store.createPerson(name);
    people[name] = p.id;
    return { id: p.id, token };
  };
  const mara = person("Mara Solis"); // seller, founder.near
  const noah = person("Noah Fenn"); // buyer, buyer.near
  const ana = person("Ana Ruiz"); // unrelated
  let bid = (
    store.db.prepare("SELECT id FROM businesses WHERE name = 'Ledgerline Labs'").get() as
      | { id: string }
      | undefined
  )?.id;
  if (!bid) {
    bid = store.tx(() =>
      store.insertBusiness(
        store.person(mara.id) as never,
        "started",
        "Ledgerline Labs",
        "software",
      ),
    ).businessId;
    const link = (pid: string, account: string) =>
      store.db
        .prepare(
          "INSERT INTO chain_accounts (owner_kind, owner_id, account_id, secret, tx, created_at) VALUES ('person', ?, ?, NULL, 'fixture', ?)",
        )
        .run(pid, account, new Date().toISOString());
    link(mara.id, "founder.near");
    link(noah.id, "buyer.near");
  }
  const transport = opts.transport ?? new Transport();
  const app = everstreetApi(store, {
    localPreview: true,
    environment: "test",
    v3: {
      transport,
      bindings: [{ business_id: bid, network: "testnet", account: opts.account ?? ACCOUNT }],
      timeoutMs: 1_000,
    },
  });
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
  const count = (sql: string, ...args: string[]) =>
    (store.db.prepare(sql).get(...args) as { n: number }).n;
  const ownerOf = () =>
    (
      store.db.prepare("SELECT owner_id FROM businesses WHERE id = ?").get(bid) as {
        owner_id: string;
      }
    ).owner_id;
  return {
    store,
    app,
    transport,
    bid: bid as string,
    mara,
    noah,
    ana,
    m: as(mara.token),
    n: as(noah.token),
    a: as(ana.token),
    count,
    ownerOf,
  };
}

const INTENT = { idempotency_key: "intent-key-0001", deal_seq: "1", version: 1, digest: DIGEST };

/** Observes the live deal (contract fixture) and records the intent. */
async function withIntent(w: ReturnType<typeof world>) {
  expect((await w.m(`/api/businesses/${w.bid}/v3/refresh`, "POST")).body.outcome).toBe("accepted");
  const r = await w.m(`/api/businesses/${w.bid}/v3/intents`, "POST", INTENT);
  expect(r.status).toBe(201);
  return r.body.intent.id as string;
}

const reconcile = (call: ReturnType<typeof world>["m"], bid: string, id: string) =>
  call(`/api/businesses/${bid}/v3/intents/${id}/reconcile`, "POST");

/** Everything a sale would change, so "nothing changed" can be checked exactly. */
function authority(w: ReturnType<typeof world>) {
  return {
    owner: w.ownerOf(),
    history: w.count("SELECT COUNT(*) AS n FROM ownership WHERE business_id = ?", w.bid),
    sold: w.count(
      "SELECT COUNT(*) AS n FROM events WHERE type = 'business.sold' AND subject = ?",
      w.bid,
    ),
  };
}

describe("003k recording an exact intent", () => {
  it("takes every term from the observed live deal; replays exactly; refuses a reused key or a second intent", async () => {
    const w = world();
    const id = await withIntent(w);
    const list = (await w.m(`/api/businesses/${w.bid}/v3/intents`)).body.intents;
    expect(list).toEqual([
      expect.objectContaining({
        id,
        status: "recorded",
        deal: { seq: "1", version: 1, digest: DIGEST },
        seller_account: "founder.near",
        buyer_account: "buyer.near",
        expected_generation: 1,
        terms: expect.objectContaining({ price: "300000000000000000000", close_mode: "direct" }),
      }),
    ]);
    // An exact replay returns the same intent; a reused key with other input is refused.
    const again = await w.m(`/api/businesses/${w.bid}/v3/intents`, "POST", INTENT);
    expect([again.status, again.body.intent.id]).toEqual([200, id]);
    const reused = await w.m(`/api/businesses/${w.bid}/v3/intents`, "POST", {
      ...INTENT,
      version: 2,
    });
    expect([reused.status, reused.body.code]).toEqual([409, "key_reused"]);
    const second = await w.m(`/api/businesses/${w.bid}/v3/intents`, "POST", {
      ...INTENT,
      idempotency_key: "intent-key-0002",
    });
    expect([second.status, second.body.code]).toEqual([409, "already_recorded"]);
  });

  it("refuses a deal that isn't exactly the observed one, and ignores caller-supplied identity", async () => {
    const w = world();
    await w.m(`/api/businesses/${w.bid}/v3/refresh`, "POST");
    for (const [over, code] of [
      [{ digest: "b".repeat(64) }, "deal_mismatch"],
      [{ version: 2 }, "deal_mismatch"],
      [{ deal_seq: "2" }, "deal_mismatch"],
    ] as const) {
      const r = await w.m(`/api/businesses/${w.bid}/v3/intents`, "POST", {
        ...INTENT,
        idempotency_key: `bad-${code}-${Object.keys(over)[0]}`,
        ...over,
      });
      expect([r.status, r.body.code]).toEqual([409, code]);
    }
    for (const [over, why] of [
      [{ idempotency_key: "short" }, /idempotency_key/],
      [{ deal_seq: 1 }, /deal_seq/],
      [{ version: 0 }, /version/],
      [{ digest: "AA".repeat(32) }, /digest/],
    ] as const) {
      const r = await w.m(`/api/businesses/${w.bid}/v3/intents`, "POST", { ...INTENT, ...over });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(why);
    }
    // A caller can't name the buyer, the accounts or the contract: those come from the evidence.
    const r = await w.m(`/api/businesses/${w.bid}/v3/intents`, "POST", {
      ...INTENT,
      buyer_person_id: w.ana.id,
      buyer_account: "evil.near",
      network: "mainnet",
      account: "other.testnet",
    });
    expect(r.status).toBe(201);
    expect(r.body.intent).toMatchObject({
      buyer_account: "buyer.near",
      source: { network: "testnet", account: ACCOUNT },
    });
    const stored = w.store.db.prepare("SELECT buyer_person_id FROM v3_intents").get() as Json;
    expect(stored.buyer_person_id).toBe(w.noah.id);
  });

  it("refuses unknown or ambiguous identity, flagged evidence, a non-owner and no evidence", async () => {
    const w = world();
    expect((await w.m(`/api/businesses/${w.bid}/v3/intents`, "POST", INTENT)).body.code).toBe(
      "never_observed",
    );
    await w.m(`/api/businesses/${w.bid}/v3/refresh`, "POST");
    expect((await w.n(`/api/businesses/${w.bid}/v3/intents`, "POST", INTENT)).status).toBe(404);
    expect((await w.a(`/api/businesses/${w.bid}/v3/intents`)).status).toBe(404);
    // The buyer's account linked to nobody, or to a business rather than a person.
    w.store.db.prepare("DELETE FROM chain_accounts WHERE account_id = 'buyer.near'").run();
    expect((await w.m(`/api/businesses/${w.bid}/v3/intents`, "POST", INTENT)).body.code).toBe(
      "buyer_unmapped",
    );
    w.store.db
      .prepare(
        "INSERT INTO chain_accounts (owner_kind, owner_id, account_id, secret, tx, created_at) VALUES ('business', ?, 'buyer.near', NULL, 'fixture', ?)",
      )
      .run(w.bid, new Date().toISOString());
    expect((await w.m(`/api/businesses/${w.bid}/v3/intents`, "POST", INTENT)).body.code).toBe(
      "buyer_unmapped",
    );
    // Flagged evidence (synthetic: the same block answered with other content).
    const f = world();
    await f.m(`/api/businesses/${f.bid}/v3/refresh`, "POST");
    f.transport.views = edit(ACCEPTING, "get_control", (c) => {
      c.manifest_seq = "0";
      c.operators = [];
    });
    expect((await f.m(`/api/businesses/${f.bid}/v3/refresh`, "POST")).body.outcome).toBe(
      "conflict",
    );
    expect((await f.m(`/api/businesses/${f.bid}/v3/intents`, "POST", INTENT)).body.code).toBe(
      "evidence_flagged",
    );
  });
});

describe("003k reconciliation applies only an exact, coherent close", () => {
  it("the matching closed outcome (contract fixtures) applies once: owner, one history entry, one event, revocations", async () => {
    const w = world();
    // App-side state the seller set up, which a sale must end (fictional).
    w.store.db
      .prepare(
        "INSERT INTO team (business_id, person_id, capabilities, created_at) VALUES (?, ?, 'support', ?)",
      )
      .run(w.bid, w.ana.id, new Date().toISOString());
    const project = (
      await w.m("/api/product-projects", "POST", {
        idea: "Turn fictional supplier invoices into clean rows",
        foundation: "ai_api",
        business_id: w.bid,
      })
    ).body;
    const revisions = w.count(
      "SELECT COUNT(*) AS n FROM product_revisions WHERE project_id = ?",
      project.project.id,
    );
    const id = await withIntent(w);
    const before = authority(w);
    // While the deal is still live: pending, nothing changes.
    w.transport.next(ACCEPTING);
    expect((await reconcile(w.n, w.bid, id)).body).toMatchObject({
      state: "pending",
      code: "deal_accepting",
    });
    expect(authority(w)).toEqual(before);
    // The contract shows it closed (contract fixture): applied, by the buyer.
    w.transport.next(CLOSED);
    const r = await reconcile(w.n, w.bid, id);
    expect(r.body).toMatchObject({
      state: "applied",
      receipt: { role: "buyer", status: "applied", target_generation: 2, outcome_control_seq: "7" },
    });
    expect(authority(w)).toEqual({
      owner: w.noah.id,
      history: before.history + 1,
      sold: before.sold + 1,
    });
    const entry = w.store.db
      .prepare(
        "SELECT from_id, to_id, generation, v3_intent_id, deal_id FROM ownership WHERE business_id = ?",
      )
      .get(w.bid) as Json;
    expect(entry).toEqual({
      from_id: w.mara.id,
      to_id: w.noah.id,
      generation: 2,
      v3_intent_id: id,
      deal_id: null,
    });
    // What the seller set up is revoked; product records and revisions are untouched.
    expect(
      w.store.db
        .prepare("SELECT revoked_at FROM team WHERE business_id = ? AND person_id = ?")
        .get(w.bid, w.ana.id),
    ).toMatchObject({ revoked_at: expect.any(String) });
    expect(
      w.count(
        "SELECT COUNT(*) AS n FROM product_revisions WHERE project_id = ?",
        project.project.id,
      ),
    ).toBe(revisions);
    // The seller loses private access; the buyer gains owner access to the same records.
    expect((await w.m(`/api/product-projects/${project.project.id}`)).status).toBe(404);
    expect((await w.m(`/api/businesses/${w.bid}/v3`)).status).toBe(404);
    expect((await w.m(`/api/businesses/${w.bid}/v3/intents`)).status).toBe(404);
    expect((await w.n(`/api/product-projects/${project.project.id}`)).status).toBe(200);
    expect((await w.n(`/api/businesses/${w.bid}/v3`)).body).toMatchObject({
      owner_match: "matches",
    });
    // The former owner keeps only a small receipt, with no business records.
    const receipt = await w.m(`/api/businesses/${w.bid}/v3/intents/${id}`);
    expect(receipt.body.receipt).toMatchObject({ role: "seller", status: "applied" });
    expect(receipt.text).not.toMatch(/Ledgerline|invoices|treasury|terms/);
    expect((await w.a(`/api/businesses/${w.bid}/v3/intents/${id}`)).status).toBe(404);
    expect((await reconcile(w.a, w.bid, id)).status).toBe(404);
  });

  it("retries, a lost reply and concurrent calls converge on one entry and one event", async () => {
    const w = world();
    const id = await withIntent(w);
    const before = authority(w);
    w.transport.next(CLOSED);
    const [x, y] = await Promise.all([reconcile(w.n, w.bid, id), reconcile(w.m, w.bid, id)]);
    expect([x.body.state, y.body.state].sort()).toEqual(["already", "applied"]);
    // A lost reply: the participant simply asks again.
    expect((await reconcile(w.n, w.bid, id)).body.state).toBe("already");
    expect((await reconcile(w.m, w.bid, id)).body).toMatchObject({
      state: "already",
      receipt: { role: "seller" },
    });
    expect(authority(w)).toEqual({
      owner: w.noah.id,
      history: before.history + 1,
      sold: before.sold + 1,
    });
  });

  it("survives a restart before and after the commit", async () => {
    const path = join(here, `v3-intents-${process.pid}-${Date.now()}.db`);
    const opened: Store[] = [];
    try {
      const s1 = new Store(openDb(path));
      opened.push(s1);
      const w1 = world({ store: s1 });
      const id = await withIntent(w1);
      s1.db.close();
      const s2 = new Store(openDb(path));
      opened.push(s2);
      const t2 = new Transport();
      t2.at = { height: "1001", hash: hashAt(1001) };
      t2.views = CLOSED;
      const w2 = world({ store: s2, transport: t2 });
      expect((await reconcile(w2.n, w2.bid, id)).body.state).toBe("applied");
      s2.db.close();
      const s3 = new Store(openDb(path));
      opened.push(s3);
      const t3 = new Transport();
      t3.at = { height: "1002", hash: hashAt(1002) };
      t3.views = CLOSED;
      const w3 = world({ store: s3, transport: t3 });
      expect((await reconcile(w3.n, w3.bid, id)).body.state).toBe("already");
      expect(w3.count("SELECT COUNT(*) AS n FROM ownership WHERE v3_intent_id = ?", id)).toBe(1);
    } finally {
      for (const s of opened)
        try {
          s.db.close();
        } catch {}
      for (const s of ["", "-wal", "-shm"]) rmSync(`${path}${s}`, { force: true });
    }
  });

  it("a closed outcome that differs in version, digest, party, price or generation changes nothing", async () => {
    // Synthetic, each coherent: one field of the contract fixture's outcome (and control) changed.
    const cases: [string, Record<string, string>][] = [
      ["version", edit(CLOSED, "get_outcomes", (os) => (os[0].version = 2))],
      ["digest", edit(CLOSED, "get_outcomes", (os) => (os[0].digest = "c".repeat(64)))],
      ["price", edit(CLOSED, "get_outcomes", (os) => (os[0].price = "299000000000000000000"))],
      [
        "buyer",
        edit(
          edit(CLOSED, "get_outcomes", (os) => (os[0].buyer = "other.near")),
          "get_control",
          (c) => (c.owner = "other.near"),
        ),
      ],
    ];
    for (const [what, views] of cases) {
      const w = world();
      const id = await withIntent(w);
      const before = authority(w);
      w.transport.next(views);
      const r = await reconcile(w.n, w.bid, id);
      expect(r.body, what).toMatchObject({ state: "conflict", code: "outcome_mismatch" });
      expect(authority(w)).toEqual(before);
    }
  });

  it("a cancelled, expired or aborted deal ends the intent without a sale", async () => {
    for (const status of ["cancelled", "expired", "aborted"]) {
      // Synthetic, coherent: the deal ended unsold, so control stays with the seller at gen 1.
      const views = edit(
        edit(CLOSED, "get_outcomes", (os) => {
          os[0].status = status;
          os[0].generation_after = 1;
        }),
        "get_control",
        (c) => {
          c.owner = "founder.near";
          c.generation = 1;
          c.operators = [["meter.near", 1, 1]];
        },
      );
      const w = world();
      const id = await withIntent(w);
      const before = authority(w);
      w.transport.next(views);
      expect((await reconcile(w.m, w.bid, id)).body).toMatchObject({
        state: "ended",
        code: status,
      });
      expect(authority(w)).toEqual(before);
      expect((await reconcile(w.m, w.bid, id)).body.state).toBe("ended");
    }
  });

  it("a newer transfer after the sale, or a history gap over the deal, is never guessed through", async () => {
    // Synthetic, coherent: deal 1 closed to buyer.near, then deal 2 closed to other.near.
    const one = JSON.parse(CLOSED.get_outcomes as string)[0];
    const two = {
      ...one,
      seq: "2",
      seller: "buyer.near",
      buyer: "other.near",
      generation_after: 3,
      control_seq: "9",
      digest: "d".repeat(64),
    };
    const resold = edit(
      { ...CLOSED, get_outcomes: JSON.stringify([two, one]) },
      "get_control",
      (c) => {
        c.owner = "other.near";
        c.generation = 3;
        c.control_seq = "9";
        c.operators = [];
      },
    );
    const w = world();
    const id = await withIntent(w);
    const before = authority(w);
    w.transport.next(resold);
    expect((await reconcile(w.n, w.bid, id)).body).toMatchObject({
      state: "conflict",
      code: "newer_transfer",
    });
    expect(authority(w)).toEqual(before);
    // Synthetic, coherent: ten later deals ended unsold; deal 1's outcome scrolled out unseen.
    const ring = Array.from({ length: 8 }, (_, i) => 10 - i).map((n) => ({
      ...one,
      seq: String(n),
      status: n % 2 ? "cancelled" : "expired",
      generation_after: 2,
      control_seq: String(3 * n),
      price: "1",
    }));
    const gap = edit({ ...CLOSED, get_outcomes: JSON.stringify(ring) }, "get_control", (c) => {
      c.control_seq = "50";
      c.operators = [];
    });
    const g = world();
    const gid = await withIntent(g);
    g.transport.next(gap);
    expect((await reconcile(g.n, g.bid, gid)).body).toMatchObject({
      state: "unavailable",
      code: "history_gap",
    });
    expect(g.ownerOf()).toBe(g.mara.id);
  });
});

describe("003k evidence that can't grant authority", () => {
  it("unreadable, mixed-block, conflicting and stale evidence change nothing", async () => {
    const w = world();
    const id = await withIntent(w);
    const before = authority(w);
    w.transport.throwWith = new Error("ECONNREFUSED hunter2");
    const down = await reconcile(w.n, w.bid, id);
    expect(down.body).toMatchObject({ state: "unavailable", code: "unavailable" });
    expect(down.text).not.toContain("hunter2");
    w.transport.throwWith = null;
    w.transport.next(CLOSED);
    w.transport.skew = { method: "get_outcomes", block: { height: "999", hash: hashAt(999) } };
    expect((await reconcile(w.n, w.bid, id)).body).toMatchObject({
      state: "unavailable",
      code: "mixed_blocks",
    });
    w.transport.skew = null;
    // Stale: an older block than the one recorded.
    w.transport.at = { height: "900", hash: hashAt(900) };
    expect((await reconcile(w.n, w.bid, id)).body).toMatchObject({
      state: "unavailable",
      code: "evidence_stale",
    });
    // Conflict: the recorded block (1000) answered with other content: flagged, sticky.
    w.transport.at = { height: "1000", hash: hashAt(1000) };
    expect((await reconcile(w.n, w.bid, id)).body).toMatchObject({
      state: "conflict",
      code: "evidence_conflict",
    });
    // Even a genuine close afterwards can't apply over the flag.
    w.transport.at = { height: "1005", hash: hashAt(1005) };
    expect((await reconcile(w.n, w.bid, id)).body).toMatchObject({
      state: "conflict",
      code: "evidence_flagged",
    });
    expect(authority(w)).toEqual(before);
  });

  it("a changed binding, changed identity mapping or a newer local owner refuses to apply", async () => {
    const w = world();
    const id = await withIntent(w);
    // The operator now binds the business to another contract (same database).
    const moved = world({ store: w.store, account: "elsewhere.testnet" });
    moved.transport.next(CLOSED);
    expect((await reconcile(moved.n, moved.bid, id)).body).toMatchObject({
      state: "conflict",
      code: "binding_changed",
    });
    // The buyer's account is relinked to someone else after the intent.
    w.store.db
      .prepare("UPDATE chain_accounts SET owner_id = ? WHERE account_id = 'buyer.near'")
      .run(w.ana.id);
    w.transport.next(CLOSED);
    expect((await reconcile(w.n, w.bid, id)).body).toMatchObject({
      state: "conflict",
      code: "mapping_changed",
    });
    w.store.db
      .prepare("UPDATE chain_accounts SET owner_id = ? WHERE account_id = 'buyer.near'")
      .run(w.noah.id);
    // Locally the business went away and came back after the intent: the local history moved on.
    // These app-side entries carry no chain generation (null), so only the local epoch catches it.
    for (const [from, to] of [
      [w.mara.id, w.ana.id],
      [w.ana.id, w.mara.id],
    ] as const) {
      w.store.db.prepare("UPDATE businesses SET owner_id = ? WHERE id = ?").run(to, w.bid);
      w.store.db
        .prepare(
          "INSERT INTO ownership (business_id, from_id, to_id, generation, at) VALUES (?, ?, ?, NULL, ?)",
        )
        .run(w.bid, from, to, new Date().toISOString());
    }
    w.transport.next(CLOSED);
    expect((await reconcile(w.n, w.bid, id)).body).toMatchObject({
      state: "conflict",
      code: "local_owner_changed",
    });
    expect(w.ownerOf()).toBe(w.mara.id);
    expect(w.count("SELECT COUNT(*) AS n FROM ownership WHERE v3_intent_id = ?", id)).toBe(0);
  });

  it("a seller's request in flight when the sale applies is denied afterwards", async () => {
    const w = world();
    const id = await withIntent(w);
    w.transport.next(CLOSED);
    const hold = w.transport.holdOnce();
    const sellersRead = w.m(`/api/businesses/${w.bid}/v3/refresh`, "POST"); // waits in the transport
    await hold.arrived;
    expect((await reconcile(w.n, w.bid, id)).body.state).toBe("applied");
    hold.release();
    const late = await sellersRead;
    expect(late.status).toBe(404);
    expect(late.text).not.toContain("treasury");
  });
});
