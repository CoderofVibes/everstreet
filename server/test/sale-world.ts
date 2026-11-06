// Job 003wf2 test world: the customer world (real app, routes, customer runtime and writer) with
// the sale half of the SAME synthetic state attached (customer-world.ts FixtureChain.attachSale,
// sale-chain.ts). The v3 observation transport reads that same state. People: Ava (the founder,
// founder.near, owner here and on the contract), Noah (a buyer, buyer.near, holding his own
// fictional test tokens), Cara (a customer with 100 prepaid uses). Wallet transactions are applied
// to the double exactly as a wallet would send them (`wallet`), never as state edits.

import { QUOTE_BUNDLE, seedDoubleCheck } from "./app-fixtures.ts";
import {
  BUSINESS,
  customerWorld,
  type Json,
  OPERATOR,
  SyntheticProtection,
  TOKEN,
} from "./customer-world.ts";
import { RELAYDESK_PROTOTYPE } from "./relaydesk.ts";

/**
 * 006c (SUCCESSOR_REHEARSAL.md): a rehearsal seeds the world with the snapshot's EXACT product: a
 * SaaS workflow's saved revision, or a web app's bundle and customer terms, and its business name.
 */
export type ProductSeed =
  | { kind: "workflow"; business_name: string; brief: unknown; prototype: unknown }
  | {
      kind: "web_app";
      business_name: string;
      bundle: unknown;
      app_terms: { access: "pass"; pass_days: number; limitations: string };
    };

/** 006a: what a customer sends for an access pass (fixed; nothing of theirs). */
export const PASS_REQUEST = "Access pass";

export const SELLER = "founder.near";
export const BUYER = "buyer.near";
export const PRICE = "250000000"; // 250 TUSD (6 decimals) in base units
const INVOICE =
  "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD";

type Caller = ((
  path: string,
  method?: string,
  body?: unknown,
) => Promise<{ status: number; body: Json }>) & {
  id: string;
};

/** A Relaydesk request a customer sends in the harness (fictional). */
export const RELAYDESK_REQUEST = JSON.stringify({
  details: "FICTIONAL. Export on the Reports page spins, then nothing.",
  subject: "Export button does nothing",
  urgency: "high",
});

export async function saleWorld(
  opts: {
    dbPath?: string;
    /**
     * Relaydesk correction (Stage C browser pass): the business sells Relaydesk instead. 006a:
     * "quote-app" sells 7-day access passes to a fictional quote web app (a labelled stand-in
     * release: its logic checks ran on a test double).
     */
    product?: "ledgerline" | "relaydesk" | "quote-app";
    /** 006a: where released web apps are served (the harness's other site). */
    appOrigin?: string;
    /** 006c: the product to found, from a rehearsal snapshot (overrides the fixed samples). */
    seed?: ProductSeed;
  } = {},
) {
  const protection = new SyntheticProtection();
  const relaydesk = opts.seed ? opts.seed.kind === "workflow" : opts.product === "relaydesk";
  const quoteApp = opts.seed ? opts.seed.kind === "web_app" : opts.product === "quote-app";
  const w = await customerWorld({
    dbPath: opts.dbPath,
    customer: { protection },
    ...(relaydesk ? { bare: true, foundation: "saas_workflow" } : {}),
    ...(quoteApp
      ? { runtime: { appOrigin: opts.appOrigin ?? "http://localhost:4999", appStandIn: true } }
      : {}),
  });
  const sale = w.chain.attachSale();
  // The observation transport reads the same state (v3 intents and reconciliation).
  w.v3.transport = w.reader as never;
  w.state.app = w.make(w.state.store);
  w.link(w.f.ava.id, SELLER);
  const noah = w.person("Noah Brandt") as Caller;
  w.link(noah.id, BUYER);
  // Noah holds his own fictional test tokens; neither he nor Ava is registered with the token yet.
  w.chain.balances.set(BUYER, 1_000_000_000n);
  const offerId = relaydesk
    ? await foundRelaydesk(w, opts.seed?.kind === "workflow" ? opts.seed : undefined)
    : quoteApp
      ? await foundQuoteApp(w, opts.seed?.kind === "web_app" ? opts.seed : undefined)
      : await w.offer();
  const biz = w.f.business;
  const ava = w.owner as Caller;
  const stranger = w.person("Sam Okoro") as Caller;
  w.link(stranger.id, "stranger.near");

  /** The synthetic wallet: signs and applies exactly the call it is given, as `account`. */
  const wallet = (account: string, call: Json) => w.chain.walletCall(account, call as never);

  const prepare = (who: Caller, kind: string, input: Json = {}) =>
    who(`/api/sales/${biz}/prepare`, "POST", { kind, input });

  /**
   * One wallet action through the real routes: preview, store, mark asked, the wallet, the hash,
   * the check. `lose`: the wallet's answer is lost (no hash recorded). `send: false`: the wallet
   * was asked but never sent anything.
   */
  const act = async (
    who: Caller,
    account: string,
    kind: string,
    input: Json = {},
    o: { lose?: boolean; send?: boolean; key?: string; replaces?: string } = {},
  ) => {
    const p = await prepare(who, kind, input);
    if (p.status !== 200) return { p, created: null, outcome: null, check: null };
    const c = await who(`/api/sales/${biz}/actions`, "POST", {
      kind,
      input: p.body.input,
      action_digest: p.body.action_digest,
      idempotency_key: o.key ?? `sale-${kind}-${Math.random().toString(36).slice(2, 12)}`,
      ...(o.replaces ? { replaces: o.replaces } : {}),
    });
    if (c.status !== 201) return { p, created: c, outcome: null, check: null };
    const action = c.body.action as Json;
    // The ask is claimed before the wallet; only a granted claim invokes it.
    const ask = await who(`/api/sales/actions/${action.id}/requested`, "POST", {});
    if (ask.body.ask !== "granted") throw new Error(`the ask wasn't granted: ${ask.body.ask}`);
    let outcome: Json | null = null;
    if (o.send !== false) {
      outcome = wallet(account, action.call);
      if (!o.lose)
        await who(`/api/sales/actions/${action.id}/requested`, "POST", {
          tx_hash: outcome.transaction.hash,
        });
    }
    const check =
      o.lose || o.send === false
        ? null
        : await who(`/api/sales/actions/${action.id}/check`, "POST", {});
    return { p, created: c, action, outcome, check };
  };

  /** One complete customer use by Cara (prepare, confirm, execute, settle): its unit's end. */
  let uses = 0;
  const customerUse = async () => {
    w.clock.now = Number(w.chain.ts);
    const prep = await w.cara(`/api/customer/offers/${offerId}/prepare`, "POST", {
      idempotency_key: `sale-world-use-${String(++uses).padStart(4, "0")}`,
      input: relaydesk ? RELAYDESK_REQUEST : quoteApp ? PASS_REQUEST : INVOICE,
    });
    if (prep.status !== 201)
      return { status: prep.status, code: prep.body.code as string, unit: null };
    const id = prep.body.use.id as string;
    await w.cara(`/api/customer/uses/${id}/confirm`, "POST", w.signed(prep.body.use.envelope));
    await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    let unit = "";
    for (let i = 0; i < 3 && unit !== "charged"; i++)
      unit = (await w.cara(`/api/customer/uses/${id}/units/reconcile`, "POST")).body.use.units.unit;
    return { status: 201, code: null, unit, id };
  };

  const control = () => sale.controlView();
  return {
    w,
    sale,
    protection,
    biz,
    offerId,
    ava,
    noah,
    stranger,
    cara: w.cara as Caller,
    wallet,
    prepare,
    act,
    customerUse,
    control,
    setup: (who: Caller) => who(`/api/sales/${biz}`),
    BUSINESS,
    TOKEN,
    OPERATOR,
  };
}

export type SaleWorld = Awaited<ReturnType<typeof saleWorld>>;

/** Relaydesk founded through the real owner routes: revision, compile, checks, release, offer. */
async function foundRelaydesk(
  w: Awaited<ReturnType<typeof customerWorld>>,
  seed?: Extract<ProductSeed, { kind: "workflow" }>,
) {
  const { owner, f } = w;
  const fail = (what: string, r: { status: number; body: Json }) => {
    throw new Error(`relaydesk ${what}: ${r.status} ${JSON.stringify(r.body)}`);
  };
  await owner(`/api/businesses/${f.business}`, "PATCH", {
    name: seed?.business_name ?? "Relaydesk",
  });
  const head = (await owner(`/api/product-projects/${f.project}`)).body.head?.number ?? 1;
  const saved = await owner(`/api/product-projects/${f.project}/revisions`, "POST", {
    base_revision: head,
    brief: seed?.brief ?? {
      name: "Relaydesk support desk",
      audience: "Small fictional software teams",
      problem: "Support requests arrive everywhere and get lost",
      promise: "Every request is received, assigned and resolved in one place",
      features: ["A request form", "A board with stages"],
      price: { model: "per_use", amount_cents: 15 },
    },
    prototype: seed?.prototype ?? RELAYDESK_PROTOTYPE,
  });
  if (saved.status !== 201) fail("revision", saved);
  const build = await owner(`/api/product-projects/${f.project}/builds`, "POST", {
    idempotency_key: "harness-relaydesk-build",
    revision: head + 1,
  });
  if (build.status !== 201) fail("compile", build);
  const started = await owner(`/api/product-projects/${f.project}/evaluations`, "POST", {
    artifact_job: build.body.job.id,
  });
  if (started.status !== 202) fail("checks", started);
  let run: Json = started.body.run;
  for (let i = 0; i < 300 && run.state === "running"; i++) {
    await new Promise((ok) => setTimeout(ok, 2));
    run = (await owner(`/api/evaluations/${run.id}`)).body.run;
  }
  const released = await owner(`/api/product-projects/${f.project}/releases`, "POST", {
    artifact_job: build.body.job.id,
    eval_run: run.id,
  });
  if (released.status !== 201) fail("release", released);
  const terms = { release_id: released.body.active.id, plan_id: 1, retention_days: 30 };
  const digest = await w.reviewed(terms);
  const made = await owner(`/api/businesses/${f.business}/customer-offers`, "POST", {
    ...terms,
    idempotency_key: "harness-relaydesk-offer",
    reviewed_terms: digest,
  });
  if (made.status !== 201) fail("offer", made);
  return made.body.offer.id as string;
}

/**
 * 006a: a fictional quote web app built through the real build route, its test double's passed
 * check (fixture), released with reviewed 7-day pass terms (a labelled stand-in), and offered.
 */
async function foundQuoteApp(
  w: Awaited<ReturnType<typeof customerWorld>>,
  seed?: Extract<ProductSeed, { kind: "web_app" }>,
) {
  const { owner, f } = w;
  const fail = (what: string, r: { status: number; body: Json }) => {
    throw new Error(`quote app ${what}: ${r.status} ${JSON.stringify(r.body)}`);
  };
  await owner(`/api/businesses/${f.business}`, "PATCH", {
    name: seed?.business_name ?? "Lumen Parse",
  });
  const job = await w.rw.build(f.ava, f.project, seed?.bundle ?? QUOTE_BUNDLE, "app");
  const epoch = w.state.runtime.ownerEpoch(f.business);
  seedDoubleCheck(w.state.store.db as never, {
    project: f.project,
    business: f.business,
    job,
    requestedBy: f.ava.id,
    ownerId: epoch.owner_id as string,
    generation: epoch.generation,
  });
  const run = await owner(`/api/product-projects/${f.project}/evaluations`, "POST", {
    artifact_job: job,
  });
  if (run.status !== 202) fail("checks", run);
  const appTerms = seed?.app_terms ?? {
    access: "pass",
    pass_days: 7,
    limitations: "Estimates only; fictional prices.",
  };
  const t = await owner(`/api/product-projects/${f.project}/releases/app-terms`, "POST", {
    artifact_job: job,
    app_terms: appTerms,
  });
  if (t.status !== 200) fail("terms", t);
  const released = await owner(`/api/product-projects/${f.project}/releases`, "POST", {
    artifact_job: job,
    eval_run: run.body.run.id,
    app_terms: appTerms,
    terms_digest: t.body.terms_digest,
  });
  if (released.status !== 201) fail("release", released);
  const terms = { release_id: released.body.active.id, plan_id: 1, retention_days: 30 };
  const digest = await w.reviewed(terms);
  const made = await owner(`/api/businesses/${f.business}/customer-offers`, "POST", {
    ...terms,
    idempotency_key: "harness-quote-app-offer",
    reviewed_terms: digest,
  });
  if (made.status !== 201) fail("offer", made);
  return made.body.offer.id as string;
}

/** Terms a seller proposes (the platform's metering account named unless `metering: false`). */
export const proposal = (
  o: { price?: string; floor?: string; metering?: boolean; days?: number } = {},
) => ({
  buyer_account: BUYER,
  price: o.price ?? PRICE,
  expires_in_days: o.days ?? 7,
  available_floor: o.floor ?? "0",
  grants: o.metering === false ? [] : [{ account: OPERATOR, caps: 1 }],
  exclusions: ["The ledgerline.example domain and its DNS account"],
  note: "Fictional terms for a synthetic review.",
});
