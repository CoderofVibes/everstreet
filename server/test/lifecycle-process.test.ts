// Job 003wf1 (APPLICATION_COMPOSITION §12.6): the configured lifecycle in ACTUAL child processes.
// Each child runs the normal entry logic (serve.ts) over the production composition, with only its
// RPC and model transports answered by this process over IPC (lifecycleWorld.ts): the real
// customer routes, CustomerUses, TestnetCustomerWriter, TestnetCustomerRpcTransport,
// AnthropicRuntime, ManagedRuntime, protected storage and MaintenanceSupervisor. Disposable
// files, ephemeral keys, fictional accounts; small heap, deadlines and exact child cleanup.

import { type ChildProcess, fork } from "node:child_process";
import { sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { nep413Digest } from "../src/identity.ts";
import { CUSTOMER, type Json } from "./customer-world.ts";
import {
  API_KEY_ENV,
  bootstrap,
  FICTIONAL_KEY,
  type SyntheticModel,
  type SyntheticRpc,
} from "./lifecycleWorld.ts";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "lifecycle-proc-"));
  cleanups.push(() => rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return d;
};
const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
const until = async (cond: () => boolean | Promise<boolean>, what: string, ms = 20_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
};

const MAINT = {
  interval_ms: 1_000,
  batch: 5,
  pass_budget_ms: 3_000,
  op_deadline_ms: 2_000,
  stop_timeout_ms: 5_000,
};

/** One child process of the normal entry; this process answers its network over IPC. */
function child(configFile: string, rpc: SyntheticRpc, model: SyntheticModel) {
  const proc: ChildProcess = fork(join("server", "test", "entryChild.ts"), [configFile], {
    execArgv: ["--import", "tsx", "--max-old-space-size=256"],
    env: { ...process.env, [API_KEY_ENV]: FICTIONAL_KEY },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let out = "";
  proc.stdout?.on("data", (d) => (out += d));
  proc.stderr?.on("data", (d) => (out += d));
  proc.on(
    "message",
    (m: { type?: string; channel?: string; id?: number; url?: string; body?: string }) => {
      if (m?.type !== "fetch") return;
      void (async () => {
        const r =
          m.channel === "rpc"
            ? { status: 200, body: await rpc.answer(String(m.body)) }
            : await model.answer(String(m.url), JSON.parse(String(m.body || "{}")));
        // A child that stopped or was killed meanwhile never gets it (a late answer goes nowhere).
        if (proc.connected) proc.send({ type: "reply", id: m.id, ...r });
      })().catch(() => {});
    },
  );
  const exited = new Promise<number | null>((r) => proc.once("exit", (code) => r(code)));
  const deadline = setTimeout(() => proc.kill("SIGKILL"), 90_000);
  cleanups.push(async () => {
    clearTimeout(deadline);
    if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
    await exited;
  });
  return {
    proc,
    exited,
    out: () => out,
    ready: () => until(() => out.includes("listening on"), "the child listening", 30_000),
    shutdown: () => {
      if (proc.connected) proc.send({ type: "shutdown" });
      return exited;
    },
  };
}

/** One browser on the child's port: its own cookie jar. */
function browser(port: number) {
  const jar = new Map<string, string>();
  return async (path: string, method = "GET", body?: unknown) => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const set of res.headers.getSetCookie()) {
      const [pair, ...attrs] = set.split(";");
      const [name, ...rest] = (pair as string).split("=");
      const value = rest.join("=");
      if (!value || attrs.some((x) => /^max-age=0$/i.test(x.trim()))) jar.delete(name as string);
      else jar.set(name as string, value);
    }
    return { status: res.status, body: (await res.json().catch(() => null)) as Json };
  };
}

/** Cara signs in with her (ephemeral, fictional) full-access key through the real NEP-413 path. */
async function signIn(call: ReturnType<typeof browser>, key: { id: string; privateKey: never }) {
  const ch = (await call("/api/session/challenge", "POST")).body.challenge as Json;
  const digest = nep413Digest({
    message: ch.message,
    nonce: Buffer.from(ch.nonce, "base64"),
    recipient: ch.recipient,
  });
  const r = await call("/api/session/verify", "POST", {
    account_id: CUSTOMER,
    public_key: key.id,
    signature: sign(null, digest, key.privateKey).toString("base64"),
    nonce: ch.nonce,
  });
  if (r.status !== 200 && r.status !== 201)
    throw new Error(`sign-in ${r.status} ${JSON.stringify(r.body)}`);
}

const INVOICE =
  "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD";

async function installation(maintenance = MAINT) {
  const dir = tempDir();
  const port = await freePort();
  const b = await bootstrap(dir, port, maintenance);
  const dbRead = <T>(sql: string, ...args: (string | number)[]) => {
    const db = openDb(b.db);
    try {
      return db.prepare(sql).all(...args) as T[];
    } finally {
      db.close();
    }
  };
  /** Prepare, confirm (the writer opens the hold) and execute one use as Cara. */
  const use = async (call: ReturnType<typeof browser>, key: string, input = INVOICE) => {
    const p = await call(`/api/customer/offers/${b.offer}/prepare`, "POST", {
      idempotency_key: key,
      input,
    });
    if (p.status !== 201) throw new Error(`prepare ${p.status} ${JSON.stringify(p.body)}`);
    const u = p.body.use as Json;
    const c = await call(`/api/customer/uses/${u.id}/confirm`, "POST", b.w.signed(u.envelope));
    if (c.body.use?.state !== "reserved")
      throw new Error(`confirm ${c.status} ${JSON.stringify(c.body)}`);
    return u.id as string;
  };
  return { ...b, dir, port, dbRead, use };
}

describe("003wf1 the normal entry in a child process: maintenance settles by itself", () => {
  it("a use is reserved by the real writer, run on the real runtime over the model seam, and settled by background maintenance", async () => {
    const t = await installation();
    const evaluations = t.model.calls.messages; // the release evaluation, in the bootstrap
    const a = child(t.configFile, t.rpc, t.model);
    await a.ready();
    const call = browser(t.port);
    const caps = (await call("/api/system/capabilities")).body;
    expect(caps.capabilities.find((c: Json) => c.key === "maintenance")).toMatchObject({
      state: "on",
    });
    expect(caps.capabilities.find((c: Json) => c.key === "model")).toMatchObject({
      state: "on",
      provenance: "synthetic model HTTP (lifecycle test)",
    });
    await signIn(call, t.cara as never);
    const id = await t.use(call, "lifecycle-use-0001");
    expect(t.rpc.applied.map((x) => x.method)).toEqual(["open_hold"]);
    const x = await call(`/api/customer/uses/${id}/execute`, "POST", {});
    expect(x.body.use?.execution?.fulfilled, JSON.stringify(x.body)).toBe(true);
    expect(t.model.calls.messages).toBe(evaluations + 1); // exactly one provider request
    // Background maintenance settles it: one settle_hold, one unit charged.
    await until(() => t.rpc.applied.some((x) => x.method === "settle_hold"), "settlement");
    expect(t.rpc.applied.filter((x) => x.method === "settle_hold")).toHaveLength(1);
    expect(t.rpc.chain.charged).toBe(1);
    await until(
      async () =>
        (await call("/api/system/capabilities")).body.maintenance_observed?.state === "running",
      "observed running",
    );
    expect(await a.shutdown()).toBe(0);
    // The production runtime's own accounting of that one request (haiku: 10/50 cents per M).
    const inv = t.dbRead<Json>(
      "SELECT state, outcome, usage_state, input_tokens, output_tokens, charged_microcents FROM runtime_invocations WHERE purpose = 'customer_use'",
    );
    expect(inv).toEqual([
      {
        state: "completed",
        outcome: "extracted",
        usage_state: "final",
        input_tokens: 900,
        output_tokens: 120,
        charged_microcents: 15_000,
      },
    ]);
    const st = t.dbRead<Json>("SELECT state, scheduled FROM maintenance_status")[0];
    expect(st).toEqual({ state: "stopped", scheduled: 0 });
  }, 120_000);
});

/** Settlement rows and what the chain double applied, for the duplicate checks. */
const settled = (t: Awaited<ReturnType<typeof installation>>) => ({
  settles: t.rpc.applied.filter((x) => x.method === "settle_hold").length,
  charged: t.rpc.chain.charged,
});

describe("003wf1 stop and restart around a settlement: never twice", () => {
  it("a graceful stop while the settlement is at the node: bounded exit, then a restart recovers it once", async () => {
    const t = await installation();
    const a = child(t.configFile, t.rpc, t.model);
    await a.ready();
    const call = browser(t.port);
    await signIn(call, t.cara as never);
    const id = await t.use(call, "lifecycle-use-0101");
    const held = t.rpc.holdNextSend(); // the settlement's send_tx waits at the node
    expect(
      (await call(`/api/customer/uses/${id}/execute`, "POST", {})).body.use.execution.fulfilled,
    ).toBe(true);
    await held.entered;
    const t0 = Date.now();
    expect(await a.shutdown()).toBe(0);
    // Bounded: the pass's own deadline and the stop budget, not the held answer.
    expect(Date.now() - t0).toBeLessThan(MAINT.stop_timeout_ms + 3_000);
    held.open(); // the node applies it now; its answer goes to a process that is gone
    await until(() => settled(t).settles === 1, "the node applying the held settlement");
    const b = child(t.configFile, t.rpc, t.model);
    await b.ready();
    // The restarted process finds the recorded attempt and resolves it by its exact transaction.
    await until(
      () =>
        t.dbRead<Json>("SELECT state FROM customer_settlements WHERE request_id = ?", id)[0]
          ?.state === "charged",
      "the settlement recorded as charged",
      // The stopped holder's per-settlement lease (30 s) fences the item until it expires.
      75_000,
    );
    expect(settled(t)).toEqual({ settles: 1, charged: 1 });
    expect(await b.shutdown()).toBe(0);
  }, 180_000);

  it("a forced kill while the settlement is at the node: a restart recovers it once", async () => {
    const t = await installation();
    const a = child(t.configFile, t.rpc, t.model);
    await a.ready();
    const call = browser(t.port);
    await signIn(call, t.cara as never);
    const id = await t.use(call, "lifecycle-use-0201");
    const held = t.rpc.holdNextSend();
    await call(`/api/customer/uses/${id}/execute`, "POST", {});
    await held.entered;
    a.proc.kill("SIGKILL");
    await a.exited;
    held.open();
    await until(() => settled(t).settles === 1, "the node applying it");
    const b = child(t.configFile, t.rpc, t.model);
    await b.ready();
    await until(
      () =>
        t.dbRead<Json>("SELECT state FROM customer_settlements WHERE request_id = ?", id)[0]
          ?.state === "charged",
      "recovered as charged",
      75_000,
    );
    expect(settled(t)).toEqual({ settles: 1, charged: 1 });
    expect(await b.shutdown()).toBe(0);
  }, 180_000);
});

describe("003wf1 the provider across a stop, and a provider error", () => {
  it("a provider answer held across a stop: the request ends 503, nothing is resent after restart, nothing is charged", async () => {
    const t = await installation();
    const a = child(t.configFile, t.rpc, t.model);
    await a.ready();
    const call = browser(t.port);
    await signIn(call, t.cara as never);
    const id = await t.use(call, "lifecycle-use-0301");
    const held = t.model.holdNextMessage();
    const executing = call(`/api/customer/uses/${id}/execute`, "POST", {});
    await held.entered;
    const sent = t.model.calls.messages;
    expect(await a.shutdown()).toBe(0);
    expect((await executing).status).toBe(503); // answered within the stop, not left hanging
    held.open(); // the provider answers late, to nobody
    const b = child(t.configFile, t.rpc, t.model);
    await b.ready();
    // Recovery marks the dispatched request unknown; it is never sent again.
    await until(
      () =>
        t.dbRead<Json>("SELECT state FROM runtime_invocations WHERE purpose = 'customer_use'")[0]
          ?.state === "unknown",
      "the dispatched request recorded unknown",
    );
    await new Promise((r) => setTimeout(r, 2 * MAINT.interval_ms + 500)); // two passes
    expect(t.model.calls.messages).toBe(sent);
    expect(t.rpc.chain.charged).toBe(0);
    expect(await b.shutdown()).toBe(0);
  }, 120_000);

  it("a provider error through the real adapter: no result, no charge, the unit comes back by maintenance", async () => {
    const t = await installation();
    const a = child(t.configFile, t.rpc, t.model);
    await a.ready();
    const call = browser(t.port);
    await signIn(call, t.cara as never);
    const id = await t.use(call, "lifecycle-use-0401");
    t.model.failNext = 529;
    const x = await call(`/api/customer/uses/${id}/execute`, "POST", {});
    expect(x.body.use?.execution?.fulfilled).not.toBe(true);
    const inv = t.dbRead<Json>(
      "SELECT state, failure_class, charged_microcents FROM runtime_invocations WHERE purpose = 'customer_use'",
    )[0];
    // The production runtime: a non-200 after dispatch leaves usage uncertain, so the request is
    // unknown (never "failed and free"), with no charge recorded, no result and no delivery.
    expect(inv).toEqual({
      state: "unknown",
      failure_class: "provider_error",
      charged_microcents: 0,
    });
    expect(x.body.use.execution).toMatchObject({
      delivered: false,
      fulfilled: false,
      settlement_eligible: false,
    });
    // Not fulfilled: background maintenance returns the unit (a release, never a charge).
    await until(
      () =>
        t.dbRead<Json>("SELECT kind, state FROM customer_settlements WHERE request_id = ?", id)[0]
          ?.state === "returned",
      "the unit returned",
      60_000,
    );
    expect(
      t.dbRead<Json>("SELECT kind FROM customer_settlements WHERE request_id = ?", id)[0]?.kind,
    ).toBe("release");
    expect(t.rpc.chain.released).toBe(1);
    expect(t.rpc.chain.charged).toBe(0);
    expect(await a.shutdown()).toBe(0);
  }, 120_000);
});

describe("003wf1 two processes on one database, and a listen failure", () => {
  it("one holder works; when it stops, the other takes over through the durable lease", async () => {
    const t = await installation();
    const a = child(t.configFile, t.rpc, t.model);
    await a.ready();
    await until(
      () => t.dbRead<Json>("SELECT holder FROM maintenance_status").length === 1,
      "A's pass",
    );
    const first = t.dbRead<Json>("SELECT holder, gen FROM maintenance_lease")[0] as Json;
    // B on another port, same database and storage.
    const port2 = await freePort();
    const cfg2 = join(t.dir, "config-b.json");
    writeFileSync(
      cfg2,
      JSON.stringify({ ...t.config, listen: { host: "127.0.0.1", port: port2 } }),
    );
    const b = child(cfg2, t.rpc, t.model);
    await b.ready();
    await new Promise((r) => setTimeout(r, 2 * MAINT.interval_ms + 300));
    // B is standby: the lease and the recorded passes are still A's.
    expect(t.dbRead<Json>("SELECT holder, gen FROM maintenance_lease")[0]).toEqual(first);
    expect(t.dbRead<Json>("SELECT holder FROM maintenance_status")[0]?.holder).toBe(first.holder);
    expect(await a.shutdown()).toBe(0); // releases the lease
    await until(() => {
      const l = t.dbRead<Json>("SELECT holder, gen FROM maintenance_lease")[0] as Json;
      return l.holder !== first.holder && l.gen === first.gen + 1;
    }, "B taking over");
    const st = t.dbRead<Json>("SELECT holder, state FROM maintenance_status")[0] as Json;
    expect(st.holder).not.toBe(first.holder);
    expect(st.state).toBe("running");
    expect(await b.shutdown()).toBe(0);
  }, 120_000);

  it("a listen failure exits 1 with nothing started (no maintenance pass, no lease)", async () => {
    const t = await installation();
    const busy = createServer();
    await new Promise<void>((r) => busy.listen(t.port, "127.0.0.1", () => r()));
    cleanups.push(() => new Promise<void>((r) => busy.close(() => r())));
    const a = child(t.configFile, t.rpc, t.model);
    expect(await a.exited).toBe(1);
    expect(a.out()).toMatch(/listen failed: EADDRINUSE/);
    expect(t.dbRead<Json>("SELECT * FROM maintenance_lease")).toEqual([]);
    expect(t.dbRead<Json>("SELECT * FROM maintenance_status")).toEqual([]);
  }, 60_000);
});
