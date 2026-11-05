// Job 003wf2: Direct sale wallet actions in ACTUAL child processes running the normal entry
// (serve.ts) over the production composition (lifecycleWorld.ts bootstrap): the real sale routes,
// SaleActions, V3Intents and TestnetCustomerRpcTransport, with only the RPC answered by this process
// over IPC from the one synthetic customer+sale state. The synthetic wallet applies the exact stored
// call to that state. Disposable files, ephemeral keys, fictional accounts; bounded children.

import { type ChildProcess, fork } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import type { Json } from "./customer-world.ts";
import {
  API_KEY_ENV,
  bootstrap,
  FICTIONAL_KEY,
  FOUNDER,
  type SyntheticModel,
  type SyntheticRpc,
  signInAs,
} from "./lifecycleWorld.ts";

const BUYER = "noah-buyer.near";
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
const until = async (cond: () => boolean, what: string, ms = 30_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
};

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
    ready: () =>
      until(() => out.includes("listening on"), "the child listening").catch((e) => {
        throw new Error(`${(e as Error).message}: ${out.slice(-600)}`);
      }),
  };
}

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

/** A configured installation with the sale half attached and the buyer's account linked. */
async function installation() {
  const dir = mkdtempSync(join(tmpdir(), "sale-proc-"));
  cleanups.push(() =>
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  );
  const port = await freePort();
  const b = await bootstrap(dir, port, {
    interval_ms: 60_000,
    batch: 5,
    pass_budget_ms: 3_000,
    op_deadline_ms: 2_000,
    stop_timeout_ms: 5_000,
  });
  b.w.chain.attachSale({ owner: FOUNDER });
  const db = openDb(b.db);
  try {
    const t = new Date().toISOString();
    db.prepare(
      "INSERT INTO chain_accounts (owner_kind, owner_id, account_id, secret, tx, created_at) VALUES ('person', ?, ?, NULL, 'fixture', ?)",
    ).run(b.w.f.ava.id, FOUNDER, t);
    db.prepare(
      "INSERT INTO people (id, display_name, created_at) VALUES ('person-noah', 'Noah Brandt', ?)",
    ).run(t);
    db.prepare(
      "INSERT INTO chain_accounts (owner_kind, owner_id, account_id, secret, tx, created_at) VALUES ('person', 'person-noah', ?, NULL, 'fixture', ?)",
    ).run(BUYER, t);
  } finally {
    db.close();
  }
  /** The same installation on another port (a second process over the same database). */
  const second = async () => {
    const p2 = await freePort();
    const file = join(dir, "config-2.json");
    writeFileSync(
      file,
      JSON.stringify({
        ...JSON.parse(readFileSync(b.configFile, "utf8")),
        listen: { host: "127.0.0.1", port: p2 },
      }),
    );
    return { file, port: p2 };
  };
  const proposal = {
    buyer_account: BUYER,
    price: "250000000",
    expires_in_days: 7,
    available_floor: "0",
    grants: [],
    exclusions: [],
    note: "",
  };
  return { ...b, dir, port, second, proposal, biz: b.w.f.business };
}

describe("003wf2 sale actions in actual processes", () => {
  it("a request asked before a forced kill: after restart it is recovered by its original transaction; nothing is resent", async () => {
    const b = await installation();
    const a = child(b.configFile, b.rpc, b.model);
    await a.ready();
    const call = browser(b.port);
    await signInAs(call, FOUNDER, b.ava);
    const s0 = await call(`/api/sales/${b.biz}`);
    expect([s0.status, s0.body.roles?.seller]).toEqual([200, true]);
    const p = await call(`/api/sales/${b.biz}/prepare`, "POST", {
      kind: "propose",
      input: b.proposal,
    });
    expect(p.status).toBe(200);
    const c = await call(`/api/sales/${b.biz}/actions`, "POST", {
      kind: "propose",
      input: p.body.input,
      action_digest: p.body.action_digest,
      idempotency_key: "proc-propose-0001",
    });
    expect(c.status).toBe(201);
    const id = c.body.action.id as string;
    expect((await call(`/api/sales/actions/${id}/requested`, "POST", {})).body.ask).toBe("granted");
    // The wallet sends exactly the stored call; the process dies before its answer is recorded.
    const sale = b.w.chain.sale as NonNullable<typeof b.w.chain.sale>;
    const out = b.w.chain.walletCall(FOUNDER, c.body.action.call);
    expect(sale.dealSeq).toBe(1n);
    a.proc.kill("SIGKILL");
    await a.exited;

    // The restarted process (same database): the request is open and asked; it is never sent again.
    const r = child(b.configFile, b.rpc, b.model);
    await r.ready();
    const s1 = await call(`/api/sales/${b.biz}`);
    expect(s1.status).toBe(200);
    expect(s1.body.open.map((x: Json) => [x.id, x.state])).toEqual([[id, "requested"]]);
    expect((await call(`/api/sales/actions/${id}/requested`, "POST", {})).body.ask).toBe(
      "already_asked",
    );
    const c1 = await call(`/api/sales/actions/${id}/check`, "POST", {});
    expect(c1.body.resolution.kind).toBe("no_longer_possible");
    const c2 = await call(`/api/sales/actions/${id}/check`, "POST", {
      tx_hash: out.transaction.hash,
    });
    expect(c2.body.resolution).toMatchObject({ kind: "confirmed", result: "proposed" });
    expect(c2.body.effects).toMatchObject({ recorded: { deal_seq: "1", version: 1 } });
    expect(sale.dealSeq).toBe(1n);
    const proposals = [...b.w.chain.txs.values()].filter(
      (t) => (t as Json).transaction.actions[0].FunctionCall.method_name === "propose_sale_guarded",
    );
    expect(proposals).toHaveLength(1);
  }, 120_000);

  it("two processes over one database: one request admitted, one wallet ask granted", async () => {
    const b = await installation();
    const two = await b.second();
    // The second process starts once the first is listening (two composing at the same instant
    // contend on startup migrations: recorded in the report, outside this job).
    const a = child(b.configFile, b.rpc, b.model);
    await a.ready();
    const c = child(two.file, b.rpc, b.model);
    await c.ready();
    const x = browser(b.port);
    const y = browser(two.port);
    await signInAs(x, FOUNDER, b.ava);
    await signInAs(y, FOUNDER, b.ava);
    const p = await x(`/api/sales/${b.biz}/prepare`, "POST", {
      kind: "propose",
      input: b.proposal,
    });
    expect(p.status).toBe(200);
    const body = (k: string) => ({
      kind: "propose",
      input: p.body.input,
      action_digest: p.body.action_digest,
      idempotency_key: k,
    });
    const [r1, r2] = await Promise.all([
      x(`/api/sales/${b.biz}/actions`, "POST", body("proc-tab-0001")),
      y(`/api/sales/${b.biz}/actions`, "POST", body("proc-tab-0002")),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    const won = (r1.status === 201 ? r1 : r2).body.action.id as string;
    const lost = r1.status === 201 ? r2 : r1;
    expect([lost.body.code, lost.body.detail.action.id]).toEqual(["action_open", won]);
    const asks = await Promise.all([
      x(`/api/sales/actions/${won}/requested`, "POST", {}),
      y(`/api/sales/actions/${won}/requested`, "POST", {}),
    ]);
    expect(asks.map((q) => q.body.ask).sort()).toEqual(["already_asked", "granted"]);
    const db = openDb(b.db);
    try {
      const rows = db.prepare("SELECT state, asks FROM sale_actions").all() as Json[];
      expect(rows).toEqual([{ state: "requested", asks: 1 }]);
    } finally {
      db.close();
    }
  }, 120_000);
});
