// Permissions review 2 (Nov 7 2026): one world for the review's tests. The sale world (customer
// routes, the sale half of the synthetic contract, the v3 observation transport) with the
// companions (external asset, supplier allowance) and the intents verifier, second token and
// solver attached, and the app remade with those configured. Synthetic, fictional, no network.

import { createHash, generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { nep413Digest } from "../../src/identity.ts";
import { toB58 } from "../../src/lightClient.ts";
import { attachCompanions } from "../companion-chain.ts";
import { type Json, TOKEN } from "../customer-world.ts";
import { ALT_TOKEN, attachIntents, SOLVER, VERIFIER } from "../intents-chain.ts";
import { BUYER, PRICE, proposal, type SaleWorld, SELLER, saleWorld } from "../sale-world.ts";

export { ALT_TOKEN, BUYER, PRICE, proposal, SELLER, SOLVER, VERIFIER };

export const FEED = "feed.synthetic.near";
export const BUDGET = "budget.synthetic.near";
export const AGENT = "agent.synthetic.near";
export const SUPPLIER = "supplier.synthetic.near";

export type Caller = SaleWorld["ava"];

/** An ed25519 key a wallet would sign NEP-413 payloads with (throwaway, fictional). */
export function nearKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return {
    privateKey,
    publicKey: `ed25519:${toB58(Uint8Array.from(raw))}`,
    sign: (digest: Buffer) => sign(null, digest, privateKey as KeyObject).toString("base64"),
  };
}

export async function reviewWorld(opts: { product?: "ledgerline" | "relaydesk" } = {}) {
  const s = await saleWorld({ product: opts.product });
  const { w } = s;
  const sale = s.sale;
  const control = () => {
    const c = sale.controlView() as Json;
    return {
      owner: String(c.owner),
      generation: Number(c.generation),
      control_seq: String(c.control_seq),
    };
  };
  const companions = attachCompanions(w.chain, s.BUSINESS, control, {
    asset: FEED,
    allowance: BUDGET,
    token: TOKEN,
  });
  companions.allowance.fund(60_000_000n);
  companions.allowance.walletCall(SELLER, {
    methodName: "grant",
    args: {
      agent: AGENT,
      suppliers: [SUPPLIER],
      per_payment: "2000000",
      per_period: "60000000",
      period_ms: "604800000",
      review_above: "5000000",
    },
    gas: "1",
    deposit: "0",
  });
  const intents = attachIntents(
    w.chain,
    { token: TOKEN, ledger: { balances: w.chain.balances, registered: w.chain.tokenRegistered } },
    5_000_000_000n,
  );
  intents.alt.ledger.balances.set(BUYER, 2_000_000_000n);
  intents.alt.ledger.registered.add(BUYER);
  const intentsBinding = {
    business_id: s.biz,
    network: "testnet",
    account: s.BUSINESS,
    asset: TOKEN,
    verifier: VERIFIER,
    offers: [{ token: ALT_TOKEN, symbol: "tALT", decimals: 6, rate_num: "5", rate_den: "4" }],
  };
  const extra = {
    companions: {
      bindings: [{ business_id: s.biz, asset: { account: FEED }, allowance: { account: BUDGET } }],
      evm: companions.evm,
    },
    intents: { bindings: [intentsBinding], solver: intents.solver },
  };
  w.state.app = w.make(w.state.store, undefined, extra);

  /** The buyer's tALT deposit into the verifier (its own wallet). */
  const deposit = (amount: string) =>
    s.wallet(BUYER, {
      receiverId: ALT_TOKEN,
      methodName: "ft_transfer_call",
      args: { receiver_id: VERIFIER, amount, msg: "" },
      deposit: "1",
      gas: "100000000000000",
    });
  /** The buyer registers a signing key with the verifier (its own wallet). */
  const registerKey = (account: string, publicKey: string) =>
    s.wallet(account, {
      receiverId: VERIFIER,
      methodName: "add_public_key",
      args: { public_key: publicKey },
      deposit: "1",
      gas: "30000000000000",
    });
  /** The buyer's NEP-413 signature over a quote's message (what its wallet would sign). */
  const signQuote = (key: ReturnType<typeof nearKey>, q: Json) => {
    const s = (q as { sign: { message: string; nonce: string; recipient: string } }).sign;
    return key.sign(
      nep413Digest({
        message: s.message,
        nonce: Buffer.from(s.nonce, "base64"),
        recipient: s.recipient,
      }),
    );
  };
  const quote = (who: Caller, token = ALT_TOKEN) =>
    who(`/api/sales/${s.biz}/intents/quote`, "POST", { token });
  const signIntent = (who: Caller, id: string, body: Json) =>
    who(`/api/intents/${id}/sign`, "POST", body);

  /** Propose (seller) and register (buyer): a live deal, unfunded. */
  const proposeAndRegister = async (over: Json = {}) => {
    const p = await s.act(s.ava, SELLER, "propose", proposal(over));
    if (p.check?.body.resolution?.kind !== "confirmed")
      throw new Error(`propose: ${JSON.stringify(p.p.body ?? p.created?.body)}`);
    const r = await s.act(s.noah, BUYER, "register");
    if (r.check?.body.resolution?.kind !== "confirmed")
      throw new Error(`register: ${JSON.stringify(r.check?.body ?? r.created?.body ?? r.p.body)}`);
  };
  /** Fund (buyer), accept (buyer), accept (seller): the sale closes and is applied here. */
  const fundAndClose = async () => {
    for (const [who, account, kind] of [
      [s.noah, BUYER, "fund"],
      [s.noah, BUYER, "accept"],
      [s.ava, SELLER, "accept"],
    ] as const) {
      const r = await s.act(who, account, kind);
      if (r.check?.body.resolution?.kind !== "confirmed")
        throw new Error(`${kind}: ${JSON.stringify(r.check?.body ?? r.created?.body ?? r.p.body)}`);
    }
  };

  const solverFloat = () => intents.verifier.inside.get(SOLVER)?.get(`nep141:${TOKEN}`) ?? 0n;
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  return {
    ...s,
    dana: w.dana as Caller,
    companions,
    intents,
    control,
    deposit,
    registerKey,
    signQuote,
    quote,
    signIntent,
    proposeAndRegister,
    fundAndClose,
    solverFloat,
    sha,
    FEED,
    BUDGET,
    AGENT,
    SUPPLIER,
  };
}

export type ReviewWorld = Awaited<ReturnType<typeof reviewWorld>>;
