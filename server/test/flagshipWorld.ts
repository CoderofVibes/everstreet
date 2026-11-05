// Hardening after the November 5 build (Tony's agreed plan, item 1): the flagship journey's steps
// as reusable pieces for the restart/concurrency matrix, the Gated close inside the journey and
// agent access across a sale. Same SYNTHETIC rules as flagship-journey-process.test.ts: only the
// two network transports are answered here over IPC; the "wallet" applies exactly the stored,
// reviewed call to the synthetic chain. No real wallet, NEAR transaction, provider call, key or
// customer. Fictional people; ephemeral keys; children with hard deadlines.
//
// A child can be CUT at a request (Control.cut): "hold" never answers it (and nothing after it),
// "lose_reply" lets the synthetic chain apply it and never sends the answer. The test then kills
// the child (SIGKILL, exit awaited) and starts another on the same installation.

import { type ChildProcess, fork } from "node:child_process";
import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import { openDb } from "../src/db.ts";
import { CUSTOMER, type Json } from "./customer-world.ts";
import { prepareHandover } from "./handoverWorld.ts";
import {
  API_KEY_ENV,
  bootstrap,
  FICTIONAL_KEY,
  FOUNDER,
  nearKey,
  OP,
  type SyntheticModel,
  type SyntheticRpc,
  signInAs,
} from "./lifecycleWorld.ts";

export const BUYER = "noah-buyer.near";
export const PRICE = "150000"; // 0.15 TUSD per use (6 decimals), in base units
export const PLAN = {
  unit_price: PRICE,
  max_units_per_purchase: 100,
  max_units_outstanding: 120,
  max_hold_units: 1,
  hold_ttl_ms: "600000",
  settle_grace_ms: "480000",
};
export const MAINT = {
  interval_ms: 1_000,
  batch: 5,
  pass_budget_ms: 2_000,
  op_deadline_ms: 1_500,
  stop_timeout_ms: 5_000,
};
const BUILD_BUDGET = {
  max_input_tokens: 10_000,
  max_output_tokens: 2_000,
  max_seconds: 60,
  max_cost_cents: 10,
};
/** The synthetic model recognises the fixture invoice; each use sends its own copy of it. */
export const invoice = (n: number) =>
  `Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD (copy ${n})`;

export type Cleanup = () => void | Promise<void>;
export type Call = (
  path: string,
  method?: string,
  body?: unknown,
) => Promise<{ status: number; body: Json }>;

export const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });

export const until = async <T>(
  read: () => Promise<T>,
  ok: (v: T) => boolean,
  what: string,
  ms = 30_000,
) => {
  const end = Date.now() + ms;
  let last: T | undefined;
  while (Date.now() < end) {
    last = await read();
    if (ok(last)) return last;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${what}: ${JSON.stringify(last)?.slice(0, 600)}`);
};

export const ok = (r: { status: number; body: Json }, want: number | number[], what: string) => {
  const w = Array.isArray(want) ? want : [want];
  if (!w.includes(r.status)) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

export function browser(port: () => number): Call {
  const jar = new Map<string, string>();
  return async (path, method = "GET", body) => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(`http://127.0.0.1:${port()}${path}`, {
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

export type CutReq = { channel: string; body: string; url: string };
export type Decision = "answer" | "hold" | "lose_reply";
export type Control = { cut?: (req: CutReq) => Decision };

export function child(
  configFile: string,
  rpc: SyntheticRpc,
  model: SyntheticModel,
  cleanups: Cleanup[],
  ctl: Control = {},
  env: Record<string, string> = {},
) {
  const proc: ChildProcess = fork(join("server", "test", "entryChild.ts"), [configFile], {
    execArgv: ["--import", "tsx", "--max-old-space-size=384"],
    env: { ...process.env, [API_KEY_ENV]: FICTIONAL_KEY, ...env },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let out = "";
  proc.stdout?.on("data", (d) => (out = (out + d).slice(-32_768)));
  proc.stderr?.on("data", (d) => (out = (out + d).slice(-32_768)));
  const state = { cut: false, held: 0 };
  proc.on(
    "message",
    (m: { type?: string; channel?: string; id?: number; url?: string; body?: string }) => {
      if (m?.type !== "fetch") return;
      void (async () => {
        const decision: Decision = state.cut
          ? "hold"
          : (ctl.cut?.({
              channel: String(m.channel),
              body: String(m.body),
              url: String(m.url ?? ""),
            }) ?? "answer");
        if (decision === "hold") {
          state.cut = true;
          state.held++;
          return;
        }
        const r =
          m.channel === "rpc"
            ? { status: 200, body: await rpc.answer(String(m.body)) }
            : await model.answer(String(m.url), JSON.parse(String(m.body || "{}")));
        if (decision === "lose_reply") {
          state.cut = true;
          return;
        }
        if (proc.connected) proc.send({ type: "reply", id: m.id, ...r });
      })().catch(() => {});
    },
  );
  const exited = new Promise<number | null>((r) => proc.once("exit", (code) => r(code)));
  const deadline = setTimeout(() => proc.kill("SIGKILL"), 280_000);
  cleanups.push(async () => {
    clearTimeout(deadline);
    if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
    await exited;
  });
  return {
    proc,
    exited,
    state,
    log: () => out,
    ready: async () => {
      const end = Date.now() + 30_000;
      while (!out.includes("listening on")) {
        if (Date.now() > end) throw new Error(`child never listened: ${out.slice(-800)}`);
        if (proc.exitCode !== null) throw new Error(`child exited: ${out.slice(-800)}`);
        await new Promise((r) => setTimeout(r, 50));
      }
    },
    kill: async () => {
      proc.kill("SIGKILL");
      await exited;
    },
    shutdown: () => {
      if (proc.connected) proc.send({ type: "shutdown" });
      return exited;
    },
  };
}

/**
 * One disposable installation: the bare bootstrap (founder, project shell, account links, the
 * operator's writer key, fictional test tokens), and `start()` for a child on a fresh port (each
 * restart gets its own configuration file; the database, protected storage and keys are shared).
 */
export async function installation(cleanups: Cleanup[], o: { gated?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "flagship-h-"));
  cleanups.push(() =>
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  );
  const first = await freePort();
  const b = await bootstrap(dir, first, MAINT, { bare: true });
  b.w.chain.followWallClock = true;
  b.w.chain.balances.set(CUSTOMER, 100_000_000n);
  // Gated (MANAGED_HANDOVER.md): the sale half with a fictional closer, its function-call key and
  // the `handover` section; the coordinator gates, drains, closes and reconciles by itself.
  const gated = o.gated
    ? prepareHandover(b, dir, {
        plans: 0,
        handover: { interval_ms: 1_000, pass_budget_ms: 1_000, op_deadline_ms: 800 },
      })
    : null;
  if (!gated) {
    b.w.chain.balances.set(BUYER, 1_000_000_000n);
    const db = openDb(b.db);
    try {
      const t = new Date().toISOString();
      db.prepare(
        "INSERT INTO chain_accounts (owner_kind, owner_id, account_id, secret, tx, created_at) VALUES ('person', ?, ?, NULL, 'fixture', ?)",
      ).run(b.w.f.ava.id, FOUNDER, t);
      db.prepare(
        "INSERT INTO people (id, display_name, headline, bio, created_at) VALUES ('person-noah', 'Noah Brandt', '', '', ?)",
      ).run(t);
      db.prepare(
        "INSERT INTO person_accounts (account_id, person_id, network, created_at) VALUES (?, 'person-noah', 'testnet', ?)",
      ).run(BUYER, t);
      db.prepare(
        "INSERT INTO chain_accounts (owner_kind, owner_id, account_id, secret, tx, created_at) VALUES ('person', 'person-noah', ?, NULL, 'fixture', ?)",
      ).run(BUYER, t);
    } finally {
      db.close();
    }
  }
  const noahKey = gated ? gated.noah : nearKey();
  if (!gated) b.rpc.keys.set(`${BUYER}|${noahKey.id}`, 0n);
  const config = gated ? { ...b.config, handover: gated.handover } : b.config;
  let port = first;
  let n = 0;
  const start = async (ctl: Control = {}, env: Record<string, string> = {}) => {
    if (n > 0) port = await freePort();
    const file = join(dir, `config-${n++}.json`);
    writeFileSync(file, JSON.stringify({ ...config, listen: { host: "127.0.0.1", port } }));
    const c = child(file, b.rpc, b.model, cleanups, ctl, env);
    await c.ready();
    return c;
  };
  const read = (sql: string, ...args: (string | number)[]) => {
    const d = openDb(b.db);
    try {
      return d.prepare(sql).all(...args) as Json[];
    } finally {
      d.close();
    }
  };
  return {
    b,
    dir,
    noahKey,
    start,
    port: () => port,
    read,
    biz: b.w.f.business,
    project: b.w.f.project,
  };
}
export type Installation = Awaited<ReturnType<typeof installation>>;

/** A reviewed sale action through the routes, its call applied by the synthetic wallet. */
export async function act(
  i: Installation,
  who: Call,
  account: string,
  kind: string,
  input: Json,
  key: string,
) {
  const p = ok(
    await who(`/api/sales/${i.biz}/prepare`, "POST", { kind, input }),
    200,
    `prepare ${kind}`,
  );
  const c = ok(
    await who(`/api/sales/${i.biz}/actions`, "POST", {
      kind,
      input: p.input,
      action_digest: p.action_digest,
      idempotency_key: key,
    }),
    201,
    `create ${kind}`,
  );
  const id = c.action.id as string;
  expect((await who(`/api/sales/actions/${id}/requested`, "POST", {})).body.ask).toBe("granted");
  const out = i.b.w.chain.walletCall(account, c.action.call);
  await who(`/api/sales/actions/${id}/requested`, "POST", { tx_hash: out.transaction.hash });
  return { id, hash: out.transaction.hash as string };
}
export async function check(who: Call, id: string, kind: string) {
  return ok(await who(`/api/sales/actions/${id}/check`, "POST", {}), 200, `check ${kind}`);
}

/** The founder: revision, budgets, build, evaluation, release, plan, metering grant, offer. */
export async function foundAndOffer(i: Installation, ava: Call) {
  const { biz, project } = i;
  const p0 = ok(await ava(`/api/product-projects/${project}`), 200, "project");
  const head = p0.head as Json;
  const rev = ok(
    await ava(`/api/product-projects/${project}/revisions`, "POST", {
      base_revision: head.number,
      brief: { ...(head.brief as Json), name: "Ledgerline Invoice Reader" },
      prototype: head.prototype,
      note: "Named the product",
    }),
    [200, 201],
    "revision",
  );
  ok(await ava(`/api/businesses/${biz}/build-budget`, "PUT", { limit_cents: 100 }), 200, "budget");
  ok(await ava(`/api/businesses/${biz}/runtime-budget`, "PUT", { limit_cents: 100 }), 200, "rt");
  const jobId = ok(
    await ava(`/api/product-projects/${project}/builds`, "POST", {
      idempotency_key: "flagship-build-0001",
      revision: rev.head.number,
      budget: BUILD_BUDGET,
    }),
    [201, 202],
    "build",
  ).job.id as string;
  await until(
    async () => (await ava(`/api/product-projects/${project}/builds`)).body,
    (v) => (v.jobs as Json[]).some((j: Json) => j.id === jobId && j.state === "succeeded"),
    "the founder's build",
    60_000,
  );
  const evalRun = ok(
    await ava(`/api/product-projects/${project}/evaluations`, "POST", { artifact_job: jobId }),
    202,
    "evaluation",
  ).run;
  const run = await until(
    async () => (await ava(`/api/evaluations/${evalRun.id}`)).body.run,
    (r) => r?.state !== "running",
    "the evaluation",
    60_000,
  );
  expect(run.release_ready).toBe(true);
  ok(
    await ava(`/api/product-projects/${project}/releases`, "POST", {
      artifact_job: jobId,
      eval_run: run.id,
    }),
    201,
    "release",
  );
  const at0 = ok(
    await ava(`/api/businesses/${biz}/customer-access?project=${project}`),
    200,
    "access",
  );
  const releaseId = (at0.release as Json).id as string;
  const plan = await act(i, ava, FOUNDER, "create_plan", { plan: PLAN }, "flagship-plan-0001");
  expect((await check(ava, plan.id, "plan")).resolution).toMatchObject({ result: "created" });
  const grant = await act(i, ava, FOUNDER, "appoint", {}, "flagship-grant-001");
  expect((await check(ava, grant.id, "grant")).resolution).toMatchObject({ result: "appointed" });
  const offer = await offerFor(i, ava, releaseId, "flagship-offer-0001");
  return { jobId, run, releaseId, offer };
}

export async function offerFor(i: Installation, who: Call, rel: string, key: string) {
  const ins = ok(
    await who(`/api/businesses/${i.biz}/customer-offer-inspections`, "POST", {
      release_id: rel,
      plan_id: 1,
      retention_days: 30,
    }),
    200,
    "inspection",
  );
  return ok(
    await who(`/api/businesses/${i.biz}/customer-offers`, "POST", {
      idempotency_key: key,
      release_id: rel,
      plan_id: 1,
      retention_days: 30,
      reviewed_terms: ins.inspection.terms_digest,
    }),
    201,
    "offer",
  ).offer as Json;
}

/** An ed25519 use key held by the test (the customer's device, or an agent's own key). */
export function useKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pk = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
  return { pk, signHex: (hex: string) => signWith(privateKey, hex) };
}
const signWith = (k: KeyObject, hex: string) =>
  sign(null, Buffer.from(hex, "hex"), k).toString("hex");
export type UseKey = ReturnType<typeof useKey>;

/** The customer's purchase: shell, then `units` with `install` keys, wallet-applied, checked. */
export async function purchase(
  i: Installation,
  cara: Call,
  offerId: string,
  units: number,
  installs: { slot: number; key: UseKey }[],
  key: string,
  opts: { beforeCheck?: () => void | Promise<void>; checkWith?: Call } = {},
) {
  const setup = async (q = "") =>
    ok(await cara(`/api/customer/offers/${offerId}/purchase-setup${q}`), 200, "setup");
  const s0 = await setup(`?units=${units}`);
  if (s0.steps?.includes("shell")) i.b.w.chain.walletCall(CUSTOMER, s0.shell.call);
  const install = installs[0]
    ? { slot: installs[0].slot, pk: installs[0].key.pk, max_hold_units: 1, max_units_per_day: 100 }
    : undefined;
  const q = install ? `&install=${encodeURIComponent(JSON.stringify(install))}` : "";
  const s1 = await setup(`?units=${units}${q}`);
  const buy = ok(
    await cara(`/api/customer/offers/${offerId}/purchases`, "POST", {
      idempotency_key: key,
      units,
      ...(install ? { install } : {}),
      terms_digest: s1.preview.terms_digest,
    }),
    201,
    "purchase",
  );
  const pid = buy.purchase.id as string;
  await cara(`/api/customer/purchases/${pid}/requested`, "POST", {});
  const ptx = i.b.w.chain.walletCall(CUSTOMER, buy.purchase.call);
  await opts.beforeCheck?.();
  return { pid, hash: ptx.transaction.hash as string };
}

/** One use: prepare, sign both messages with `key`, confirm, run; returns the use id. */
export async function prepareAndConfirm(
  who: Call,
  offerId: string,
  n: number,
  key: UseKey,
  slot = 0,
) {
  const prep = ok(
    await who(`/api/customer/offers/${offerId}/prepare`, "POST", {
      idempotency_key: `flagship-use-${String(n).padStart(5, "0")}`,
      input: invoice(n),
      key_slot: slot,
    }),
    [200, 201],
    `prepare use ${n}`,
  );
  const env = prep.use.envelope as Json;
  const body = {
    envelope_digest: env.envelope_digest,
    hold_signature: key.signHex(env.hold.message_hex),
    use_signature: key.signHex(env.use.message_hex),
  };
  return { id: prep.use.id as string, body };
}

export async function serveOneUse(who: Call, offerId: string, n: number, key: UseKey, slot = 0) {
  const { id, body } = await prepareAndConfirm(who, offerId, n, key, slot);
  const conf = ok(await who(`/api/customer/uses/${id}/confirm`, "POST", body), 200, `confirm ${n}`);
  expect(conf.use?.state, JSON.stringify(conf)).toBe("reserved");
  const x = ok(await who(`/api/customer/uses/${id}/execute`, "POST", {}), 200, `execute ${n}`);
  expect(x.use?.execution?.fulfilled, JSON.stringify(x)).toBe(true);
  await charged(who, id, n);
  return id;
}

export async function charged(who: Call, id: string, n: number | string) {
  await until(
    async () => (await who(`/api/customer/uses/${id}/units/reconcile`, "POST")).body,
    (v) => v.use?.units?.unit === "charged",
    `use ${n} charged`,
  );
}

/** The sign-ins the journey needs, against whichever child is current (`i.port`). */
export async function people(i: Installation) {
  const ava = browser(i.port);
  await signInAs(ava, FOUNDER, i.b.ava);
  const cara = browser(i.port);
  await signInAs(cara, CUSTOMER, i.b.cara);
  const noah = browser(i.port);
  await signInAs(noah, BUYER, i.noahKey);
  return { ava, cara, noah };
}

export const SALE_TERMS = {
  buyer_account: BUYER,
  price: "250000000",
  expires_in_days: 7,
  available_floor: "0",
  grants: [{ account: OP, caps: 1 }],
  exclusions: ["The ledgerline.example domain and its DNS account"],
  note: "Fictional terms for the flagship journey.",
};
