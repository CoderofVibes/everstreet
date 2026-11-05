// Job 003wf2 test world: the customer world (real app, routes, customer runtime and writer) with
// the sale half of the SAME synthetic state attached (customer-world.ts FixtureChain.attachSale,
// sale-chain.ts). The v3 observation transport reads that same state. People: Ava (the founder,
// founder.near, owner here and on the contract), Noah (a buyer, buyer.near, holding his own
// fictional test tokens), Cara (a customer with 100 prepaid uses). Wallet transactions are applied
// to the double exactly as a wallet would send them (`wallet`), never as state edits.

import {
  BUSINESS,
  customerWorld,
  type Json,
  OPERATOR,
  SyntheticProtection,
  TOKEN,
} from "./customer-world.ts";

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

export async function saleWorld(opts: { dbPath?: string } = {}) {
  const protection = new SyntheticProtection();
  const w = await customerWorld({
    dbPath: opts.dbPath,
    customer: { protection },
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
  const offerId = await w.offer();
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
      input: INVOICE,
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
