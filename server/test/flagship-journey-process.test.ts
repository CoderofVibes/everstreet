// Job 003wf (parent), Phase A of the November 5 build packet: the FLAGSHIP journey in ONE actual
// child process running the normal entry (serve.ts -> compose.ts) over the configured composition.
//
// SYNTHETIC, labelled: only the two network transports are answered here over IPC (SyntheticRpc
// over ONE contract-anchored customer+sale state; SyntheticModel with fictional answers), and the
// "wallet" applies exactly the stored, reviewed call to that state. No real wallet, NEAR
// transaction, provider call, key or customer. Fictional people; ephemeral keys; one 384 MiB child
// with a hard deadline; the directory is removed afterwards.
//
// Bootstrap prerequisites ONLY (lifecycleWorld.ts `bootstrap` with `bare`): the founder's person,
// the project's business shell (so its contract account can be bound in the configuration), the
// people's account links, the operator's writer key and Noah's fictional test tokens. Everything
// else is made through the child's own routes: budgets, build, evaluation, release, the founder's
// plan, the reviewed metering grant, the offer, Cara's registration and purchase of 100 uses, 20
// delivered uses, the Direct sale (proposal, registration, funding, acceptance, close and
// reconciliation), the buyer's next served use (79), and the buyer's reviewed successor release
// delivered to the same customer.

import { type ChildProcess, fork } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
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
  nearKey,
  OP,
  type SyntheticModel,
  type SyntheticRpc,
  signInAs,
} from "./lifecycleWorld.ts";

const BUYER = "noah-buyer.near";
const PRICE = "150000"; // 0.15 TUSD per use (6 decimals), in base units
const PLAN = {
  unit_price: PRICE,
  max_units_per_purchase: 100,
  max_units_outstanding: 100,
  max_hold_units: 1,
  hold_ttl_ms: "600000",
  settle_grace_ms: "480000",
};
const MAINT = {
  interval_ms: 60_000,
  batch: 5,
  pass_budget_ms: 3_000,
  op_deadline_ms: 2_000,
  stop_timeout_ms: 5_000,
};
// The synthetic model recognises the fixture invoice; each use sends its own copy of it.
const invoice = (n: number) =>
  `Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD (copy ${n})`;

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
const until = async <T>(
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

function child(configFile: string, rpc: SyntheticRpc, model: SyntheticModel) {
  const proc: ChildProcess = fork(join("server", "test", "entryChild.ts"), [configFile], {
    execArgv: ["--import", "tsx", "--max-old-space-size=384"],
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
  const deadline = setTimeout(() => proc.kill("SIGKILL"), 280_000);
  cleanups.push(async () => {
    clearTimeout(deadline);
    if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
    await exited;
  });
  return {
    proc,
    exited,
    log: () => out,
    ready: async () => {
      const end = Date.now() + 30_000;
      while (!out.includes("listening on")) {
        if (Date.now() > end) throw new Error(`child never listened: ${out.slice(-800)}`);
        await new Promise((r) => setTimeout(r, 50));
      }
    },
  };
}

type Call = (
  path: string,
  method?: string,
  body?: unknown,
) => Promise<{ status: number; body: Json }>;
function browser(port: number): Call {
  const jar = new Map<string, string>();
  return async (path, method = "GET", body) => {
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
const ok = (r: { status: number; body: Json }, want: number | number[], what: string) => {
  const w = Array.isArray(want) ? want : [want];
  if (!w.includes(r.status)) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

describe("003wf parent: the flagship journey in one configured child (SYNTHETIC chain, wallet and model)", () => {
  it("founder builds, evaluates, releases and offers; a fresh customer buys 100 and uses 20; a Direct sale closes; 80 at close, 79 after the buyer's next use; a draft never changes the served product; the buyer's reviewed update reaches the same customer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flagship-"));
    cleanups.push(() =>
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
    );
    const port = await freePort();
    const b = await bootstrap(dir, port, MAINT, { bare: true });
    const biz = b.w.f.business;
    const project = b.w.f.project;
    // Bootstrap prerequisites: account links and Noah's fictional test tokens (no product state).
    b.w.chain.followWallClock = true; // the double's blocks follow real time, as NEAR's do
    b.w.chain.balances.set(BUYER, 1_000_000_000n);
    b.w.chain.balances.set(CUSTOMER, 100_000_000n); // Cara's fictional test tokens (100 TUSD)
    const noahKey = nearKey();
    b.rpc.keys.set(`${BUYER}|${noahKey.id}`, 0n);
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
      // Nothing of the product exists yet: no budget, build, evaluation, release, plan or offer.
      const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
      expect(count("SELECT COUNT(*) AS n FROM build_jobs")).toBe(0);
      expect(count("SELECT COUNT(*) AS n FROM runtime_releases")).toBe(0);
      expect(count("SELECT COUNT(*) AS n FROM customer_offers")).toBe(0);
    } finally {
      db.close();
    }
    expect(b.w.chain.sale?.plans.size).toBe(0);

    const app = child(b.configFile, b.rpc, b.model);
    await app.ready();
    const ava = browser(port);
    await signInAs(ava, FOUNDER, b.ava);

    // ---- 1. Founder: brief revision, budgets, build, evaluation, release (all through routes).
    const p0 = ok(await ava(`/api/product-projects/${project}`), 200, "project");
    const head = p0.head as Json;
    const brief = { ...(head.brief as Json), name: "Ledgerline Invoice Reader" };
    const rev = ok(
      await ava(`/api/product-projects/${project}/revisions`, "POST", {
        base_revision: head.number,
        brief,
        prototype: head.prototype,
        note: "Named the product",
      }),
      [200, 201],
      "revision",
    );
    const revN = rev.head.number as number;
    expect(revN).toBe(head.number + 1);
    ok(
      await ava(`/api/businesses/${biz}/build-budget`, "PUT", { limit_cents: 100 }),
      200,
      "build budget",
    );
    ok(
      await ava(`/api/businesses/${biz}/runtime-budget`, "PUT", { limit_cents: 100 }),
      200,
      "runtime budget",
    );
    const buildBudget = {
      max_input_tokens: 10_000,
      max_output_tokens: 2_000,
      max_seconds: 60,
      max_cost_cents: 10,
    };
    const started = ok(
      await ava(`/api/product-projects/${project}/builds`, "POST", {
        idempotency_key: "flagship-build-0001",
        revision: revN,
        budget: buildBudget,
      }),
      [201, 202],
      "build",
    );
    const jobId = started.job.id as string;
    await until(
      async () => (await ava(`/api/product-projects/${project}/builds`)).body,
      (v) => (v.jobs as Json[]).some((j: Json) => j.id === jobId && j.state === "succeeded"),
      "the founder's build",
      60_000,
    );
    expect(b.model.calls.builds).toBe(1);
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
    expect([run.state, run.all_passed, run.release_ready, run.total]).toEqual([
      "complete",
      true,
      true,
      10,
    ]);
    const released = ok(
      await ava(`/api/product-projects/${project}/releases`, "POST", {
        artifact_job: jobId,
        eval_run: run.id,
      }),
      201,
      "release",
    );
    void released;

    // ---- 2. Founder: plan, reviewed metering grant, offer (P-3's route chain, 100 per purchase).
    const access = async () =>
      ok(await ava(`/api/businesses/${biz}/customer-access?project=${project}`), 200, "access");
    const at0 = await access();
    const releaseId = (at0.release as Json).id as string;
    const act = async (who: Call, account: string, kind: string, input: Json, key: string) => {
      const p = ok(
        await who(`/api/sales/${biz}/prepare`, "POST", { kind, input }),
        200,
        `prepare ${kind}`,
      );
      const c = ok(
        await who(`/api/sales/${biz}/actions`, "POST", {
          kind,
          input: p.input,
          action_digest: p.action_digest,
          idempotency_key: key,
        }),
        201,
        `create ${kind}`,
      );
      const id = c.action.id as string;
      expect((await who(`/api/sales/actions/${id}/requested`, "POST", {})).body.ask).toBe(
        "granted",
      );
      const out = b.w.chain.walletCall(account, c.action.call);
      await who(`/api/sales/actions/${id}/requested`, "POST", { tx_hash: out.transaction.hash });
      return ok(await who(`/api/sales/actions/${id}/check`, "POST", {}), 200, `check ${kind}`);
    };
    const made = await act(ava, FOUNDER, "create_plan", { plan: PLAN }, "flagship-plan-0001");
    expect(made.resolution).toMatchObject({ kind: "confirmed", result: "created" });
    const granted = await act(ava, FOUNDER, "appoint", {}, "flagship-grant-001");
    expect(granted.resolution).toMatchObject({ kind: "confirmed", result: "appointed" });
    const offerFor = async (who: Call, rel: string, plan: number, key: string) => {
      const ins = ok(
        await who(`/api/businesses/${biz}/customer-offer-inspections`, "POST", {
          release_id: rel,
          plan_id: plan,
          retention_days: 30,
        }),
        200,
        "inspection",
      );
      return ok(
        await who(`/api/businesses/${biz}/customer-offers`, "POST", {
          idempotency_key: key,
          release_id: rel,
          plan_id: plan,
          retention_days: 30,
          reviewed_terms: ins.inspection.terms_digest,
        }),
        201,
        "offer",
      ).offer as Json;
    };
    const offer = await offerFor(ava, releaseId, 1, "flagship-offer-0001");
    expect((await access()).steps.map((s: Json) => s.state)).toEqual([
      "confirmed",
      "confirmed",
      "confirmed",
    ]);

    // ---- 3. A fresh customer registers, buys 100 uses with this device's key, and uses 20.
    expect(b.w.chain.ent(CUSTOMER)).toBeFalsy();
    const cara = browser(port);
    await signInAs(cara, CUSTOMER, b.cara);
    const setup = async (q = "") =>
      ok(await cara(`/api/customer/offers/${offer.id}/purchase-setup${q}`), 200, "setup");
    const s0 = await setup("?units=100");
    expect(s0.steps).toEqual(["shell"]);
    expect(b.w.chain.walletCall(CUSTOMER, s0.shell.call).status).toEqual({ SuccessValue: "" });
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pk = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
    const signHex = (hex: string) =>
      sign(null, Buffer.from(hex, "hex"), privateKey).toString("hex");
    const install = { slot: 0, pk, max_hold_units: 1, max_units_per_day: 100 };
    const s1 = await setup(`?units=100&install=${encodeURIComponent(JSON.stringify(install))}`);
    expect(s1.preview).toMatchObject({ units: 100, amount: "15000000" });
    const buy = ok(
      await cara(`/api/customer/offers/${offer.id}/purchases`, "POST", {
        idempotency_key: "flagship-buy-00001",
        units: 100,
        install,
        terms_digest: s1.preview.terms_digest,
      }),
      201,
      "purchase",
    );
    const pid = buy.purchase.id as string;
    await cara(`/api/customer/purchases/${pid}/requested`, "POST", {});
    const ptx = b.w.chain.walletCall(CUSTOMER, buy.purchase.call);
    const bought = ok(
      await cara(`/api/customer/purchases/${pid}/check`, "POST", { tx_hash: ptx.transaction.hash }),
      200,
      "purchase check",
    );
    expect(bought.resolution).toEqual({ kind: "confirmed", units: 100, amount: "15000000" });
    expect(b.w.chain.ent(CUSTOMER)).toMatchObject({ free: "100", consumed: "0" });

    const serveOneUse = async (who: Call, offerId: string, n: number) => {
      const prep = ok(
        await who(`/api/customer/offers/${offerId}/prepare`, "POST", {
          idempotency_key: `flagship-use-${String(n).padStart(5, "0")}`,
          input: invoice(n),
          key_slot: 0,
        }),
        201,
        `prepare use ${n}`,
      );
      const env = prep.use.envelope as Json;
      const id = prep.use.id as string;
      const conf = ok(
        await who(`/api/customer/uses/${id}/confirm`, "POST", {
          envelope_digest: env.envelope_digest,
          hold_signature: signHex(env.hold.message_hex),
          use_signature: signHex(env.use.message_hex),
        }),
        200,
        `confirm use ${n}`,
      );
      expect(conf.use?.state, JSON.stringify(conf)).toBe("reserved");
      const x = ok(await who(`/api/customer/uses/${id}/execute`, "POST", {}), 200, `execute ${n}`);
      expect(x.use?.execution?.fulfilled, JSON.stringify(x)).toBe(true);
      await until(
        async () => (await who(`/api/customer/uses/${id}/units/reconcile`, "POST")).body,
        (v) => v.use?.units?.unit === "charged",
        `use ${n} charged`,
      );
      return id;
    };
    const uses: string[] = [];
    for (let n = 1; n <= 20; n++) uses.push(await serveOneUse(cara, offer.id as string, n));
    expect(b.w.chain.ent(CUSTOMER)).toMatchObject({ free: "80", consumed: "20" });
    expect(b.w.chain.charged).toBe(20);
    expect(b.rpc.applied.filter((t) => t.method === "open_hold")).toHaveLength(20);
    expect(b.rpc.applied.filter((t) => t.method === "settle_hold")).toHaveLength(20);
    // Delivered results, readable by the customer only.
    const first = ok(await cara(`/api/customer/uses/${uses[0]}/result`), 200, "result 1");
    const firstStatus = ok(await cara(`/api/customer/uses/${uses[0]}`), 200, "use 1");
    expect((await ava(`/api/customer/uses/${uses[0]}/result`)).status).not.toBe(200);

    // ---- 4. Operating evidence: 20 delivered uses, their earned revenue and runtime cost.
    const desk = ok(await ava(`/api/businesses/${biz}/digital-desk`), 200, "digital desk");
    const books = ok(await ava(`/api/businesses/${biz}/books`), 200, "books");
    const now = books.operations.months.at(-1) as Json;
    expect(now.usage).toMatchObject({
      requested: 20,
      charged: 20,
      returned: 0,
      needs_attention: 0,
    });
    expect(now.execution).toMatchObject({ ran: 20, usable_result: 20, unknown: 0 });
    // Customer compute and the founder's evaluation compute are recorded apart, none unknown.
    expect(now.cost.customers).toMatchObject({ calls: 20, unknown_cost_calls: 0 });
    expect(BigInt(now.cost.customers.microcents)).toBeGreaterThan(0n);
    expect(now.cost.founder).toMatchObject({ unknown_cost_calls: 0 });
    expect(desk.current).toMatchObject({ needs_attention: 0, reserved_not_settled: 0 });
    // 005e: economics in the offer's own asset, exact base units, no conversion or profit.
    const eco = ok(await ava(`/api/businesses/${biz}/economics?months=1`), 200, "economics");
    const tusd = eco.months[0].by_asset["tusd.near"];
    expect(tusd).toMatchObject({
      earned: "3000000", // 20 x 150000
      earned_units: 20,
      prepaid_in: "15000000",
      prepaid_units: 100,
      pending_units: 0,
      returned_purchases: "0",
    });
    expect(eco.months[0].successful_uses).toBe(20);
    expect(eco.months[0].compute).toMatchObject({ calls: 20, unknown_cost_calls: 0 });
    expect(BigInt(eco.months[0].cost_per_success_microcents)).toBe(
      BigInt(now.cost.customers.microcents) / 20n,
    );
    expect(eco.obligations).toEqual([
      expect.objectContaining({
        asset: "tusd.near",
        outstanding_units: 80,
        outstanding_value: "12000000",
      }),
    ]);
    expect(eco.definitions.no_profit).toMatch(/aren't converted/);
    expect(eco.recovery.items).toEqual([]);
    // The buyer can't read the seller's economics before the sale; a stranger never can.
    expect((await browser(port)(`/api/businesses/${biz}/economics`)).status).not.toBe(200);

    // ---- 5. The Direct sale: proposal with the metering grant in the reviewed terms, the buyer's
    // registration, funding and acceptance, then the seller's close and the reconciliation.
    const proposed = await act(
      ava,
      FOUNDER,
      "propose",
      {
        buyer_account: BUYER,
        price: "250000000",
        expires_in_days: 7,
        available_floor: "0",
        grants: [{ account: OP, caps: 1 }],
        exclusions: ["The ledgerline.example domain and its DNS account"],
        note: "Fictional terms for the flagship journey.",
      },
      "flagship-propose-01",
    );
    expect(proposed.resolution).toMatchObject({ kind: "confirmed", result: "proposed" });
    const noah = browser(port);
    await signInAs(noah, BUYER, noahKey);
    expect(ok(await noah(`/api/sales/${biz}`), 200, "buyer sale").roles.buyer).toBe(true);
    for (const k of ["register", "fund", "accept"])
      expect((await act(noah, BUYER, k, {}, `flagship-${k}-0001`)).resolution.kind).toBe(
        "confirmed",
      );
    const close = await act(ava, FOUNDER, "accept", {}, "flagship-close-001");
    expect(close.resolution, JSON.stringify(close)).toMatchObject({
      kind: "confirmed",
      result: "closed",
    });
    expect(close.effects).toMatchObject({ reconcile: { state: "applied" }, finished: true });
    expect(b.w.chain.sale?.controlView()).toMatchObject({ owner: BUYER, generation: 2 });

    // 80 preserved at close; the customer's earlier result and history keep their identities.
    expect(b.w.chain.ent(CUSTOMER)).toMatchObject({ free: "80", consumed: "20" });
    expect(ok(await cara(`/api/customer/uses/${uses[0]}/result`), 200, "result 1 after")).toEqual(
      first,
    );
    const afterStatus = ok(await cara(`/api/customer/uses/${uses[0]}`), 200, "use 1 after");
    expect(afterStatus.use?.id).toBe(firstStatus.use?.id);

    // The former owner loses management; the buyer has it.
    const sellerAfter = ok(await ava(`/api/sales/${biz}`), 200, "seller after");
    expect([sellerAfter.local_owner, sellerAfter.roles.former_seller]).toEqual([false, true]);
    expect(
      (await ava(`/api/businesses/${biz}/customer-access?project=${project}`)).status,
    ).not.toBe(200);
    expect(
      (
        await ava(`/api/product-projects/${project}/releases`, "POST", {
          artifact_job: jobId,
          eval_run: run.id,
        })
      ).status,
    ).not.toBe(201);
    expect(ok(await noah(`/api/sales/${biz}`), 200, "buyer after").local_owner).toBe(true);

    // ---- 6. The buyer serves the next use: 79 remain.
    uses.push(await serveOneUse(cara, offer.id as string, 21));
    expect(b.w.chain.ent(CUSTOMER)).toMatchObject({ free: "79", consumed: "21" });

    // ---- 7. The buyer's reviewed successor update: revision, build, evaluation, release, offer.
    const nview = ok(await noah(`/api/product-projects/${project}`), 200, "buyer project");
    const nhead = nview.head as Json;
    const nrev = ok(
      await noah(`/api/product-projects/${project}/revisions`, "POST", {
        base_revision: nhead.number,
        brief: { ...(nhead.brief as Json), name: "Ledgerline Invoice Reader 2" },
        prototype: nhead.prototype,
        note: "Successor update under the new owner",
      }),
      [200, 201],
      "buyer revision",
    );
    const job2 = ok(
      await noah(`/api/product-projects/${project}/builds`, "POST", {
        idempotency_key: "flagship-build-0002",
        revision: nrev.head.number,
        budget: buildBudget,
      }),
      [201, 202],
      "buyer build",
    ).job.id as string;
    await until(
      async () => (await noah(`/api/product-projects/${project}/builds`)).body,
      (v) => (v.jobs as Json[]).some((j: Json) => j.id === job2 && j.state === "succeeded"),
      "the buyer's build",
      60_000,
    );
    const run2 = ok(
      await noah(`/api/product-projects/${project}/evaluations`, "POST", { artifact_job: job2 }),
      202,
      "buyer evaluation",
    ).run as Json;
    const done2 = await until(
      async () => (await noah(`/api/evaluations/${run2.id}`)).body.run,
      (r) => r?.state !== "running",
      "the buyer's evaluation",
      60_000,
    );
    expect([done2.state, done2.release_ready]).toEqual(["complete", true]);
    // Phase B: the buyer's new revision is built and checked but NOT released yet; the customer's
    // next use is still served by the released version (a draft never changes the product).
    const whileDrafting = await serveOneUse(cara, offer.id as string, 22);
    expect(b.w.chain.ent(CUSTOMER)).toMatchObject({ free: "78", consumed: "22" });
    const rel2 = ok(
      await noah(`/api/product-projects/${project}/releases`, "POST", {
        artifact_job: job2,
        eval_run: done2.id,
      }),
      201,
      "buyer release",
    );
    const rel2Id = rel2.active.id as string;
    expect(rel2.active).toMatchObject({ artifact_job: job2, state: "active" });
    const offer2 = await offerFor(noah, rel2Id, 1, "flagship-offer-0002");
    const updated = await serveOneUse(cara, offer2.id as string, 23);
    expect(b.w.chain.ent(CUSTOMER)).toMatchObject({ free: "77", consumed: "23" });
    const st = ok(await cara(`/api/customer/uses/${updated}`), 200, "updated use");
    expect(st.use.offer_id).toBe(offer2.id);
    // Cara's earlier result is still hers, unchanged, after the buyer's update.
    expect(ok(await cara(`/api/customer/uses/${uses[0]}/result`), 200, "result 1 later")).toEqual(
      first,
    );
    expect((await noah(`/api/customer/uses/${uses[0]}/result`)).status).not.toBe(200);

    // The bounded stop: the child drains and exits 0.
    app.proc.send({ type: "shutdown" });
    expect(await app.exited).toBe(0);

    // The durable record, read after the stop: which release served which use, under which owner.
    const rec = openDb(b.db);
    try {
      const q = rec.prepare(
        `SELECT ri.release_id, ri.artifact_job, ri.owner_generation, ce.result_state, ce.delivery
           FROM customer_executions ce JOIN runtime_invocations ri ON ri.id = ce.invocation_id
          WHERE ce.request_id = ?`,
      );
      const served = (id: string | undefined) => q.get(String(id));
      const r1 = served(uses[0]) as Json;
      const r21 = served(uses[20]) as Json;
      const r22 = served(updated) as Json;
      // The use made while the update was only a draft ran on the released (first) artifact.
      expect(served(whileDrafting)).toMatchObject({ artifact_job: jobId, delivery: "delivered" });
      expect(r1).toMatchObject({ artifact_job: jobId, delivery: "delivered" });
      expect(r21).toMatchObject({ artifact_job: jobId, delivery: "delivered" });
      expect(r22).toMatchObject({ release_id: rel2Id, artifact_job: job2, delivery: "delivered" });
      // The local owner generation moved at the close: use 21 and the update ran under the buyer.
      expect(Number(r21.owner_generation)).toBeGreaterThan(Number(r1.owner_generation));
      expect(r22.owner_generation).toBe(r21.owner_generation);
      // Ciphertext only: the stored result reference is protected, never plaintext in the row.
      expect(String(r1.result_state)).toBe("stored");
      // One charge per delivered use, none repeated.
      const charges = rec
        .prepare("SELECT COUNT(*) AS n FROM customer_settlements WHERE kind = 'charge'")
        .get() as { n: number };
      expect(charges.n).toBe(23);
    } finally {
      rec.close();
    }
  }, 300_000);
});
