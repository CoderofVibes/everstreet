// Permissions review 3 (Nov 7, evening): one sale world with the intents verifier and the two
// companions attached, the app remade with their bindings. Everything synthetic: the sale double,
// a verifier double, a second test token, Everstreet's solver with a throwaway key, and the
// buyer's own throwaway ed25519 signing key for NEP-413. Helpers run the deal and the intents flow
// through the real routes only; the wallet applies exactly the calls it is given.

import { sign as edSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { nep413Digest } from "../../src/identity.ts";
import { toB58 } from "../../src/lightClient.ts";
import { attachCompanions } from "../companion-chain.ts";
import type { Json } from "../customer-world.ts";
import { ALT_TOKEN, attachIntents, VERIFIER } from "../intents-chain.ts";
import { BUYER, PRICE, proposal, type SaleWorld, SELLER, saleWorld } from "../sale-world.ts";

export const FEED = "feed.synthetic.near";
export const BUDGET = "budget.synthetic.near";
export const GAS = "100000000000000";
/** 250 TUSD at 5/4: what the buyer gives in tALT for one quote. */
export const GIVE = String((BigInt(PRICE) * 5n + 3n) / 4n);

export type Caller = SaleWorld["ava"];

export async function reviewWorld(o: { solverFloat?: bigint; companions?: boolean } = {}) {
  const sw = await saleWorld();
  const { w, sale, biz, ava, noah, stranger, wallet, act } = sw;
  const clock = { now: Date.now() };
  const chain = w.chain as unknown as {
    balances: Map<string, bigint>;
    tokenRegistered: Set<string>;
    business: string;
  };
  const intents = attachIntents(
    w.chain,
    { token: sw.TOKEN, ledger: { balances: chain.balances, registered: chain.tokenRegistered } },
    o.solverFloat ?? 5_000_000_000n,
  );
  intents.verifier.now = () => clock.now;
  intents.alt.ledger.balances.set(BUYER, 2_000_000_000n);
  intents.alt.ledger.registered.add(BUYER);
  const companions =
    o.companions === false
      ? null
      : attachCompanions(
          w.chain,
          chain.business,
          () => {
            const c = sale.controlView() as Json;
            return {
              owner: String(c.owner),
              generation: Number(c.generation),
              control_seq: String(c.control_seq),
            };
          },
          { asset: FEED, allowance: BUDGET, token: sw.TOKEN },
        );
  if (companions) {
    companions.allowance.fund(60_000_000n);
    companions.allowance.walletCall(SELLER, {
      methodName: "grant",
      args: {
        agent: "agent.synthetic.near",
        suppliers: ["supplier.synthetic.near"],
        per_payment: "2000000",
        per_period: "60000000",
        period_ms: "604800000",
        review_above: "5000000",
      },
      gas: "1",
      deposit: "0",
    });
  }
  const remake = () => {
    w.state.app = w.make(w.state.store, undefined, {
      companions: companions
        ? {
            bindings: [
              { business_id: biz, asset: { account: FEED }, allowance: { account: BUDGET } },
            ],
            evm: companions.evm,
          }
        : undefined,
      intents: {
        bindings: [
          {
            business_id: biz,
            network: "testnet",
            account: chain.business,
            asset: sw.TOKEN,
            verifier: VERIFIER,
            offers: [
              { token: ALT_TOKEN, symbol: "tALT", decimals: 6, rate_num: "5", rate_den: "4" },
            ],
          },
        ],
        solver: intents.solver,
        now: () => clock.now,
      },
    });
  };
  remake();

  // The buyer's throwaway NEP-413 signing key (a wallet's).
  const keyOf = () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
    return { priv: privateKey as KeyObject, pub: `ed25519:${toB58(Uint8Array.from(raw))}` };
  };
  const buyerKey = keyOf();

  const confirmed = (r: Awaited<ReturnType<typeof act>>) =>
    (r.check?.body as Json)?.resolution?.kind === "confirmed";
  const must = async (what: string, p: ReturnType<typeof act>) => {
    const r = await p;
    if (!confirmed(r))
      throw new Error(
        `${what}: ${JSON.stringify(r.p.status !== 200 ? r.p.body : (r.created?.body ?? r.check?.body))}`,
      );
    return r;
  };

  const deal = {
    propose: (terms: Record<string, unknown> = {}) =>
      must("propose", act(ava, SELLER, "propose", { ...proposal(terms as never), ...terms })),
    revise: (terms: Record<string, unknown> = {}) =>
      must("revise", act(ava, SELLER, "revise", { ...proposal(terms as never), ...terms })),
    /** The seller accepts with their wallet directly, outside Everstreet's routes. */
    acceptSellerDirect: () => {
      const d = sale.controlView().live_deal as Json;
      return wallet(SELLER, {
        receiverId: chain.business,
        methodName: "accept_sale",
        args: { deal_seq: d.seq, version: d.version, digest: d.digest },
        gas: GAS,
        deposit: "1",
      });
    },
    registerBuyer: () => must("register", act(noah, BUYER, "register")),
    fund: () => must("fund", act(noah, BUYER, "fund")),
    acceptBuyer: () => must("accept (buyer)", act(noah, BUYER, "accept")),
    acceptSeller: () => must("accept (seller)", act(ava, SELLER, "accept")),
    cancelSeller: () => must("cancel", act(ava, SELLER, "cancel")),
    expire: (who: Caller = ava, account = SELLER) => must("expire", act(who, account, "expire")),
    /** The buyer's escrow is funded the ordinary way and the sale closes (both accept). */
    close: async () => {
      await deal.registerBuyer().catch(() => null);
      await deal.fund();
      await deal.acceptBuyer();
      return deal.acceptSeller();
    },
  };

  const intentsApi = {
    panel: (who: Caller = noah) => who(`/api/sales/${biz}/intents`),
    quote: (who: Caller = noah, token = ALT_TOKEN) =>
      who(`/api/sales/${biz}/intents/quote`, "POST", { token }),
    status: (id: string, who: Caller = noah) => who(`/api/intents/${id}`),
    deposit: (amount = GIVE, account = BUYER) =>
      wallet(account, {
        receiverId: ALT_TOKEN,
        methodName: "ft_transfer_call",
        args: { receiver_id: VERIFIER, amount, msg: "" },
        gas: GAS,
        deposit: "1",
      }),
    registerKey: (key = buyerKey, account = BUYER) =>
      wallet(account, {
        receiverId: VERIFIER,
        methodName: "add_public_key",
        args: { public_key: key.pub },
        gas: GAS,
        deposit: "1",
      }),
    signature: (f: Json, key = buyerKey) => {
      const digest = nep413Digest({
        message: String(f.sign.message),
        nonce: Buffer.from(String(f.sign.nonce), "base64"),
        recipient: String(f.sign.recipient),
      });
      return { public_key: key.pub, signature: edSign(null, digest, key.priv).toString("base64") };
    },
    sign: (f: Json, who: Caller = noah, key = buyerKey) =>
      who(`/api/intents/${f.id}/sign`, "POST", intentsApi.signature(f, key)),
    withdraw: (amount = PRICE, account = BUYER) =>
      wallet(account, {
        receiverId: VERIFIER,
        methodName: "ft_withdraw",
        args: { token: sw.TOKEN, receiver_id: account, amount },
        gas: GAS,
        deposit: "1",
      }),
    inside: (account: string, token: string) =>
      intents.verifier.inside.get(account)?.get(`nep141:${token}`) ?? 0n,
  };

  const companionsApi = {
    view: (who: Caller) => who(`/api/companions/${biz}`),
    prepare: (who: Caller, kind: string, input: Json = {}) =>
      who(`/api/companions/${biz}/prepare`, "POST", { kind, input }),
    sent: (who: Caller, id: string, tx: string) =>
      who(`/api/companions/actions/${id}/sent`, "POST", { tx_hash: tx }),
    config: (who: Caller, id = biz) => who(`/api/businesses/${id}/companions`),
    economics: (who: Caller, id = biz) => who(`/api/sales/${id}/economics`),
  };

  /** A signed-out request (no cookie). */
  const anon = async (path: string, method = "GET", body?: unknown) => {
    const res = await w.state.app.request(path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined || method === "GET" ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Json };
  };

  /** One watcher pass (what main.ts runs every 15 seconds). */
  const watcherPass = () =>
    (
      w.state.app as unknown as { reconcileRecordedSales: () => Promise<unknown> }
    ).reconcileRecordedSales();

  return {
    ...sw,
    clock,
    intents,
    companions,
    remake,
    keyOf,
    buyerKey,
    deal,
    i: intentsApi,
    c: companionsApi,
    anon,
    watcherPass,
    confirmed,
    SELLER,
    BUYER,
    PRICE,
    ALT_TOKEN,
    VERIFIER,
    stranger,
  };
}

export type ReviewWorld = Awaited<ReturnType<typeof reviewWorld>>;
