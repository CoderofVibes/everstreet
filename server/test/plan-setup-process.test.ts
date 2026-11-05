// Job 003wf4 (OWNER_PLAN_SETUP.md §10 P-1..P-3): guided plan setup in ACTUAL child processes
// running the normal entry (serve.ts) over the production composition (lifecycleWorld.ts
// bootstrap): the real routes, SaleActions, CustomerUses, the configured writer and runtime, with
// only the RPC and model HTTP answered by this process over IPC from one synthetic state. The
// "wallet" applies exactly the stored call to that state (no signing by a real wallet, no network,
// no real NEAR). Disposable files, ephemeral keys, fictional accounts; at most two 256 MiB
// children, each with a hard deadline.

import { type ChildProcess, fork } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { CUSTOMER, type Json } from "./customer-world.ts";
import {
  API_KEY_ENV,
  bootstrap,
  FICTIONAL_KEY,
  FOUNDER,
  OP,
  type SyntheticModel,
  type SyntheticRpc,
  signInAs,
} from "./lifecycleWorld.ts";

const INVOICE =
  "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD";
const PLAN = {
  unit_price: "150000",
  max_units_per_purchase: 20,
  max_units_outstanding: 100,
  max_hold_units: 1,
  hold_ttl_ms: "600000",
  settle_grace_ms: "360000",
};
const MAINT = {
  interval_ms: 60_000,
  batch: 5,
  pass_budget_ms: 3_000,
  op_deadline_ms: 2_000,
  stop_timeout_ms: 5_000,
};

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
const until = async (cond: () => boolean | Promise<boolean>, what: string, ms = 30_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
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

/** A configured installation: `fresh` starts with no plan, grant, entitlement or offer. */
async function installation(fresh = false) {
  const dir = mkdtempSync(join(tmpdir(), "plan-proc-"));
  cleanups.push(() =>
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  );
  const port = await freePort();
  const b = await bootstrap(dir, port, MAINT, { fresh });
  if (!fresh) b.w.chain.attachSale({ owner: FOUNDER });
  const db = openDb(b.db);
  try {
    db.prepare(
      "INSERT INTO chain_accounts (owner_kind, owner_id, account_id, secret, tx, created_at) VALUES ('person', ?, ?, NULL, 'fixture', ?)",
    ).run(b.w.f.ava.id, FOUNDER, new Date().toISOString());
  } finally {
    db.close();
  }
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
  const rows = () => {
    const d = openDb(b.db);
    try {
      return d.prepare("SELECT id, kind, state, asks, tx_hash FROM sale_actions").all() as Json[];
    } finally {
      d.close();
    }
  };
  return { ...b, dir, port, second, rows, biz: b.w.f.business };
}
type Install = Awaited<ReturnType<typeof installation>>;
type Call = ReturnType<typeof browser>;

/** Prepare, store, claim the ask, the wallet's exact send, its hash, the check: one request. */
async function walletAction(b: Install, call: Call, kind: string, input: Json, key: string) {
  const p = await call(`/api/sales/${b.biz}/prepare`, "POST", { kind, input });
  if (p.status !== 200) throw new Error(`prepare ${kind} ${p.status} ${JSON.stringify(p.body)}`);
  const c = await call(`/api/sales/${b.biz}/actions`, "POST", {
    kind,
    input: p.body.input,
    action_digest: p.body.action_digest,
    idempotency_key: key,
  });
  if (c.status !== 201) throw new Error(`create ${kind} ${c.status} ${JSON.stringify(c.body)}`);
  const id = c.body.action.id as string;
  expect((await call(`/api/sales/actions/${id}/requested`, "POST", {})).body.ask).toBe("granted");
  const out = b.w.chain.walletCall(FOUNDER, c.body.action.call);
  await call(`/api/sales/actions/${id}/requested`, "POST", { tx_hash: out.transaction.hash });
  return (await call(`/api/sales/actions/${id}/check`, "POST", {})).body;
}

const plans = (b: Install) =>
  [...b.w.chain.txs.values()].filter(
    (t) => (t as Json).transaction.actions[0].FunctionCall.method_name === "create_plan_guarded",
  );

describe("003wf4 guided plan setup in actual processes", () => {
  it("P-1 two processes contend for one review and for different plans: one row, one ask", async () => {
    const b = await installation();
    const two = await b.second();
    const a = child(b.configFile, b.rpc, b.model);
    await a.ready();
    const c = child(two.file, b.rpc, b.model);
    await c.ready();
    const x = browser(b.port);
    const y = browser(two.port);
    await signInAs(x, FOUNDER, b.ava);
    await signInAs(y, FOUNDER, b.ava);
    const px = await x(`/api/sales/${b.biz}/prepare`, "POST", {
      kind: "create_plan",
      input: { plan: PLAN },
    });
    const py = await y(`/api/sales/${b.biz}/prepare`, "POST", {
      kind: "create_plan",
      input: { plan: { ...PLAN, unit_price: "175000" } },
    });
    expect([px.status, py.status], JSON.stringify(px.body)).toEqual([200, 200]);
    expect(px.body.identity).toBe(py.body.identity);
    const body = (p: Json, k: string) => ({
      kind: "create_plan",
      input: p.body.input,
      action_digest: p.body.action_digest,
      idempotency_key: k,
    });
    // The same review in both processes at once, under different keys: one row.
    const [r1, r2] = await Promise.all([
      x(`/api/sales/${b.biz}/actions`, "POST", body(px, "proc-plan-0001")),
      y(`/api/sales/${b.biz}/actions`, "POST", body(px, "proc-plan-0002")),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    const won = (r1.status === 201 ? r1 : r2).body.action.id as string;
    expect((r1.status === 201 ? r2 : r1).body.code).toBe("action_open");
    // Different plan inputs under the same control, from the other process: a conflict.
    const clash = await y(`/api/sales/${b.biz}/actions`, "POST", body(py, "proc-plan-0003"));
    expect([clash.status, clash.body.code]).toEqual([409, "request_conflict"]);
    expect(clash.body.detail.action.id).toBe(won);
    // Both processes claim the ask at once: exactly one is granted.
    const asks = await Promise.all([
      x(`/api/sales/actions/${won}/requested`, "POST", {}),
      y(`/api/sales/actions/${won}/requested`, "POST", {}),
    ]);
    expect(asks.map((q) => q.body.ask).sort()).toEqual(["already_asked", "granted"]);
    expect(b.rows()).toEqual([
      { id: won, kind: "create_plan", state: "requested", asks: 1, tx_hash: null },
    ]);
  }, 120_000);

  it("P-2 killed after the ask and the send, before the hash: the other process recovers it by its own hash; one plan", async () => {
    const b = await installation();
    const two = await b.second();
    const a = child(b.configFile, b.rpc, b.model);
    await a.ready();
    const x = browser(b.port);
    await signInAs(x, FOUNDER, b.ava);
    const p = await x(`/api/sales/${b.biz}/prepare`, "POST", {
      kind: "create_plan",
      input: { plan: PLAN },
    });
    const c = await x(`/api/sales/${b.biz}/actions`, "POST", {
      kind: "create_plan",
      input: p.body.input,
      action_digest: p.body.action_digest,
      idempotency_key: "proc-plan-kill-1",
    });
    const id = c.body.action.id as string;
    expect((await x(`/api/sales/actions/${id}/requested`, "POST", {})).body.ask).toBe("granted");
    const out = b.w.chain.walletCall(FOUNDER, c.body.action.call);
    a.proc.kill("SIGKILL");
    await a.exited;
    const other = child(two.file, b.rpc, b.model);
    await other.ready();
    const y = browser(two.port);
    await signInAs(y, FOUNDER, b.ava);
    // Never asked again; the blind check can't confirm; its own hash does, with the readback.
    expect((await y(`/api/sales/actions/${id}/requested`, "POST", {})).body.ask).toBe(
      "already_asked",
    );
    const blind = await y(`/api/sales/actions/${id}/check`, "POST", {});
    expect(blind.body.action.state).toBe("no_longer_possible");
    const own = await y(`/api/sales/actions/${id}/check`, "POST", {
      tx_hash: out.transaction.hash,
    });
    expect(own.body.resolution).toMatchObject({ kind: "confirmed", result: "created" });
    expect(own.body.effects).toMatchObject({ plan: { plan_id: 2, plan: PLAN } });
    expect(plans(b)).toHaveLength(1);
    expect(b.w.chain.sale?.planCount).toBe(2);
  }, 120_000);

  it("P-3 the normal route: founder's plan, the reviewed grant, the offer, then a customer buys, runs and is charged once", async () => {
    const b = await installation(true);
    const a = child(b.configFile, b.rpc, b.model);
    await a.ready();
    const ava = browser(b.port);
    await signInAs(ava, FOUNDER, b.ava);
    const access = async () =>
      (await ava(`/api/businesses/${b.biz}/customer-access?project=${b.w.f.project}`)).body;
    const at0 = await access();
    expect(at0.steps.map((s: Json) => [s.key, s.state])).toEqual([
      ["plan", "needs_input"],
      ["permissions", "needs_input"],
      ["offer", "blocked"],
    ]);
    expect(at0.operator).toMatchObject({ account: OP, current: null, change: "Adds metering." });
    // 1. The founder's own plan: plan 1 of this contract (no bootstrap plan exists).
    const made = await walletAction(b, ava, "create_plan", { plan: PLAN }, "journey-plan-01");
    expect(made.resolution).toMatchObject({ kind: "confirmed", result: "created" });
    expect(made.effects).toMatchObject({
      plan: { plan_id: 1, plan: { ...PLAN, created_generation: 1 } },
    });
    // 2. The reviewed grant: metering for this owner.
    const granted = await walletAction(b, ava, "appoint", {}, "journey-grant-01");
    expect(granted.resolution).toMatchObject({ kind: "confirmed", result: "appointed" });
    expect(b.w.chain.sale?.operators[0]).toEqual({ account: OP, caps: 1, generation: 1 });
    // 3. The offer, from its own inspection of the founder's plan.
    const ins = await ava(`/api/businesses/${b.biz}/customer-offer-inspections`, "POST", {
      release_id: (at0.release as Json).id,
      plan_id: 1,
      retention_days: 30,
    });
    expect(ins.status, JSON.stringify(ins.body)).toBe(200);
    expect(ins.body.inspection.serve).toMatchObject({ usable: true });
    const offer = await ava(`/api/businesses/${b.biz}/customer-offers`, "POST", {
      idempotency_key: "journey-offer-01",
      release_id: (at0.release as Json).id,
      plan_id: 1,
      retention_days: 30,
      reviewed_terms: ins.body.inspection.terms_digest,
    });
    expect(offer.status, JSON.stringify(offer.body)).toBe(201);
    const offerId = offer.body.offer.id as string;
    const at1 = await access();
    expect(at1.steps.map((s: Json) => s.state)).toEqual(["confirmed", "confirmed", "confirmed"]);
    // 4. A customer with no entitlement registers, buys 10 uses with this device's key, uses one.
    const cara = browser(b.port);
    await signInAs(cara, CUSTOMER, b.cara);
    const setup = async (q = "") =>
      (await cara(`/api/customer/offers/${offerId}/purchase-setup${q}`)).body;
    const s0 = await setup("?units=10");
    expect(s0.steps).toEqual(["shell"]);
    expect(b.w.chain.walletCall(CUSTOMER, s0.shell.call).status).toEqual({ SuccessValue: "" });
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pk = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
    const signHex = (hex: string) =>
      sign(null, Buffer.from(hex, "hex"), privateKey).toString("hex");
    const install = { slot: 0, pk, max_hold_units: 1, max_units_per_day: 10 };
    const s1 = await setup(`?units=10&install=${encodeURIComponent(JSON.stringify(install))}`);
    expect(s1.preview).toMatchObject({ units: 10, amount: "1500000" });
    const buy = await cara(`/api/customer/offers/${offerId}/purchases`, "POST", {
      idempotency_key: "journey-buy-0001",
      units: 10,
      install,
      terms_digest: s1.preview.terms_digest,
    });
    expect(buy.status, JSON.stringify(buy.body)).toBe(201);
    const pid = buy.body.purchase.id as string;
    await cara(`/api/customer/purchases/${pid}/requested`, "POST", {});
    const tx = b.w.chain.walletCall(CUSTOMER, buy.body.purchase.call);
    const bought = await cara(`/api/customer/purchases/${pid}/check`, "POST", {
      tx_hash: tx.transaction.hash,
    });
    expect(bought.body.resolution).toEqual({ kind: "confirmed", units: 10, amount: "1500000" });
    const prep = await cara(`/api/customer/offers/${offerId}/prepare`, "POST", {
      idempotency_key: "journey-use-0001",
      input: INVOICE,
      key_slot: 0,
    });
    expect(prep.status, JSON.stringify(prep.body)).toBe(201);
    const env = prep.body.use.envelope as Json;
    const id = prep.body.use.id as string;
    const conf = await cara(`/api/customer/uses/${id}/confirm`, "POST", {
      envelope_digest: env.envelope_digest,
      hold_signature: signHex(env.hold.message_hex),
      use_signature: signHex(env.use.message_hex),
    });
    expect(conf.body.use?.state, JSON.stringify(conf.body)).toBe("reserved");
    const x = await cara(`/api/customer/uses/${id}/execute`, "POST", {});
    expect(x.body.use?.execution?.fulfilled, JSON.stringify(x.body)).toBe(true);
    let unit = "";
    await until(async () => {
      unit = (await cara(`/api/customer/uses/${id}/units/reconcile`, "POST")).body.use?.units?.unit;
      return unit === "charged";
    }, "the unit charged");
    expect(b.w.chain.ent(CUSTOMER)).toMatchObject({ free: "9", consumed: "1" });
    expect(b.rpc.applied.filter((t) => t.method === "open_hold")).toHaveLength(1);
    expect(b.rpc.applied.filter((t) => t.method === "settle_hold")).toHaveLength(1);
    expect(b.w.chain.charged).toBe(1);
    expect(plans(b)).toHaveLength(1);
  }, 150_000);
});
