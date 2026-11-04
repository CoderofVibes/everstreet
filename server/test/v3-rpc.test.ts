// Job 003i: the read-only testnet JSON-RPC adapter and the observation-format upgrade.
// Every HTTP exchange is synthetic: an injected fetch builds Response objects in memory from the
// real Rust-produced fixtures, so nothing here can reach a real endpoint. Fictional data.

import { createHash } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { everstreetApi } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";
import {
  coreDigest,
  OBSERVATION_FORMAT,
  upgradeObservationFormat,
  V3Observations,
} from "../src/v3observe.ts";
import { readSnapshot, type V3Binding, type ViewTransport } from "../src/v3read.ts";
import { type FetchLike, TestnetRpcTransport, validateRpcConfig } from "../src/v3rpc.ts";

// biome-ignore lint/suspicious/noExplicitAny: tests read deep response fields
type Json = Record<string, any>;

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(here, "fixtures", "v3", `${name}.json`), "utf8")) as Record<
    string,
    string
  >;
const ACCEPTING = fixture("direct-accepting");
const CLOSING = fixture("gated-closing");

const ENDPOINT = "https://rpc.testnet.example.invalid/secret-path-token";
const HASH = "9tFkUmtWpR9kZLqgZVjDdsP7rN5vGnHxJ3cYbA2sQeWf";
const OTHER = "8sEjTlsVoQ8jYKpfYUiCcrO6qM4uFmGwI2bXaZ1rPdVe".replace(/[0OIl]/g, "x");
const HEIGHT = 187_310_138;
const ACCOUNT = "studio.biz.testnet";
const binding: V3Binding = { business_id: "b", network: "testnet", account: ACCOUNT };

interface Sent {
  url: string;
  init: Parameters<FetchLike>[1];
  body: Json;
}

/** A synthetic JSON-RPC endpoint. `respond` decides each answer; defaults serve the fixtures. */
class FakeRpc {
  sent: Sent[] = [];
  views: Record<string, string> = {
    ...ACCEPTING,
    // Synthetic (labelled): the real 202611 answer renumbered to another month.
    "get_period:202610": (ACCEPTING["get_period:202611"] as string).replaceAll("202611", "202610"),
  };
  inFlight = 0;
  maxInFlight = 0;
  hold: Promise<void> | null = null;
  aborted = 0;
  respond: ((req: Json, init: Sent["init"]) => Response | Promise<Response>) | null = null;
  fetch: FetchLike = async (url, init) => {
    const body = JSON.parse(init.body) as Json;
    this.sent.push({ url, init, body });
    init.signal.addEventListener("abort", () => this.aborted++, { once: true });
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.hold)
        await Promise.race([
          this.hold,
          new Promise((_, reject) =>
            init.signal.addEventListener("abort", () => reject(new Error("aborted")), {
              once: true,
            }),
          ),
        ]);
      return await (this.respond ?? ((r) => this.serve(r)))(body, init);
    } finally {
      this.inFlight--;
    }
  };
  serve(req: Json): Response {
    if (req.method === "block")
      return ok(req.id, { header: { height: HEIGHT, hash: HASH, timestamp: 1 } });
    const p = req.params;
    const args = JSON.parse(Buffer.from(p.args_base64, "base64").toString("utf8"));
    const key = p.method_name === "get_period" ? `get_period:${args.yyyymm}` : p.method_name;
    const text = this.views[key] as string;
    return ok(req.id, {
      result: [...Buffer.from(text, "utf8")],
      logs: [],
      block_height: HEIGHT,
      block_hash: p.block_id,
    });
  }
  queries() {
    return this.sent.filter((s) => s.body.method === "query");
  }
}

const ok = (id: unknown, result: unknown) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** A documented handler error: `error.name` HANDLER_ERROR, the reason in `error.cause.name`. */
const err = (id: unknown, name: string) =>
  new Response(
    JSON.stringify({ jsonrpc: "2.0", id, error: { name: "HANDLER_ERROR", cause: { name } } }),
    { status: 200 },
  );

const transportFor = (rpc: FakeRpc, extra: Json = {}) =>
  new TestnetRpcTransport({ network: "testnet", endpoint: ENDPOINT, ...extra }, rpc.fetch);

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? `other: ${e}`;
  }
};

describe("003i the adapter speaks only the documented read-only protocol", () => {
  it("pins the final block, then reads every view at exactly that hash", async () => {
    const rpc = new FakeRpc();
    const s = await readSnapshot(transportFor(rpc), binding, { period: 202611 });
    expect(s.block).toEqual({ height: String(HEIGHT), hash: HASH });
    expect(s.control).toMatchObject({
      owner: "founder.near",
      control_seq: "6",
      close_mode: "direct",
    });
    expect(s.treasury.held).toBe("400000000000000000000");
    const [first, ...rest] = rpc.sent;
    expect(first?.body).toMatchObject({
      jsonrpc: "2.0",
      method: "block",
      params: { finality: "final" },
    });
    expect(first?.body.params.block_id).toBeUndefined();
    expect(rest).toHaveLength(5);
    for (const q of rest) {
      expect(q.url).toBe(ENDPOINT);
      expect(q.init).toMatchObject({ method: "POST", redirect: "error" });
      expect(q.body.method).toBe("query");
      expect(q.body.params).toMatchObject({
        request_type: "call_function",
        block_id: HASH,
        account_id: ACCOUNT,
      });
      expect(q.body.params.finality).toBeUndefined();
    }
    const args = rest.map((q) => [
      q.body.params.method_name,
      JSON.parse(Buffer.from(q.body.params.args_base64, "base64").toString()),
    ]);
    expect(args).toEqual(
      expect.arrayContaining([
        ["get_control", {}],
        ["get_outcomes", {}],
        ["get_treasury", {}],
        ["get_pending", {}],
        ["get_period", { yyyymm: 202611 }],
      ]),
    );
    expect(new Set(rpc.sent.map((x) => x.body.id)).size).toBe(rpc.sent.length);
  });

  it("refuses unsupported methods, arguments, accounts and networks before sending anything", async () => {
    const rpc = new FakeRpc();
    const t = transportFor(rpc);
    const block = { height: "1", hash: HASH };
    const base = { network: "testnet", account: ACCOUNT, block };
    expect(await codeOf(t.view({ ...base, method: "get_secret", args: {} }))).toBe("unsupported");
    expect(await codeOf(t.view({ ...base, method: "get_control", args: { x: 1 } }))).toBe(
      "unsupported",
    );
    expect(await codeOf(t.view({ ...base, method: "get_period", args: { yyyymm: 202613 } }))).toBe(
      "unsupported",
    );
    expect(
      await codeOf(t.view({ ...base, method: "get_period", args: { yyyymm: 202611, x: 1 } })),
    ).toBe("unsupported");
    expect(
      await codeOf(t.view({ ...base, account: "Not An Account", method: "get_control", args: {} })),
    ).toBe("unsupported");
    expect(
      await codeOf(t.view({ ...base, network: "mainnet", method: "get_control", args: {} })),
    ).toBe("unsupported");
    expect(await codeOf(t.finalBlock("mainnet"))).toBe("unsupported");
    expect(await codeOf(readSnapshot(t, { ...binding, network: "mainnet" }))).toBe("unsupported");
    expect(rpc.sent).toHaveLength(0);
  });

  it("refuses unsound configuration: mainnet, plain http, credentials, queries, bad limits", () => {
    const good = { network: "testnet", endpoint: "https://rpc.testnet.example.invalid" };
    expect(() => validateRpcConfig(good)).not.toThrow();
    for (const bad of [
      { ...good, network: "mainnet" },
      { ...good, endpoint: "http://rpc.testnet.example.invalid" },
      { ...good, endpoint: "https://user:pass@rpc.testnet.example.invalid" },
      { ...good, endpoint: "https://rpc.testnet.example.invalid/?key=1" },
      { ...good, endpoint: "https://rpc.mainnet.example.invalid" },
      { ...good, endpoint: "not a url" },
      { ...good, maxConcurrent: 0 },
      { ...good, maxResponseBytes: 1.5 },
    ])
      expect(() => validateRpcConfig(bad)).toThrow(/^v3 rpc: /);
  });

  it("rejects heights that aren't exact, never rounding them", async () => {
    for (const h of ["9007199254740993", "-1", '"187310138"', "1.5"]) {
      const rpc = new FakeRpc();
      rpc.respond = (req) =>
        new Response(
          `{"jsonrpc":"2.0","id":${JSON.stringify(req.id)},"result":{"header":{"height":${h},"hash":"${HASH}"}}}`,
          { status: 200 },
        );
      expect(await codeOf(transportFor(rpc).finalBlock("testnet")), h).toBe("malformed");
    }
  });

  it("maps HTTP and documented RPC errors to truthful codes", async () => {
    const cases: [(id: unknown) => Response, string][] = [
      [() => new Response("oops", { status: 500 }), "unavailable"],
      [() => new Response("busy", { status: 503 }), "unavailable"],
      [
        () => new Response("", { status: 307, headers: { location: "https://elsewhere.invalid" } }),
        "unavailable",
      ],
      ...(["UNKNOWN_BLOCK", "GARBAGE_COLLECTED_BLOCK"].map((name) => [
        (id: unknown) => err(id, name),
        "block_unavailable",
      ]) as [(id: unknown) => Response, string][]),
      [(id) => err(id, "UNKNOWN_ACCOUNT"), "unknown_account"],
      [(id) => err(id, "NOT_SYNCED_YET"), "unavailable"],
      [(id) => err(id, "PARSE_ERROR"), "rpc_error"],
      [
        (id) =>
          ok(id, {
            error: "wasm execution failed with error: MethodResolveError(MethodNotFound)",
            logs: [],
            block_height: HEIGHT,
            block_hash: HASH,
          }),
        "execution_failed",
      ],
    ];
    for (const [answer, code] of cases) {
      const rpc = new FakeRpc();
      rpc.respond = (req) => (req.method === "block" ? rpc.serve(req) : answer(req.id));
      expect(await codeOf(readSnapshot(transportFor(rpc), binding)), code).toBe(code);
    }
  });

  it("refuses malformed result bytes, invalid UTF-8 and non-JSON text", async () => {
    const results: unknown[] = [
      [256],
      [-1],
      [1.5],
      ["a"],
      [0xff, 0xfe],
      "not bytes",
      [...Buffer.from("{")],
    ];
    for (const result of results) {
      const rpc = new FakeRpc();
      rpc.respond = (req) =>
        req.method === "block"
          ? rpc.serve(req)
          : ok(req.id, { result, logs: [], block_height: HEIGHT, block_hash: HASH });
      expect(await codeOf(readSnapshot(transportFor(rpc), binding)), JSON.stringify(result)).toBe(
        "malformed",
      );
    }
  });

  it("refuses an answer to another request, a bad envelope, and answers from another block", async () => {
    const envelopes: ((id: unknown) => string)[] = [
      // A valid block answer, but to another request: only the id check can refuse it.
      () =>
        JSON.stringify({
          jsonrpc: "2.0",
          id: "someone-else",
          result: { header: { height: HEIGHT, hash: HASH } },
        }),
      (id) => JSON.stringify({ id, result: {} }),
      (id) => JSON.stringify({ jsonrpc: "2.0", id, result: {}, error: {} }),
      (id) => JSON.stringify({ jsonrpc: "2.0", id }),
      () => "[]",
      () => "not json",
    ];
    for (const env of envelopes) {
      const rpc = new FakeRpc();
      rpc.respond = (req) => new Response(env(req.id), { status: 200 });
      expect(await codeOf(transportFor(rpc).finalBlock("testnet"))).toBe("malformed");
    }
    const rpc = new FakeRpc();
    rpc.respond = (req) => {
      const r = rpc.serve(req);
      if (req.method !== "query" || req.params.method_name !== "get_treasury") return r;
      return r.json().then((j: Json) => ok(req.id, { ...j.result, block_hash: OTHER }));
    };
    expect(await codeOf(readSnapshot(transportFor(rpc), binding))).toBe("mixed_blocks");
  });
});

describe("003i resources are bounded, and cancellation is real", () => {
  it("an oversized chunked body without Content-Length is cut off and cancelled", async () => {
    let cancelled = false;
    let pulled = 0;
    const rpc = new FakeRpc();
    rpc.respond = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(c) {
            pulled++;
            // Safety bound for the test itself: if the cap were broken, the stream ends after
            // 4 MiB and the test fails on the result instead of exhausting memory.
            if (pulled > 64) c.close();
            else c.enqueue(new Uint8Array(64 * 1024).fill(32));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 200 },
      );
    expect(
      await codeOf(transportFor(rpc, { maxResponseBytes: 256 * 1024 }).finalBlock("testnet")),
    ).toBe("too_large");
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(10);
    // A declared length over the cap is refused before reading.
    const declared = new FakeRpc();
    declared.respond = () =>
      new Response("{}", { status: 200, headers: { "content-length": String(10 * 1024 * 1024) } });
    expect(await codeOf(transportFor(declared).finalBlock("testnet"))).toBe("too_large");
  });

  it("a stalled fetch is aborted when the snapshot's time is up", async () => {
    const rpc = new FakeRpc();
    rpc.hold = new Promise(() => {}); // never answers on its own
    const started = Date.now();
    expect(await codeOf(readSnapshot(transportFor(rpc), binding, { timeoutMs: 30 }))).toBe(
      "timeout",
    );
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(rpc.aborted).toBe(1); // the request's own signal was aborted, not just abandoned
    expect(rpc.inFlight).toBe(0);
  });

  it("a stalled body is aborted and its stream cancelled", async () => {
    let cancelled = false;
    const rpc = new FakeRpc();
    rpc.respond = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new TextEncoder().encode('{"jsonrpc":'));
          },
          pull() {
            return new Promise(() => {}); // the rest never arrives
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 200 },
      );
    expect(await codeOf(readSnapshot(transportFor(rpc), binding, { timeoutMs: 30 }))).toBe(
      "timeout",
    );
    expect(cancelled).toBe(true);
  });

  it("each request also has its own deadline", async () => {
    const rpc = new FakeRpc();
    rpc.hold = new Promise(() => {});
    expect(await codeOf(transportFor(rpc, { requestTimeoutMs: 20 }).finalBlock("testnet"))).toBe(
      "timeout",
    );
  });

  it("at most maxConcurrent requests are in flight; waiting ones are released on abort", async () => {
    const rpc = new FakeRpc();
    let release: () => void = () => {};
    rpc.hold = new Promise<void>((r) => {
      release = r;
    });
    const t = transportFor(rpc, { maxConcurrent: 2 });
    const block = await (async () => {
      const h = rpc.hold;
      rpc.hold = null;
      const b = await t.finalBlock("testnet");
      rpc.hold = h;
      return b;
    })();
    const calls = ["get_control", "get_outcomes", "get_treasury", "get_pending"].map((method) =>
      t.view({ network: "testnet", account: ACCOUNT, method, args: {}, block }),
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(rpc.inFlight).toBe(2);
    release();
    await Promise.all(calls);
    expect(rpc.maxInFlight).toBe(2);
    // Queued requests honour an abort too.
    const stuck = new FakeRpc();
    stuck.hold = new Promise(() => {});
    const t2 = transportFor(stuck, { maxConcurrent: 1 });
    expect(await codeOf(readSnapshot(t2, binding, { timeoutMs: 30 }))).toBe("timeout");
    expect(stuck.sent).toHaveLength(1);
  });
});

// ---------- through the real API ----------

function world(opts: { dbPath?: string; transport?: ViewTransport | null } = {}) {
  const store = new Store(openDb(opts.dbPath ?? ":memory:"));
  const { person: mara, token } = store.createPerson("Mara Solis");
  const { person: ana } = store.createPerson("Ana Ruiz");
  const bid = store.tx(() =>
    store.insertBusiness(mara, "started", "Ledgerline Labs", "software"),
  ).businessId;
  const rpc = new FakeRpc();
  const transport = opts.transport === undefined ? transportFor(rpc) : opts.transport;
  const app = everstreetApi(store, {
    localPreview: true,
    environment: "test",
    v3: { transport, bindings: [{ business_id: bid, network: "testnet", account: ACCOUNT }] },
  });
  const m = async (path: string, method = "GET", body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { cookie: `es_session=${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : {}) as Json, text };
  };
  const transfer = (to: string) => {
    store.db.prepare("UPDATE businesses SET owner_id = ? WHERE id = ?").run(to, bid);
    store.db
      .prepare(
        "INSERT INTO ownership (business_id, from_id, to_id, generation, at) VALUES (?, ?, ?, 2, ?)",
      )
      .run(bid, mara.id, to, new Date().toISOString());
  };
  const count = (t: string) =>
    (store.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  return { store, app, rpc, bid, m, mara, ana, transfer, count };
}

describe("003i the adapter feeds the existing observation service", () => {
  it("a Gated snapshot over synthetic HTTP is recorded and shown with honest identity labels", async () => {
    const w = world();
    w.rpc.views = { ...CLOSING };
    const r = await w.m(`/api/businesses/${w.bid}/v3/refresh`, "POST", { period: 202611 });
    expect(r.body).toMatchObject({ outcome: "accepted", period: { outcome: "accepted" } });
    const v = (await w.m(`/api/businesses/${w.bid}/v3`)).body;
    expect(v.control).toMatchObject({ close_mode: "gated", closer: "closer.near" });
    expect(v.block).toEqual({ height: String(HEIGHT), hash: HASH });
    expect(v.network_identity).toMatch(/isn't verified/);
    expect(v.provenance).toMatch(/not independently verified/);
  });

  it("endpoint, RPC and contract text never reach responses or audit events", async () => {
    const w = world();
    w.rpc.respond = (req) =>
      req.method === "block"
        ? new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: req.id,
              error: {
                name: "HANDLER_ERROR",
                cause: { name: "INTERNAL_ERROR", info: { error_message: "key=hunter2 at node-7" } },
                message: "hunter2",
                data: "hunter2",
              },
            }),
            { status: 200 },
          )
        : ok(req.id, {
            error: "panicked: hunter2",
            logs: ["hunter2"],
            block_height: HEIGHT,
            block_hash: HASH,
          });
    const r = await w.m(`/api/businesses/${w.bid}/v3/refresh`, "POST");
    expect(r.body).toMatchObject({ outcome: "refused", code: "rpc_error" });
    const events = JSON.stringify(w.store.db.prepare("SELECT * FROM events").all());
    for (const text of [r.text, events]) {
      expect(text).not.toMatch(/hunter2|secret-path-token|example\.invalid|node-7/);
    }
  });

  it("ownership lost while the transport is awaited: refused, nothing recorded", async () => {
    const w = world();
    let release: () => void = () => {};
    w.rpc.hold = new Promise<void>((r) => {
      release = r;
    });
    const pending = w.m(`/api/businesses/${w.bid}/v3/refresh`, "POST");
    await new Promise((r) => setTimeout(r, 10));
    w.transfer(w.ana.id);
    release();
    expect((await pending).status).toBe(404);
    expect(w.count("v3_observations")).toBe(0);
  });

  it("with no transport configured, observations stay plainly unavailable", async () => {
    const w = world({ transport: null });
    expect((await w.m(`/api/businesses/${w.bid}/v3/refresh`, "POST")).body).toMatchObject({
      outcome: "refused",
      code: "unavailable",
    });
    expect((await w.m(`/api/businesses/${w.bid}/v3`)).body).toMatchObject({
      state: "never_observed",
      transport: "unavailable",
    });
  });
});

// ---------- the 003h observation-format upgrade ----------

/** Writes observations exactly as 003h stored them: the month inside, digest over all of it. */
async function oldRows(
  store: Store,
  businessId: string,
  rows: { height: number; hash: string; period: number | null; at: string }[],
) {
  for (const r of rows) {
    const rpc = new FakeRpc();
    rpc.respond = (req) =>
      req.method === "block"
        ? ok(req.id, { header: { height: r.height, hash: r.hash } })
        : rpc
            .serve(req)
            .json()
            .then((j: Json) =>
              ok(req.id, { ...j.result, block_height: r.height, block_hash: r.hash }),
            );
    const s = await readSnapshot(
      transportFor(rpc),
      { ...binding, business_id: businessId },
      {
        period: r.period ?? undefined,
      },
    );
    const digest = createHash("sha256").update(JSON.stringify(s)).digest("hex"); // the 003h digest
    const id = Number(
      store.db
        .prepare(
          "INSERT INTO v3_observations (business_id, network, account, schema, block_height, block_hash, control_seq, generation, owner, snapshot, digest, observed_at) VALUES (?, 'testnet', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          businessId,
          ACCOUNT,
          s.source.schema,
          String(r.height),
          r.hash,
          s.control.control_seq,
          s.control.generation,
          s.control.owner,
          JSON.stringify(s),
          digest,
          r.at,
        ).lastInsertRowid,
    );
    store.db
      .prepare(
        `INSERT INTO v3_projection (business_id, network, account, schema, observation_id, high_block_height, high_block_hash, high_control_seq, flag, flag_detail, updated_at)
         VALUES (?, 'testnet', ?, ?, ?, ?, ?, ?, 'conflict', 'height 1', ?)
         ON CONFLICT(business_id) DO UPDATE SET observation_id = excluded.observation_id,
           high_block_height = excluded.high_block_height, high_block_hash = excluded.high_block_hash`,
      )
      .run(
        businessId,
        ACCOUNT,
        s.source.schema,
        id,
        String(r.height),
        r.hash,
        s.control.control_seq,
        r.at,
      );
  }
}

const HASH_A = "AAbcdefghijkmnopqrstuvwxyz123456789ABCDEFGH";
const HASH_B = "BBbcdefghijkmnopqrstuvwxyz123456789ABCDEFGH";

describe("003i 003h-era observations are upgraded in place", () => {
  it("moves each month out with its own block and time, recomputes core digests, keeps flags; a replay is a duplicate", async () => {
    const path = join(here, `v3-upgrade-${process.pid}-${Date.now()}.db`);
    const opened: Store[] = [];
    try {
      const store = new Store(openDb(path));
      opened.push(store);
      const { person: mara, token } = store.createPerson("Mara Solis");
      const bid = store.tx(() =>
        store.insertBusiness(mara, "started", "Ledgerline Labs", "software"),
      ).businessId;
      store.db.prepare("DELETE FROM v3_meta").run(); // a database from before the format was recorded
      await oldRows(store, bid, [
        { height: 1000, hash: HASH_A, period: 202611, at: "2026-11-03T09:00:00.000Z" },
        { height: 1001, hash: HASH_B, period: null, at: "2026-11-03T09:05:00.000Z" },
      ]);
      const before = store.db.prepare("SELECT * FROM v3_projection").get() as Json;
      expect(upgradeObservationFormat(store.db)).toEqual({ upgraded: 2, months: 1 });
      const rows = store.db.prepare("SELECT * FROM v3_observations ORDER BY id").all() as Json[];
      for (const r of rows) {
        const snap = JSON.parse(r.snapshot);
        expect(snap.period).toBeUndefined();
        expect(r.digest).toBe(coreDigest(snap));
      }
      expect(
        store.db
          .prepare("SELECT yyyymm, block_height, block_hash, observed_at FROM v3_periods")
          .all(),
      ).toEqual([
        {
          yyyymm: 202611,
          block_height: "1000",
          block_hash: HASH_A,
          observed_at: "2026-11-03T09:00:00.000Z",
        },
      ]);
      const after = store.db.prepare("SELECT * FROM v3_projection").get() as Json;
      expect(after).toEqual(before); // high-water, source and the genuine flag untouched
      // Again, and after a restart: nothing more happens.
      expect(upgradeObservationFormat(store.db)).toEqual({ upgraded: 0, months: 0 });
      store.db.close();
      opened.length = 0;
      const reopened = new Store(openDb(path));
      opened.push(reopened);
      expect(
        (
          reopened.db
            .prepare("SELECT value FROM v3_meta WHERE key = 'observation_format'")
            .get() as Json
        ).value,
      ).toBe(OBSERVATION_FORMAT);
      // Replaying the same block (with its month) is a duplicate, not a false conflict.
      const rpc = new FakeRpc();
      rpc.respond = (req) =>
        req.method === "block"
          ? ok(req.id, { header: { height: 1000, hash: HASH_A } })
          : rpc
              .serve(req)
              .json()
              .then((j: Json) =>
                ok(req.id, { ...j.result, block_height: 1000, block_hash: HASH_A }),
              );
      const app = everstreetApi(reopened, {
        localPreview: true,
        environment: "test",
        v3: {
          transport: transportFor(rpc),
          bindings: [{ business_id: bid, network: "testnet", account: ACCOUNT }],
        },
      });
      const res = await app.request(`/api/businesses/${bid}/v3/refresh`, {
        method: "POST",
        headers: { cookie: `es_session=${token}`, "content-type": "application/json" },
        body: JSON.stringify({ period: 202611 }),
      });
      const body = (await res.json()) as Json;
      // Block 1000's hash is already recorded and its recomputed digest matches: a duplicate,
      // for the core and its month, never a conflict.
      expect(body).toMatchObject({ outcome: "duplicate", period: { outcome: "duplicate" } });
      const v = (body.view ?? {}) as Json;
      expect(v.flag).toMatchObject({ code: "conflict", detail: "height 1" }); // the old genuine flag
      expect(v.block.height).toBe("1001"); // the high-water observation is still the one shown
    } finally {
      for (const s of opened) {
        try {
          s.db.close();
        } catch {}
      }
      for (const s of ["", "-wal", "-shm"]) rmSync(`${path}${s}`, { force: true });
    }
  });

  it("an exact replay at the high-water block is a duplicate after the upgrade", async () => {
    const store = new Store(openDb(":memory:"));
    const { person: mara, token } = store.createPerson("Mara Solis");
    const bid = store.tx(() =>
      store.insertBusiness(mara, "started", "Ledgerline Labs", "software"),
    ).businessId;
    store.db.prepare("DELETE FROM v3_meta").run();
    await oldRows(store, bid, [
      { height: 1000, hash: HASH_A, period: 202611, at: "2026-11-03T09:00:00.000Z" },
    ]);
    store.db.prepare("UPDATE v3_projection SET flag = NULL, flag_detail = NULL").run();
    const rpc = new FakeRpc();
    rpc.respond = (req) =>
      req.method === "block"
        ? ok(req.id, { header: { height: 1000, hash: HASH_A } })
        : rpc
            .serve(req)
            .json()
            .then((j: Json) => ok(req.id, { ...j.result, block_height: 1000, block_hash: HASH_A }));
    // Constructing the app runs the upgrade.
    const app = everstreetApi(store, {
      localPreview: true,
      environment: "test",
      v3: {
        transport: transportFor(rpc),
        bindings: [{ business_id: bid, network: "testnet", account: ACCOUNT }],
      },
    });
    for (const period of [undefined, 202611]) {
      const res = await app.request(`/api/businesses/${bid}/v3/refresh`, {
        method: "POST",
        headers: { cookie: `es_session=${token}`, "content-type": "application/json" },
        body: JSON.stringify(period ? { period } : {}),
      });
      const body = (await res.json()) as Json;
      expect(body.outcome).toBe("duplicate");
      if (period) expect(body.period.outcome).toBe("duplicate");
      expect(body.view.flag).toBeNull();
    }
  });

  it("a malformed stored row stops the upgrade with nothing changed, and pauses only this capability", async () => {
    const store = new Store(openDb(":memory:"));
    const { person: mara, token } = store.createPerson("Mara Solis");
    const bid = store.tx(() =>
      store.insertBusiness(mara, "started", "Ledgerline Labs", "software"),
    ).businessId;
    store.db.prepare("DELETE FROM v3_meta").run();
    await oldRows(store, bid, [
      { height: 1000, hash: HASH_A, period: 202611, at: "2026-11-03T09:00:00.000Z" },
      { height: 1001, hash: HASH_B, period: 202610, at: "2026-11-03T09:05:00.000Z" },
    ]);
    // Corrupt the second row: its stored block no longer matches its own columns.
    store.db
      .prepare("UPDATE v3_observations SET block_height = '999' WHERE block_hash = ?")
      .run(HASH_B);
    const snapshotBefore = store.db
      .prepare("SELECT snapshot, digest FROM v3_observations ORDER BY id")
      .all();
    expect(() => upgradeObservationFormat(store.db)).toThrow(
      /is malformed \(block differs from its row\); nothing was changed/,
    );
    expect(
      store.db.prepare("SELECT snapshot, digest FROM v3_observations ORDER BY id").all(),
    ).toEqual(snapshotBefore);
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM v3_periods").get()).toEqual({ n: 0 });
    expect(store.db.prepare("SELECT * FROM v3_meta").all()).toEqual([]);
    // The app still starts; the v3 capability says it is paused, the rest works.
    const svc = new V3Observations(store.db, store, { transport: null, bindings: [] });
    expect(svc.upgradeError).toMatch(/malformed/);
    const app = everstreetApi(store, {
      localPreview: true,
      environment: "test",
      v3: {
        transport: null,
        bindings: [{ business_id: bid, network: "testnet", account: ACCOUNT }],
      },
    });
    const get = async (p: string, method = "GET") => {
      const res = await app.request(p, { method, headers: { cookie: `es_session=${token}` } });
      return { status: res.status, body: (await res.json()) as Json };
    };
    expect((await get(`/api/businesses/${bid}/v3`)).body).toMatchObject({
      state: "paused",
      code: "format_upgrade_failed",
    });
    expect((await get(`/api/businesses/${bid}/v3/refresh`, "POST")).body).toMatchObject({
      outcome: "refused",
      code: "format_upgrade_failed",
    });
    expect((await get("/api/product-projects")).status).toBe(200);
  });
});
