// Job 003wf2 (docs/design/DIRECT_SALE.md): the scenario behind scripts/sale-harness.ts, kept apart
// from any listener so a test can drive it without a network.
//
// FICTIONAL and SYNTHETIC: the sale world (server/test/sale-world.ts: an in-memory database, the
// real app and routes, ONE synthetic customer+sale state anchored to the contract's own fixtures),
// with VERIFIED identity (the real AccountSignIn over a synthetic account-key reader and this
// harness's exact callback URL). The wallet is injected at the Wallet Selector MODULE boundary
// (walletHarness.ts WALLET_SCRIPT, the official module interface); its transactions are applied to
// the synthetic state by the contract's rules, exactly as encoded. People: Ava (seller,
// founder.near), Noah (buyer, buyer.near), Cara (customer). Nothing is a real wallet, account or
// network; the page may connect only to this harness.

import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { Hono } from "hono";
import { base58Encode } from "../../server/src/customerWriter.ts";
import { AccountSignIn, nep413Digest } from "../../server/src/identity.ts";
import type { Store } from "../../server/src/store.ts";
import { CUSTOMER, type Json, OPERATOR } from "../../server/test/customer-world.ts";
import {
  BUYER,
  PASS_REQUEST,
  RELAYDESK_REQUEST,
  SELLER,
  saleWorld,
} from "../../server/test/sale-world.ts";
import { labelScript } from "./customerPreview.ts";
import { HARNESS_CSP, HARNESS_LABEL, WALLET_SCRIPT, walletHistory } from "./walletHarness.ts";

export { HARNESS_CSP, HARNESS_LABEL };
export const SALE_ACCOUNTS = [SELLER, BUYER, CUSTOMER] as const;

/**
 * Job 003wf4 (Astra 06:21): the session's FINITE budget for each test double. The fixture defaults
 * (400 chain calls, 300 reads) are sized for one test; a browser review reads the contract on
 * every page load (about 23 views each), so the defaults ran out after about 17 loads and every
 * later read failed as "NEAR couldn't be read". The harness now names its own bounded budget.
 */
/**
 * Job 003wf4 (Astra 06:21): where the founder opens Set up customer access: the product studio
 * route (/build/<project>), as the app's own navigation reaches it. (/studio/<id> is the launch
 * studio and takes another id.)
 */
export const customerAccessPath = (h: { world: { w: { f: { project: string } } } }) =>
  `/build/${h.world.w.f.project}`;

export const HARNESS_BUDGET = {
  chain_calls: 200_000,
  reader_reads: 100_000,
  sale_calls: 200_000,
  writer_calls: 5_000,
  protection_calls: 5_000,
};

export async function saleHarness(opts: {
  origin: string;
  budget?: Partial<typeof HARNESS_BUDGET>;
  /**
   * Relaydesk correction: the business sells Relaydesk (the workflow engine) instead. 006a:
   * "quote-app" sells 7-day passes to a fictional quote web app (a labelled stand-in release),
   * served from the harness's other site (localhost instead of 127.0.0.1, the same port).
   */
  product?: "ledgerline" | "relaydesk" | "quote-app";
}) {
  const s = await saleWorld({
    product: opts.product,
    appOrigin: opts.origin.replace("//127.0.0.1", "//localhost"),
  });
  const { w } = s;
  const budget = { ...HARNESS_BUDGET, ...opts.budget };
  for (const [k, v] of Object.entries(budget))
    if (!Number.isSafeInteger(v) || v < 1)
      throw new Error(`harness budget ${k} must be a positive integer`);
  w.chain.ceiling = budget.chain_calls;
  w.reader.ceiling = budget.reader_reads;
  s.sale.ceiling = budget.sale_calls;
  w.writer.ceiling = budget.writer_calls;
  s.protection.ceiling = budget.protection_calls;
  /**
   * What running out of each double means for the person at the browser (Astra 06:28: a spent
   * writer or protection budget need not make every later read fail, so say only what it stops).
   */
  const budgetEffect = (msg: string) =>
    /sale chain ceiling/.test(msg)
      ? "The synthetic sale chain stopped answering, so later sale steps and sale reads fail."
      : /chain ceiling|reader ceiling/.test(msg)
        ? `The synthetic chain stopped answering, so later NEAR reads fail as "NEAR couldn't be read".`
        : /writer ceiling/.test(msg)
          ? "The synthetic customer writer stopped accepting submissions, so later customer uses cannot be recorded; reads may still work."
          : /protection ceiling/.test(msg)
            ? "The synthetic protection service stopped answering, so later customer documents cannot be protected or opened; other reads may still work."
            : "A synthetic test double stopped answering.";
  /** The first budget reached, named plainly: it is the test double, never NEAR or the product. */
  const exhausted: { reason: string | null; at: string | null } = { reason: null, at: null };
  const note = (e: unknown) => {
    const msg = (e as Error)?.message ?? "";
    if (/ceiling reached/.test(msg) && exhausted.reason === null) {
      exhausted.reason = msg;
      exhausted.at = new Date().toISOString();
      console.error(
        `SYNTHETIC BUDGET EXHAUSTED: ${msg}. ${budgetEffect(msg)} This is not a NEAR or product failure: restart the harness.`,
      );
    }
  };
  /** Wraps a double's entry point so a ceiling it reaches is recorded (then rethrown unchanged). */
  const watch = <O extends object, K extends keyof O>(o: O, k: K) => {
    const f = (o[k] as (...a: unknown[]) => unknown).bind(o);
    o[k] = ((...a: unknown[]) => {
      try {
        const r = f(...a);
        if (r instanceof Promise)
          return r.catch((e) => {
            note(e);
            throw e;
          });
        return r;
      } catch (e) {
        note(e);
        throw e;
      }
    }) as O[K];
  };
  watch(w.chain, "answer");
  watch(w.chain, "walletCall");
  watch(w.reader, "view");
  watch(w.writer, "openHold");
  watch(w.writer, "settleHold");
  watch(w.writer, "releaseHoldFor");
  watch(s.protection, "protect");
  // Every sale-chain method counts through its private bump(), where its ceiling throws.
  watch(s.sale as unknown as { bump: () => void }, "bump");
  const budgetReport = () => ({
    note: "Finite synthetic budgets of this harness's test doubles (not NEAR limits). When one is reached every later read fails; restart the harness.",
    exhausted,
    used: {
      chain_calls: [w.chain.calls, budget.chain_calls],
      reader_reads: [w.reader.used, budget.reader_reads],
      sale_calls: [s.sale.calls, budget.sale_calls],
      writer_calls: [w.writer.calls, budget.writer_calls],
      protection_calls: [s.protection.calls, budget.protection_calls],
    },
  });
  // The double and the server follow THIS computer's clock (the browser's), only forward.
  const time = { offset: 0 };
  const sync = () => {
    w.clock.now = Date.now() + time.offset;
    const d = BigInt(w.clock.now) - w.chain.ts;
    if (d > 0n) w.chain.tick(d);
  };
  const finalBlock = w.reader.finalBlock.bind(w.reader);
  w.reader.finalBlock = async () => {
    sync();
    return finalBlock();
  };
  // Astra 06:28: the reader's ceiling throws in finalBlock as well as view; record both.
  watch(w.reader, "finalBlock");
  sync();
  w.state.store.db
    .prepare("UPDATE businesses SET name = ?, slug = ?, published_at = ? WHERE id = ?")
    .run("Ledgerline Invoice Reader", "ledgerline", new Date().toISOString(), w.f.business);
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const accountKey = `ed25519:${base58Encode(publicKey.export({ format: "der", type: "spki" }).subarray(-32))}`;
  const store = w.state.store as Store;
  const bind = (account: string, person: string) =>
    store.db
      .prepare(
        "INSERT INTO person_accounts (account_id, person_id, network, created_at) VALUES (?, ?, 'testnet', ?) ON CONFLICT DO NOTHING",
      )
      .run(account, person, new Date().toISOString());
  bind(SELLER, w.f.ava.id);
  bind(BUYER, s.noah.id);
  bind(CUSTOMER, w.cara.id);
  const signIn = new AccountSignIn(store, {
    recipient: "everstreet.local",
    network: "testnet",
    reader: {
      isFullAccessKey: async (a, k) =>
        (SALE_ACCOUNTS as readonly string[]).includes(a) && k === accountKey,
    },
    callbackUrl: `${opts.origin}/signin/return`,
  });
  const transport = w.v3.transport;
  w.state.app = w.make(store, undefined, {
    localPreview: false,
    environment: "Review harness (synthetic)",
    identity: { mode: "verified", signIn },
    wallet: { network: "testnet", available: true, harness: HARNESS_LABEL },
  });
  const controls = {
    account: SELLER as string | null,
    cancelNext: false,
    loseNext: false,
    delayNextMs: 0,
    sent: [] as Json[],
  };
  const late = async () => {
    const ms = Math.min(Math.max(controls.delayNextMs, 0), 30_000);
    controls.delayNextMs = 0;
    if (ms) await new Promise((r) => setTimeout(r, ms));
  };
  const site = new Hono();
  site.get("/__harness/wallet.js", (c) =>
    c.body(WALLET_SCRIPT, 200, { "content-type": "text/javascript" }),
  );
  site.get("/__harness/label.js", (c) =>
    c.body(
      labelScript({
        label: `Review harness: ${HARNESS_LABEL}, synthetic sale and customer chain`,
        detail:
          "Fictional people and businesses, ephemeral keys; not a wallet or testnet evidence. The page may connect only to this harness.",
      }),
      200,
      { "content-type": "text/javascript" },
    ),
  );
  site.post("/__harness/account", (c) => c.json({ accountId: controls.account }));
  site.post("/__harness/disconnect", (c) => {
    controls.account = null;
    return c.json({ ok: true });
  });
  site.post("/__harness/sign-message", async (c) => {
    await late();
    if (controls.cancelNext) {
      controls.cancelNext = false;
      return c.json({ error: "User closed the window" }, 400);
    }
    const p = (await c.req.json()) as Json;
    if (!controls.account) return c.json({ error: "The synthetic wallet has no account." }, 400);
    const { serializeNep413 } = await import("@near-wallet-selector/core");
    const bytes = serializeNep413({
      message: String(p.message),
      recipient: String(p.recipient),
      nonce: Buffer.from(String(p.nonce), "base64"),
      callbackUrl: p.callbackUrl ?? undefined,
    });
    return c.json({
      accountId: controls.account,
      publicKey: accountKey,
      signature: sign(null, createHash("sha256").update(bytes).digest(), privateKey).toString(
        "base64",
      ),
      state: p.state ?? undefined,
    });
  });
  site.post("/__harness/tx", async (c) => {
    await late();
    sync();
    if (controls.cancelNext) {
      controls.cancelNext = false;
      return c.json({ error: "User closed the window" }, 400);
    }
    const p = (await c.req.json()) as Json;
    if (!controls.account) return c.json({ error: "The synthetic wallet has no account." }, 400);
    // Only the fictional business and its token; one action at a time; nothing else is callable.
    if (p.receiverId !== s.BUSINESS && p.receiverId !== s.TOKEN)
      return c.json(
        { error: "The synthetic wallet only calls the fictional business and its token." },
        400,
      );
    if (!Array.isArray(p.actions) || p.actions.length !== 1)
      return c.json({ error: "The synthetic wallet sends one action at a time." }, 400);
    const a = p.actions[0] as Json;
    let args: Json;
    try {
      args = JSON.parse(String(a.args)) as Json;
    } catch {
      return c.json({ error: "The synthetic wallet refused malformed arguments." }, 400);
    }
    const call = {
      receiverId: String(p.receiverId),
      methodName: String(a.methodName),
      args,
      deposit: String(a.deposit),
      gas: String(a.gas),
    };
    const supported =
      (call.receiverId === s.BUSINESS &&
        (/_guarded$/.test(call.methodName) ||
          call.methodName === "accept_sale" ||
          // A customer's own requests (Stage C browser pass): enroll a device key, open a shell.
          call.methodName === "install_key" ||
          call.methodName === "sponsor_shell")) ||
      (call.receiverId === s.TOKEN &&
        (call.methodName === "ft_transfer_call" || call.methodName === "storage_deposit"));
    if (!supported)
      return c.json(
        { error: "The synthetic wallet only sends the sale's and a customer's own requests." },
        400,
      );
    controls.sent.push({ signer: controls.account, ...call });
    let outcome: Json;
    try {
      outcome = w.chain.walletCall(controls.account, call as never);
    } catch (e) {
      return c.json({ error: `The synthetic chain refused it: ${(e as Error).message}` }, 400);
    }
    if (controls.loseNext) {
      controls.loseNext = false;
      return c.json({ error: "Synthetic: the wallet's answer was lost." }, 502);
    }
    return c.json(outcome);
  });
  site.all("/api/*", (c) => {
    sync();
    return w.state.app.fetch(c.req.raw);
  });
  // Cara, signed in through the REAL verified routes with the synthetic key (as her browser
  // would), for the customer-use control; a cookie jar of its own.
  let caraCookie = "";
  const cara = async (path: string, method = "GET", body?: unknown) => {
    const res = await w.state.app.request(path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(caraCookie ? { cookie: caraCookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const set of res.headers.getSetCookie()) caraCookie = set.split(";")[0] ?? caraCookie;
    return { status: res.status, body: (await res.json().catch(() => null)) as Json };
  };
  const caraSignIn = async () => {
    const ch = (await cara("/api/session/challenge", "POST")).body.challenge as Json;
    const digest = nep413Digest({
      message: ch.message,
      nonce: Buffer.from(ch.nonce, "base64"),
      recipient: ch.recipient,
    });
    const r = await cara("/api/session/verify", "POST", {
      account_id: CUSTOMER,
      public_key: accountKey,
      signature: sign(null, digest, privateKey).toString("base64"),
      nonce: ch.nonce,
    });
    if (r.status !== 200 && r.status !== 201) throw new Error(`customer sign-in: ${r.status}`);
  };
  let uses = 0;
  /** One complete customer use by Cara through the real customer routes. */
  const customerUse = async () => {
    if (!caraCookie) await caraSignIn();
    sync();
    const prep = await cara(`/api/customer/offers/${s.offerId}/prepare`, "POST", {
      idempotency_key: `harness-use-${String(++uses).padStart(4, "0")}`,
      input:
        opts.product === "relaydesk"
          ? RELAYDESK_REQUEST
          : opts.product === "quote-app"
            ? PASS_REQUEST
            : "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD",
    });
    if (prep.status !== 201)
      return { status: prep.status, code: prep.body?.code ?? null, unit: null };
    const id = prep.body.use.id as string;
    await cara(`/api/customer/uses/${id}/confirm`, "POST", w.signed(prep.body.use.envelope));
    await cara(`/api/customer/uses/${id}/execute`, "POST", {});
    let unit = "";
    for (let i = 0; i < 3 && unit !== "charged"; i++)
      unit = (await cara(`/api/customer/uses/${id}/units/reconcile`, "POST")).body.use.units.unit;
    return { status: 201, code: null, unit, id };
  };
  return {
    site,
    controls,
    world: s,
    accountKey,
    transport,
    sync,
    time,
    customerUse,
    budget: budgetReport,
  };
}

/** The control listener (a SEPARATE origin; no control route exists in the app). */
export function saleControl(h: Awaited<ReturnType<typeof saleHarness>>) {
  const s = h.world;
  const control = new Hono();
  // The test doubles' finite budgets: what was used, and the first one reached (if any).
  control.get("/budget", (c) => c.json(h.budget()));
  control.get("/", (c) =>
    c.json({
      budget: h.budget(),
      controls: h.controls,
      business: s.biz,
      sale_page: `/sales/${s.biz}`,
      customer_page: `/use/${s.offerId}`,
      contract: s.sale.controlView(),
      treasury: s.sale.treasuryView(),
      owner_here: (
        s.w.state.store.db
          .prepare("SELECT owner_id FROM businesses WHERE id = ?")
          .get(s.biz) as Json
      )?.owner_id,
    }),
  );
  control.get("/history", (c) => {
    const account = c.req.query("account");
    const all = walletHistory(s.w.chain.txs as Map<string, Json>);
    return c.json({
      note: "Synthetic wallet activity (fictional): each transaction's ID, signer, receiver, method and its own status. Not whether a sale step succeeded.",
      transactions: account ? all.filter((t) => t.signer === account) : all,
    });
  });
  const flag = (name: "cancelNext" | "loseNext") => (c: { json: (v: unknown) => Response }) => {
    h.controls[name] = true;
    return c.json({ [name]: true });
  };
  control.post("/cancel-next", flag("cancelNext"));
  control.post("/lose-next", flag("loseNext"));
  control.post("/delay-next/:ms", (c) => {
    const ms = Number(c.req.param("ms"));
    if (!Number.isInteger(ms) || ms < 0 || ms > 30_000)
      return c.json({ error: "0 to 30000 ms" }, 400);
    h.controls.delayNextMs = ms;
    return c.json({ delay_next_ms: ms });
  });
  control.post("/account/:id", (c) => {
    h.controls.account = c.req.param("id");
    return c.json({ account: h.controls.account });
  });
  // From now on the business answers like an older contract without the sale capability.
  control.post("/older-contract", (c) => {
    s.sale.saleTerms = false;
    return c.json({ sale_terms: false });
  });
  control.post("/newer-contract", (c) => {
    s.sale.saleTerms = true;
    return c.json({ sale_terms: true });
  });
  // Job 003wf4 (Set up customer access): open the setup steps and set the states to review.
  // Retires the world's customer offer (the plan and offer steps then need the founder).
  control.post("/access/retire-offer", (c) => {
    s.w.state.store.db
      .prepare("UPDATE customer_offers SET state = 'retired' WHERE id = ? AND state = 'active'")
      .run(s.offerId);
    return c.json({ offer: s.offerId, state: "retired" });
  });
  // The platform's operator slot: none, support only, or metering (this generation).
  control.post("/access/operator/:slot", (c) => {
    const slot = c.req.param("slot");
    const caps = slot === "support" ? 2 : slot === "metering" ? 1 : slot === "none" ? 0 : -1;
    if (caps < 0) return c.json({ error: "none, support or metering" }, 400);
    s.sale.operators = Array(8).fill(null);
    if (caps) s.sale.operators[0] = { account: OPERATOR, caps, generation: s.sale.generation };
    return c.json({ operator: OPERATOR, caps });
  });
  // The business answers with / without the guided plan capability (get_plan_terms).
  control.post("/access/guided/:on", (c) => {
    s.sale.planTerms = c.req.param("on") === "on";
    return c.json({ plan_terms: s.sale.planTerms });
  });
  control.post("/fail-next-payout", (c) => {
    s.sale.failPayouts = 1;
    return c.json({ fail_next_payout: true });
  });
  // Moves the synthetic chain's clock forward (e.g. past an offer's expiry); never back.
  control.post("/advance/:minutes", (c) => {
    const m = Number(c.req.param("minutes"));
    if (!Number.isInteger(m) || m < 1 || m > 60 * 24 * 31)
      return c.json({ error: "1 to 44640 minutes" }, 400);
    h.time.offset += m * 60_000;
    h.sync();
    return c.json({ chain_now: new Date(Number(s.w.chain.ts)).toISOString() });
  });
  // One complete customer use by Cara through the real customer routes (raises `available`).
  control.post("/customer-use", async (c) => {
    return c.json(await h.customerUse());
  });
  // The observation transport down / up (a failed reconciliation read, then recovery).
  control.post("/observations/down", (c) => {
    s.w.v3.transport = null;
    return c.json({ observations: "down" });
  });
  control.post("/observations/up", (c) => {
    s.w.v3.transport = h.transport;
    return c.json({ observations: "up" });
  });
  return control;
}
