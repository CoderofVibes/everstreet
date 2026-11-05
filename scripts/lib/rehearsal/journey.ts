// business-v3 testnet rehearsal (docs/design/V3_TESTNET_APPROVAL_PACKET.md), example 1: the Direct
// sale journey through the app's OWN routes, written once against `Env` so the same steps run
// (a) locally against the synthetic chain as a dry run (server/test/rehearsal-driver.test.ts) and
// (b) live against NEAR testnet (scripts/v3-rehearsal.ts). The environment supplies the HTTP
// clients, sign-in, the wallet (it signs exactly the call the app prepared) and the chain views.
// Fictional people; no customer document beyond the fictional sample invoice.

import { generateKeyPairSync, sign } from "node:crypto";
import type { Recorder } from "./evidence.ts";

// biome-ignore lint/suspicious/noExplicitAny: loosely typed route answers, read field by field
export type Json = Record<string, any>;
export type Call = (
  path: string,
  method?: string,
  body?: unknown,
) => Promise<{ status: number; body: Json }>;
export interface WalletCall {
  receiverId: string;
  methodName: string;
  args: Json;
  deposit: string;
  gas: string;
}
export type Who = "founder" | "buyer" | "customer";

export interface Env {
  label: "synthetic dry run" | "NEAR testnet";
  accounts: Record<Who, string>;
  /** The platform's metering account (its key: function calls to this business only). */
  operator: string;
  business: { id: string; project: string; contract: string };
  /** A cookie-bound HTTP client for this person, against the current app. */
  client: (who: Who) => Call;
  signIn: (who: Who, call: Call) => Promise<void>;
  /** Signs and sends exactly this call as this person; resolves when final. */
  wallet: (
    who: Who,
    call: WalletCall,
  ) => Promise<{ hash: string; ok: boolean; receipts?: Json[]; error?: string }>;
  /** Chain views at a checkpoint (final finality on testnet). */
  views: () => Promise<Json>;
}

export const PRICE = "150000"; // 0.15 tUSD per use (6 decimals)
export const PLAN = {
  unit_price: PRICE,
  max_units_per_purchase: 100,
  max_units_outstanding: 120,
  max_hold_units: 1,
  hold_ttl_ms: "600000",
  settle_grace_ms: "480000",
};
const BUILD_BUDGET = {
  max_input_tokens: 10_000,
  max_output_tokens: 2_000,
  max_seconds: 60,
  max_cost_cents: 10,
};
/** The stand-in model recognises this fictional invoice; each use sends its own copy. */
export const invoice = (n: number) =>
  `Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD (copy ${n})`;

export class StopRun extends Error {}
const ok = (r: { status: number; body: Json }, want: number | number[], what: string) => {
  const w = Array.isArray(want) ? want : [want];
  if (!w.includes(r.status)) throw new StopRun(`${what}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const until = async <T>(
  read: () => Promise<T>,
  done: (v: T) => boolean,
  what: string,
  ms: number,
) => {
  const end = Date.now() + ms;
  let last: T | undefined;
  while (Date.now() < end) {
    last = await read();
    if (done(last)) return last;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new StopRun(`timed out waiting for ${what}: ${JSON.stringify(last)?.slice(0, 400)}`);
};
const expect = (cond: boolean, what: string, detail?: unknown) => {
  if (!cond)
    throw new StopRun(
      `expected ${what}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`,
    );
};

/** The customer device's use key (ed25519); it signs hold/use messages, never a transaction. */
function deviceKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pk = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
  return {
    pk,
    sign: (hex: string) => sign(null, Buffer.from(hex, "hex"), privateKey).toString("hex"),
  };
}

export interface DirectOptions {
  /** Delivered uses before the sale (the packet: 20). */
  uses?: number;
  /** Seconds to wait for each settlement (testnet blocks are ~1 s; the writer needs a few). */
  settleWaitMs?: number;
}

/**
 * Example 1. Returns the run's key ids. Throws StopRun at the first mismatch (never retries a
 * write blindly: an unknown outcome stops the run for writer-history recovery).
 */
export async function runDirect(env: Env, rec: Recorder, o: DirectOptions = {}) {
  const USES = o.uses ?? 20;
  const settleMs = o.settleWaitMs ?? 120_000;
  const ava = env.client("founder");
  const cara = env.client("customer");
  const noah = env.client("buyer");
  for (const [w, c] of [
    ["founder", ava],
    ["customer", cara],
    ["buyer", noah],
  ] as const)
    await env.signIn(w, c);
  const { id: biz, project } = env.business;
  await rec.checkpoint("start", await env.views());

  // ---- 1. The founder: revision, budgets, build, evaluation, release (stand-in model).
  const head = ok(await ava(`/api/product-projects/${project}`), 200, "project").head as Json;
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
      idempotency_key: "rehearsal-build-0001",
      revision: rev.head.number,
      budget: BUILD_BUDGET,
    }),
    [201, 202],
    "build",
  ).job.id as string;
  await until(
    async () => (await ava(`/api/product-projects/${project}/builds`)).body,
    (v) => (v.jobs as Json[]).some((j) => j.id === jobId && j.state === "succeeded"),
    "the build",
    120_000,
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
    120_000,
  );
  expect(run.release_ready === true, "the evaluation release_ready", run);
  const released = ok(
    await ava(`/api/product-projects/${project}/releases`, "POST", {
      artifact_job: jobId,
      eval_run: run.id,
    }),
    201,
    "release",
  );
  rec.app("release_1", {
    release: released.active?.id,
    artifact_job: jobId,
    evaluation: {
      total: run.total,
      passed: run.passed ?? run.total,
      release_ready: run.release_ready,
    },
    model: "stand-in (scripted; no AI provider)",
  });

  // ---- 2. Plan, metering appointment, offer.
  const act = async (who: Who, c: Call, kind: string, input: Json, key: string) => {
    const p = ok(
      await c(`/api/sales/${biz}/prepare`, "POST", { kind, input }),
      200,
      `prepare ${kind}`,
    );
    const made = ok(
      await c(`/api/sales/${biz}/actions`, "POST", {
        kind,
        input: p.input,
        action_digest: p.action_digest,
        idempotency_key: key,
      }),
      201,
      `create ${kind}`,
    );
    const id = made.action.id as string;
    const ask = (await c(`/api/sales/actions/${id}/requested`, "POST", {})).body.ask;
    expect(ask === "granted", `the app to grant the ${kind} request`, ask);
    const tx = await env.wallet(who, made.action.call as WalletCall);
    await c(`/api/sales/actions/${id}/requested`, "POST", { tx_hash: tx.hash });
    const checked = ok(await c(`/api/sales/actions/${id}/check`, "POST", {}), 200, `check ${kind}`);
    rec.tx(kind, who, env.accounts[who], made.action.call as WalletCall, tx, checked.resolution);
    expect(checked.resolution?.kind === "confirmed", `${kind} confirmed`, checked.resolution);
    return checked;
  };
  await act("founder", ava, "create_plan", { plan: PLAN }, "rehearsal-plan-0001");
  await act("founder", ava, "appoint", {}, "rehearsal-grant-001");
  const access = ok(
    await ava(`/api/businesses/${biz}/customer-access?project=${project}`),
    200,
    "access",
  );
  const offerFor = async (c: Call, rel: string, key: string) => {
    const ins = ok(
      await c(`/api/businesses/${biz}/customer-offer-inspections`, "POST", {
        release_id: rel,
        plan_id: 1,
        retention_days: 30,
      }),
      200,
      "inspection",
    );
    return ok(
      await c(`/api/businesses/${biz}/customer-offers`, "POST", {
        idempotency_key: key,
        release_id: rel,
        plan_id: 1,
        retention_days: 30,
        reviewed_terms: ins.inspection.terms_digest,
      }),
      201,
      "offer",
    ).offer as Json;
  };
  const offer = await offerFor(ava, (access.release as Json).id, "rehearsal-offer-0001");
  rec.app("offer_1", { offer: offer.id, plan: 1, unit_price: PRICE });
  await rec.checkpoint("offer_open", await env.views());

  // ---- 3. A fresh customer registers, buys 100 with this device's key, and uses USES.
  const key = deviceKey();
  const setup = async (q: string) =>
    ok(await cara(`/api/customer/offers/${offer.id}/purchase-setup${q}`), 200, "purchase setup");
  const s0 = await setup("?units=100");
  for (const step of s0.steps as string[]) {
    const c =
      step === "shell" ? s0.shell?.call : step === "token_storage" ? s0.token_storage?.call : null;
    expect(!!c, `a call for the purchase step ${step}`, s0.steps);
    const tx = await env.wallet("customer", c as WalletCall);
    rec.tx(`purchase_step_${step}`, "customer", env.accounts.customer, c as WalletCall, tx, null);
    expect(tx.ok, `the ${step} step to succeed`, tx.error);
  }
  const install = { slot: 0, pk: key.pk, max_hold_units: 1, max_units_per_day: 100 };
  const s1 = await setup(`?units=100&install=${encodeURIComponent(JSON.stringify(install))}`);
  expect(s1.preview?.amount === "15000000", "the preview to charge 15 tUSD", s1.preview);
  const buy = ok(
    await cara(`/api/customer/offers/${offer.id}/purchases`, "POST", {
      idempotency_key: "rehearsal-buy-00001",
      units: 100,
      install,
      terms_digest: s1.preview.terms_digest,
    }),
    201,
    "purchase",
  );
  const pid = buy.purchase.id as string;
  await cara(`/api/customer/purchases/${pid}/requested`, "POST", {});
  const ptx = await env.wallet("customer", buy.purchase.call as WalletCall);
  const bought = ok(
    await cara(`/api/customer/purchases/${pid}/check`, "POST", { tx_hash: ptx.hash }),
    200,
    "purchase check",
  );
  rec.tx(
    "purchase_100",
    "customer",
    env.accounts.customer,
    buy.purchase.call,
    ptx,
    bought.resolution,
  );
  expect(
    bought.resolution?.kind === "confirmed" && bought.resolution.units === 100,
    "100 bought",
    bought.resolution,
  );
  await rec.checkpoint("bought_100", await env.views());

  const serve = async (offerId: string, n: number) => {
    const prep = ok(
      await cara(`/api/customer/offers/${offerId}/prepare`, "POST", {
        idempotency_key: `rehearsal-use-${String(n).padStart(5, "0")}`,
        input: invoice(n),
        key_slot: 0,
      }),
      [200, 201],
      `prepare ${n}`,
    );
    const env1 = prep.use.envelope as Json;
    const id = prep.use.id as string;
    const conf = ok(
      await cara(`/api/customer/uses/${id}/confirm`, "POST", {
        envelope_digest: env1.envelope_digest,
        hold_signature: key.sign(env1.hold.message_hex),
        use_signature: key.sign(env1.use.message_hex),
      }),
      200,
      `confirm ${n}`,
    );
    const reserved = await until(
      async () =>
        conf.use?.state === "reserved"
          ? conf
          : (await cara(`/api/customer/uses/${id}/reconcile`, "POST")).body,
      (v) => v.use?.state === "reserved",
      `use ${n} reserved`,
      settleMs,
    );
    void reserved;
    const x = ok(await cara(`/api/customer/uses/${id}/execute`, "POST", {}), 200, `execute ${n}`);
    expect(x.use?.execution?.fulfilled === true, `use ${n} delivered`, x.use?.execution);
    await until(
      async () => (await cara(`/api/customer/uses/${id}/units/reconcile`, "POST")).body,
      (v) => v.use?.units?.unit === "charged",
      `use ${n} charged`,
      settleMs,
    );
    rec.app(`use_${n}`, { use: id, offer: offerId, delivered: true, unit: "charged" });
    return id;
  };
  const uses: string[] = [];
  for (let n = 1; n <= USES; n++) uses.push(await serve(offer.id as string, n));
  await rec.checkpoint(`used_${USES}`, await env.views());
  const first = ok(await cara(`/api/customer/uses/${uses[0]}/result`), 200, "result 1");

  // ---- 4. The Direct sale.
  const terms = {
    buyer_account: env.accounts.buyer,
    price: "250000000",
    expires_in_days: 7,
    available_floor: "0",
    grants: [{ account: env.operator, caps: 1 }],
    exclusions: ["The ledgerline.example domain and its DNS account"],
    note: "Fictional terms for the business-v3 testnet rehearsal.",
  };
  await act("founder", ava, "propose", terms, "rehearsal-propose-01");
  for (const k of ["register", "fund", "accept"])
    await act("buyer", noah, k, {}, `rehearsal-${k}-0001`);
  await rec.checkpoint("before_close", await env.views());
  const close = await act("founder", ava, "accept", {}, "rehearsal-close-001");
  expect(close.resolution?.result === "closed", "the sale closed", close.resolution);
  await rec.checkpoint("closed", await env.views());

  // The former owner's write is denied; the buyer's succeeds.
  const denied = await ava(`/api/businesses/${biz}/customer-access?project=${project}`);
  rec.app("old_owner_denied", { route: "GET customer-access (owner view)", status: denied.status });
  expect(denied.status !== 200, "the former owner's owner view refused", denied.status);
  const deniedWrite = await ava(`/api/product-projects/${project}/releases`, "POST", {
    artifact_job: jobId,
    eval_run: run.id,
  });
  rec.app("old_owner_write_denied", { route: "POST releases", status: deniedWrite.status });
  expect(
    deniedWrite.status >= 400 && deniedWrite.status < 500,
    "the former owner's release refused",
    deniedWrite.status,
  );
  const buyerSale = ok(await noah(`/api/sales/${biz}`), 200, "buyer sale");
  expect(buyerSale.local_owner === true, "the buyer manages the business", buyerSale.local_owner);

  // ---- 5. The same customer's next use under the buyer: 79 left.
  uses.push(await serve(offer.id as string, USES + 1));
  await rec.checkpoint("next_use_under_buyer", await env.views());
  const firstAfter = ok(await cara(`/api/customer/uses/${uses[0]}/result`), 200, "result 1 after");
  expect(JSON.stringify(firstAfter) === JSON.stringify(first), "the earlier result unchanged");

  // ---- 6. The buyer's checked update, and a use that names the new release.
  const nhead = ok(await noah(`/api/product-projects/${project}`), 200, "buyer project")
    .head as Json;
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
      idempotency_key: "rehearsal-build-0002",
      revision: nrev.head.number,
      budget: BUILD_BUDGET,
    }),
    [201, 202],
    "buyer build",
  ).job.id as string;
  await until(
    async () => (await noah(`/api/product-projects/${project}/builds`)).body,
    (v) => (v.jobs as Json[]).some((j) => j.id === job2 && j.state === "succeeded"),
    "the buyer's build",
    120_000,
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
    120_000,
  );
  const rel2 = ok(
    await noah(`/api/product-projects/${project}/releases`, "POST", {
      artifact_job: job2,
      eval_run: done2.id,
    }),
    201,
    "buyer release",
  );
  const offer2 = await offerFor(noah, rel2.active.id as string, "rehearsal-offer-0002");
  rec.app("release_2", {
    release: rel2.active.id,
    artifact_job: job2,
    offer: offer2.id,
    by: "buyer",
  });
  const updated = await serve(offer2.id as string, USES + 2);
  const st = ok(await cara(`/api/customer/uses/${updated}`), 200, "updated use");
  expect(
    st.use.offer_id === offer2.id,
    "the later use on the new release's offer",
    st.use.offer_id,
  );
  rec.app("use_on_update", { use: updated, offer: offer2.id, release: rel2.active.id });
  await rec.checkpoint("after_update", await env.views());
  return { offer: offer.id as string, offer2: offer2.id as string, uses: [...uses, updated] };
}
