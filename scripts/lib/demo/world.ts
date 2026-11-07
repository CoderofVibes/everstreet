// Step 7 (docs/design/DEMO_ACCOUNT.md §1-2): Delphine Marsh's three businesses, founded through the
// real routes over the synthetic stack: Ledgerline (AI invoice API on the labelled stand-in model),
// Relaydesk (SaaS workflow) and Signalwatch (agent service on the stand-in analyst), each with its
// own synthetic business contract (DemoChains), offer and fictional customers. FICTIONAL people,
// test tokens and models; no network. Runs on whatever clock the process has (the demo installs
// a simulated one first).

import { everstreetApi } from "../../../server/src/app.ts";
import type { Envelope } from "../../../server/src/customerSigning.ts";
import { verifiesEd25519 } from "../../../server/src/customerSigning.ts";
import { CustomerUses } from "../../../server/src/customerUse.ts";
import { MaintenanceSupervisor } from "../../../server/src/maintenance.ts";
import { V3Observations } from "../../../server/src/v3observe.ts";
import { canonicalSubmission } from "../../../server/src/workflow.ts";
import { SIGNALWATCH_BRIEF, SIGNALWATCH_PROTOTYPE } from "../../../server/test/analyst.ts";
import { attachCompanions } from "../../../server/test/companion-chain.ts";
import {
  CUSTOMER,
  type Json,
  keyFromSeed,
  OPERATOR,
  SyntheticProtection,
  TOKEN,
} from "../../../server/test/customer-world.ts";
import { ALT_TOKEN, attachIntents, VERIFIER } from "../../../server/test/intents-chain.ts";
import { RELAYDESK_PROTOTYPE } from "../../../server/test/relaydesk.ts";
import { correct, runtimeWorld, ScriptedRuntime } from "../../../server/test/runtime-world.ts";
import { DemoChains, SecondProvider } from "./chains.ts";

export const FOUNDER = { name: "Delphine Marsh", account: "delphine.near" };
export const BUYER = { name: "Noah Brandt", account: "buyer.near" };
export const CUSTOMERS = [
  { name: "Cara Okafor", account: CUSTOMER },
  { name: "Ines Duarte", account: "ines.near" },
  { name: "Theo Lindqvist", account: "theo.near" },
  { name: "Priya Raman", account: "priya.near" },
] as const;
export const ACCOUNTS = {
  ledgerline: "ledgerline.demo.near",
  relaydesk: "relaydesk.demo.near",
  signalwatch: "signalwatch.demo.near",
} as const;
export type BusinessKey = keyof typeof ACCOUNTS;
/** Fictional prices per use, in TUSD base units (6 decimals): 0.40, 1.50 and 4.00 TUSD. */
/** Signalwatch's companions and the parties to its supplier allowance (fictional). */
export const FEED_ACCOUNT = "signalwatch-feed.demo.near";
export const BUDGET_ACCOUNT = "signalwatch-budget.demo.near";
export const AGENT_ACCOUNT = "signalwatch-agent.demo.near";
export const SUPPLIER_ACCOUNT = "larchmere.demo.near";
export const PRICES: Record<BusinessKey, string> = {
  ledgerline: "400000",
  relaydesk: "1500000",
  signalwatch: "4000000",
};

type Caller = ((
  path: string,
  method?: string,
  body?: unknown,
) => Promise<{ status: number; body: Json }>) & { id: string };

const must = (what: string, r: { status: number; body: Json }, ok = [200, 201, 202]) => {
  if (!ok.includes(r.status)) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

export async function demoWorld(opts: { dbPath: string }) {
  const provider = new ScriptedRuntime(correct);
  const rw = runtimeWorld(provider, { ceilingCents: 100_000 }, { dbPath: opts.dbPath });
  const store = rw.store;
  const db = store.db;

  // Ledgerline first: an AI product is built with the (scripted, stand-in) build provider.
  const lf = await rw.founder(FOUNDER.name);
  await rw.release(lf);
  const founderId = lf.ava.id;

  // The other two businesses, started by the same founder.
  const shell = async (idea: string, foundation: string) =>
    must("project", await lf.ava("/api/product-projects", "POST", { idea, foundation }))
      .project as {
      id: string;
      business_id: string;
    };
  const rd = await shell("A support desk for small software teams", "saas_workflow");
  const sw = await shell("Flags what changes in suppliers' release notes", "agent_service");
  const business: Record<BusinessKey, { id: string; project: string }> = {
    ledgerline: { id: lf.business, project: lf.project },
    relaydesk: { id: rd.business_id, project: rd.id },
    signalwatch: { id: sw.business_id, project: sw.id },
  };

  // One synthetic contract per business; the founder owns each; customers hold prepaid uses.
  const chains = new DemoChains(verifiesEd25519, OPERATOR);
  for (const key of Object.keys(ACCOUNTS) as BusinessKey[]) {
    const c = chains.add(ACCOUNTS[key]);
    const base = c.ent(CUSTOMER);
    if (!base) throw new Error("fixture entitlement missing");
    for (const cu of CUSTOMERS) c.ents.set(cu.account, structuredClone(base));
    // Each product's own fictional price per use (test tokens, 6 decimals).
    c.plan = { ...c.plan, unit_price: PRICES[key] };
    c.attachSale({ owner: FOUNDER.account });
  }
  // Signalwatch's companions (fictional, synthetic): its alert feed's controller role on a
  // synthetic EVM chain, and an operating budget its agent pays the model supplier from.
  const swSale = chains.chains.get(ACCOUNTS.signalwatch)?.sale;
  if (!swSale) throw new Error("signalwatch's sale double missing");
  const companions = attachCompanions(
    chains,
    ACCOUNTS.signalwatch,
    () => {
      const c = swSale.controlView() as Json;
      return {
        owner: String(c.owner),
        generation: Number(c.generation),
        control_seq: String(c.control_seq),
      };
    },
    { asset: FEED_ACCOUNT, allowance: BUDGET_ACCOUNT, token: TOKEN },
  );
  // The synthetic EVM chain makes a block every 2 seconds (finality: 3 blocks).
  setInterval(() => companions.registry.mine(1), 2_000).unref();
  companions.allowance.fund(60_000_000n);
  companions.allowance.walletCall(FOUNDER.account, {
    methodName: "grant",
    args: {
      agent: AGENT_ACCOUNT,
      suppliers: [SUPPLIER_ACCOUNT],
      per_payment: "2000000",
      per_period: "60000000",
      period_ms: "604800000",
      review_above: "5000000",
    },
    gas: "1",
    deposit: "0",
  });
  // Funding a sale's escrow from another token through a synthetic intents verifier, with
  // Everstreet as the solver: its tUSD float sits in the verifier; the buyer holds tALT.
  const ledger = chains.chains.get(ACCOUNTS.signalwatch) as unknown as {
    balances: Map<string, bigint>;
    tokenRegistered: Set<string>;
  };
  const intents = attachIntents(
    chains,
    { token: TOKEN, ledger: { balances: ledger.balances, registered: ledger.tokenRegistered } },
    5_000_000_000n,
  );
  intents.alt.ledger.balances.set(BUYER.account, 2_000_000_000n);
  intents.alt.ledger.registered.add(BUYER.account);
  const protection = new SyntheticProtection();
  protection.ceiling = 1_000_000; // a month of requests (the double's default budget is a test's)
  const v3 = {
    transport: chains,
    bindings: (Object.keys(ACCOUNTS) as BusinessKey[]).map((k) => ({
      business_id: business[k].id,
      network: "testnet",
      account: ACCOUNTS[k],
    })),
  };
  // The handoff proof compares two providers at the same block (both synthetic, labelled so).
  const secondProvider = new SecondProvider(chains);
  const customerOptions = {
    reader: chains,
    writer: chains,
    operatorAccount: OPERATOR,
    now: () => Date.now(),
    protection,
    proof: {
      source: "synthetic",
      primaryName: "Synthetic provider A",
      second: { name: "Synthetic provider B", reader: secondProvider },
    },
  };
  const make = (extra: Partial<Parameters<typeof everstreetApi>[1]> = {}) =>
    everstreetApi(store, {
      localPreview: true,
      environment: "Demo (simulated history)",
      v3,
      customer: customerOptions as never,
      runtime: rw.runtime,
      companions: {
        bindings: [
          {
            business_id: business.signalwatch.id,
            asset: { account: FEED_ACCOUNT },
            allowance: { account: BUDGET_ACCOUNT },
          },
        ],
        evm: companions.evm,
      },
      intents: {
        bindings: [
          {
            business_id: business.signalwatch.id,
            network: "testnet",
            account: ACCOUNTS.signalwatch,
            asset: TOKEN,
            verifier: VERIFIER,
            offers: [
              { token: ALT_TOKEN, symbol: "tALT", decimals: 6, rate_num: "5", rate_den: "4" },
            ],
          },
        ],
        solver: intents.solver,
      },
      ...extra,
    });
  // `ops`: the app the scripted callers use once the browser's app is the verified-sign-in one
  // (scripts/demo.ts sets it); the same store, so both see the same businesses and sales.
  const state = { app: make(), ops: null as ReturnType<typeof make> | null };

  let tokens = 0;
  const caller = (personId: string): Caller => {
    const token = `demo-session-${++tokens}-${personId}`;
    db.prepare("INSERT INTO sessions (token, person_id, created_at) VALUES (?, ?, ?)").run(
      token,
      personId,
      new Date().toISOString(),
    );
    const call = async (path: string, method = "GET", body?: unknown) => {
      const res = await (state.ops ?? state.app).request(path, {
        method,
        headers: { cookie: `es_session=${token}`, "content-type": "application/json" },
        body: body === undefined || method === "GET" ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as Json };
    };
    return Object.assign(call, { id: personId });
  };
  const person = (name: string, account: string) => {
    const id = `person-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`;
    db.prepare(
      "INSERT INTO people (id, display_name, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING",
    ).run(id, name, new Date().toISOString());
    link(id, account);
    return caller(id);
  };
  const link = (personId: string, account: string) =>
    db
      .prepare(
        "INSERT INTO chain_accounts (owner_kind, owner_id, account_id, secret, tx, created_at) VALUES ('person', ?, ?, NULL, 'fixture', ?) ON CONFLICT DO NOTHING",
      )
      .run(personId, account, new Date().toISOString());
  link(founderId, FOUNDER.account);
  const delphine = caller(founderId);
  const customers = CUSTOMERS.map((c) => person(c.name, c.account));
  const noah = person(BUYER.name, BUYER.account);

  // Names, and the other two products: saved, compiled, checked and released.
  const names: Record<BusinessKey, string> = {
    ledgerline: "Ledgerline",
    relaydesk: "Relaydesk",
    signalwatch: "Signalwatch",
  };
  const taglines: Record<BusinessKey, string> = {
    ledgerline: "Reads an invoice and returns its fields",
    relaydesk: "Support requests become cases, worked through stages",
    signalwatch: "Flags what changed in suppliers' release notes",
  };
  for (const k of Object.keys(names) as BusinessKey[])
    must(
      "name",
      await delphine(`/api/businesses/${business[k].id}`, "PATCH", {
        name: names[k],
        tagline: taglines[k],
      }),
    );
  await compileAndRelease(
    delphine,
    business.relaydesk.project,
    {
      name: "Relaydesk support desk",
      audience: "Small software teams",
      problem: "Support requests arrive everywhere and get lost",
      promise: "Every request is received, assigned and resolved in one place",
      features: ["A request form", "A board with stages"],
      price: { model: "per_use", amount_cents: 15 },
    },
    RELAYDESK_PROTOTYPE,
  );
  must(
    "runtime budget",
    await delphine(`/api/businesses/${business.signalwatch.id}/runtime-budget`, "PUT", {
      limit_cents: 5_000,
    }),
  );
  await compileAndRelease(
    delphine,
    business.signalwatch.project,
    SIGNALWATCH_BRIEF,
    SIGNALWATCH_PROTOTYPE,
  );

  // An offer for each released product (plan 1, results kept 30 days).
  const offers = {} as Record<BusinessKey, string>;
  for (const k of Object.keys(ACCOUNTS) as BusinessKey[])
    offers[k] = await offer(delphine, business[k].id, business[k].project, `demo-offer-${k}`);

  const sign1 = keyFromSeed(1);
  const signed = (env: Envelope & { envelope_digest: string }) => ({
    envelope_digest: env.envelope_digest,
    hold_signature: sign1(env.hold.message_hex),
    use_signature: sign1(env.use.message_hex),
  });

  let uses = 0;
  /** One complete customer use through the real customer routes; its unit's end. */
  const use = async (who: Caller, offerId: string, input: string) => {
    const prep = await who(`/api/customer/offers/${offerId}/prepare`, "POST", {
      idempotency_key: `demo-use-${String(++uses).padStart(5, "0")}`,
      input,
    });
    if (prep.status !== 201) return { ok: false, code: prep.body.code as string, id: null };
    const id = prep.body.use.id as string;
    await who(`/api/customer/uses/${id}/confirm`, "POST", signed(prep.body.use.envelope));
    const x = await who(`/api/customer/uses/${id}/execute`, "POST", {});
    if (x.status !== 200 || !x.body.use?.execution) {
      // It didn't run: the customer returns the unit (as the page offers), so nothing stays held.
      await who(`/api/customer/uses/${id}/release`, "POST", {});
      return { ok: false, code: `not_run:${x.body.code ?? x.status}`, id };
    }
    let unit = "";
    for (let i = 0; i < 3 && unit !== "charged" && unit !== "returned"; i++)
      unit = (await who(`/api/customer/uses/${id}/units/reconcile`, "POST")).body.use?.units?.unit;
    return { ok: true, id, outcome: x.body.use?.execution?.outcome as string, unit };
  };

  /**
   * Background customer maintenance, as the composed entry runs it: settles charges, returns
   * expired reservations and cleans up, so a use made in the live demo finishes without a click.
   */
  const startMaintenance = () => {
    const uses = new CustomerUses(
      db,
      store,
      new V3Observations(db, store, v3),
      customerOptions as never,
      rw.runtime,
    );
    const s = new MaintenanceSupervisor(db, uses, { holder: "demo", intervalMs: 5_000 });
    s.start();
    return s;
  };

  return {
    startMaintenance,
    rw,
    /** The founder on the build app (AI builds go through the build provider there). */
    builder: lf.ava,
    store,
    db,
    chains,
    companions,
    secondProvider,
    protection,
    business,
    offers,
    state,
    make,
    delphine,
    customers,
    noah,
    caller,
    use,
    founderId,
    submission: canonicalSubmission,
  };
}

export type DemoWorld = Awaited<ReturnType<typeof demoWorld>>;

async function compileAndRelease(
  owner: Caller,
  project: string,
  brief: unknown,
  prototype: unknown,
) {
  const head = must("project", await owner(`/api/product-projects/${project}`)).head?.number ?? 1;
  must(
    "revision",
    await owner(`/api/product-projects/${project}/revisions`, "POST", {
      base_revision: head,
      brief,
      prototype,
    }),
  );
  const build = must(
    "compile",
    await owner(`/api/product-projects/${project}/builds`, "POST", {
      idempotency_key: `demo-compile-${project.slice(0, 8)}`,
      revision: head + 1,
    }),
  );
  return checkAndRelease(owner, project, build.job.id as string);
}

/** Checks a version (waiting for the run) and releases it. */
export async function checkAndRelease(owner: Caller, project: string, job: string) {
  let run = must(
    "checks",
    await owner(`/api/product-projects/${project}/evaluations`, "POST", { artifact_job: job }),
  ).run as Json;
  for (let i = 0; i < 600 && run.state === "running"; i++) {
    await new Promise((ok) => setTimeout(ok, 2));
    run = must("check", await owner(`/api/evaluations/${run.id}`)).run as Json;
  }
  return must(
    "release",
    await owner(`/api/product-projects/${project}/releases`, "POST", {
      artifact_job: job,
      eval_run: run.id,
    }),
  );
}

/** Reviews and creates the offer for the project's active release. */
export async function offer(owner: Caller, businessId: string, project: string, key: string) {
  const active = must("releases", await owner(`/api/product-projects/${project}/releases`)).active;
  const terms = { release_id: active.id, plan_id: 1, retention_days: 30 };
  const ins = must(
    "inspect",
    await owner(`/api/businesses/${businessId}/customer-offer-inspections`, "POST", terms),
  );
  const made = must(
    "offer",
    await owner(`/api/businesses/${businessId}/customer-offers`, "POST", {
      ...terms,
      idempotency_key: key,
      reviewed_terms: ins.inspection.terms_digest,
    }),
  );
  return made.offer.id as string;
}
