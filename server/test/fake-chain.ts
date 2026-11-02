// An in-memory stand-in for NEAR testnet with the v2 contract's money rules (contracts/
// business-v2, tested on a real node in its sandbox test). Used only by platform tests.

import { createHash } from "node:crypto";
import type {
  Chain,
  ChainDeal,
  ChainOrder,
  Control,
  Period,
  Rules,
  Treasury,
  TxResult,
} from "../src/chain.ts";

interface Biz {
  owner: string;
  operators: Map<string, string[]>;
  rules: Rules;
  orders: Map<string, ChainOrder>;
  unearned: bigint;
  available: bigint;
  earned: bigint;
  refunds: bigint;
  withdrawn: bigint;
  ordersIn: bigint;
  generation: number;
  deals: Map<string, ChainDeal["deal"]>;
  dealHolds: bigint;
  proceeds: Map<string, bigint>;
  proceedsTotal: bigint;
}

export class FakeChain implements Chain {
  readonly network = "fake";
  readonly token = "tusd.fake";
  readonly decimals = 6;
  readonly explorer = "https://explorer.fake";
  balances = new Map<string, bigint>();
  businesses = new Map<string, Biz>();
  /** Set to make the next payOrder throw after (or before) the money moves. */
  dropNextReply: "after-payment" | "before-payment" | null = null;
  private n = 0;

  private tx(): string {
    this.n += 1;
    return `TX${this.n}`;
  }

  async createPersonAccount(label: string) {
    const id = `p-${label.toLowerCase().replace(/[^a-z]+/g, "-")}-${this.n}.fake`;
    this.balances.set(id, 200_000_000n);
    return { account_id: id, secret: "ed25519:fake", tx: this.tx() };
  }

  async createBusinessAccount(input: { label: string; name: string; owner: string; rules: Rules }) {
    const id = `b-${input.label}-${this.n}.fake`;
    this.balances.set(id, 0n);
    this.businesses.set(id, {
      operators: new Map(),
      owner: input.owner,
      rules: input.rules,
      orders: new Map(),
      unearned: 0n,
      available: 0n,
      earned: 0n,
      refunds: 0n,
      withdrawn: 0n,
      ordersIn: 0n,
      generation: 1,
      deals: new Map(),
      dealHolds: 0n,
      proceeds: new Map(),
      proceedsTotal: 0n,
    });
    return { account_id: id, tx: this.tx() };
  }

  async payOrder(input: {
    payer: string;
    secret: string;
    business: string;
    orderId: string;
    amount: string;
    offer: string;
    cancelBeforeMs: number;
  }): Promise<TxResult> {
    if (this.dropNextReply === "before-payment") {
      this.dropNextReply = null;
      throw new Error("connection dropped");
    }
    const amount = BigInt(input.amount);
    const b = this.businesses.get(input.business);
    const bal = this.balances.get(input.payer) ?? 0n;
    if (!b || bal < amount) return { ok: false, hash: this.tx(), error: "E_FUNDS" };
    // A repeated order id: the token gets the money back.
    if (!b.orders.has(input.orderId)) {
      this.balances.set(input.payer, bal - amount);
      this.balances.set(input.business, (this.balances.get(input.business) ?? 0n) + amount);
      b.orders.set(input.orderId, {
        customer: input.payer,
        amount: input.amount,
        offer: input.offer,
        status: "Paid",
        paid_at_ms: String(Date.now()),
        cancel_before_ms: String(input.cancelBeforeMs),
      });
      b.unearned += amount;
      b.ordersIn += amount;
    }
    if (this.dropNextReply === "after-payment") {
      this.dropNextReply = null;
      throw new Error("connection dropped");
    }
    return { ok: true, hash: this.tx() };
  }

  async getOrder(business: string, orderId: string) {
    return this.businesses.get(business)?.orders.get(orderId) ?? null;
  }

  async cancelOrder(input: {
    customer: string;
    secret: string;
    business: string;
    orderId: string;
  }): Promise<TxResult> {
    const b = this.businesses.get(input.business);
    const o = b?.orders.get(input.orderId);
    if (!b || !o || o.customer !== input.customer || o.status !== "Paid")
      return { ok: false, hash: this.tx(), error: "E_STATE" };
    if (!b.rules.customer_cancel_refund || Date.now() >= Number(o.cancel_before_ms))
      return { ok: false, hash: this.tx(), error: "E_DEADLINE" };
    const amount = BigInt(o.amount);
    o.status = "Refunded";
    b.unearned -= amount;
    b.refunds += amount;
    this.balances.set(input.business, (this.balances.get(input.business) ?? 0n) - amount);
    this.balances.set(o.customer, (this.balances.get(o.customer) ?? 0n) + amount);
    return { ok: true, hash: this.tx() };
  }

  async deliver(input: {
    owner: string;
    secret: string;
    business: string;
    orderId: string;
  }): Promise<TxResult> {
    const b = this.businesses.get(input.business);
    const o = b?.orders.get(input.orderId);
    if (!b || (b.owner !== input.owner && !b.operators.get(input.owner)?.includes("fulfillment")))
      return {
        ok: false,
        hash: this.tx(),
        error: `Smart contract panicked: E_NOT_AUTHORIZED: ${input.owner} may not use fulfillment: not an operator`,
      };
    if (o?.status !== "Paid") return { ok: false, hash: this.tx(), error: "E_STATE" };
    o.status = "Delivered";
    b.unearned -= BigInt(o.amount);
    b.available += BigInt(o.amount);
    b.earned += BigInt(o.amount);
    return { ok: true, hash: this.tx() };
  }

  async withdrawProfit(input: {
    owner: string;
    secret: string;
    business: string;
    amount: string;
  }): Promise<TxResult> {
    const b = this.businesses.get(input.business);
    const amount = BigInt(input.amount);
    if (!b || b.owner !== input.owner) return { ok: false, hash: this.tx(), error: "E_NOT_OWNER" };
    const withdrawable = b.available - BigInt(b.rules.min_reserve);
    if (amount > withdrawable)
      return {
        ok: false,
        hash: this.tx(),
        error: `Smart contract panicked: E_RESERVED: ${withdrawable} can be withdrawn`,
      };
    b.available -= amount;
    b.withdrawn += amount;
    this.balances.set(input.business, (this.balances.get(input.business) ?? 0n) - amount);
    this.balances.set(input.owner, (this.balances.get(input.owner) ?? 0n) + amount);
    return { ok: true, hash: this.tx() };
  }

  async treasury(business: string): Promise<Treasury> {
    const b = this.businesses.get(business);
    if (!b) throw new Error("no business");
    const reserve = BigInt(b.rules.min_reserve);
    return {
      held: String(this.balances.get(business) ?? 0n),
      customer_credit: "0",
      unearned_orders: String(b.unearned),
      available: String(b.available),
      withdrawable: String(b.available > reserve ? b.available - reserve : 0n),
      pending_payouts: "0",
      deal_holds: String(b.dealHolds),
      seller_proceeds: String(b.proceedsTotal),
    };
  }

  /**
   * Job 003f: explicit monthly ledgers per business account (base units). A business with any
   * entry here answers from them (zeros for months not listed). Otherwise the live counters
   * belong to the current month, where test activity happens, and other months are zero.
   */
  periods = new Map<string, Map<number, Partial<Period>>>();
  /** Months whose read fails, as an RPC outage would. */
  failPeriods = new Set<number>();

  setPeriod(business: string, yyyymm: number, p: Partial<Period>) {
    const m = this.periods.get(business) ?? new Map<number, Partial<Period>>();
    m.set(yyyymm, p);
    this.periods.set(business, m);
  }

  async period(business: string, yyyymm?: number): Promise<Period> {
    const b = this.businesses.get(business);
    if (!b) throw new Error("no business");
    if (yyyymm !== undefined && this.failPeriods.has(yyyymm))
      throw new Error(`RPC unavailable for ${yyyymm}`);
    const zero: Period = {
      orders_in: "0",
      prepaid_in: "0",
      earned: "0",
      refunds: "0",
      credit_used: "0",
      credit_withdrawn: "0",
      owner_withdrawals: "0",
      sale_proceeds: "0",
    };
    const fixtures = this.periods.get(business);
    if (fixtures && yyyymm !== undefined) return { ...zero, ...(fixtures.get(yyyymm) ?? {}) };
    const now = new Date();
    const current = now.getUTCFullYear() * 100 + now.getUTCMonth() + 1;
    if (yyyymm !== undefined && yyyymm !== current) return zero;
    return {
      orders_in: String(b.ordersIn),
      prepaid_in: "0",
      earned: String(b.earned),
      refunds: String(b.refunds),
      credit_used: "0",
      credit_withdrawn: "0",
      owner_withdrawals: String(b.withdrawn),
      sale_proceeds: "0",
    };
  }

  async tokenBalance(account: string) {
    return String(this.balances.get(account) ?? 0n);
  }

  async faucet(account: string, amount: string): Promise<TxResult> {
    this.balances.set(account, (this.balances.get(account) ?? 0n) + BigInt(amount));
    return { ok: true, hash: this.tx() };
  }

  async appointOperator(input: {
    owner: string;
    secret: string;
    business: string;
    operator: string;
    capabilities: string[];
  }): Promise<TxResult> {
    const b = this.businesses.get(input.business);
    if (!b || b.owner !== input.owner) return { ok: false, hash: this.tx(), error: "E_NOT_OWNER" };
    b.operators.set(input.operator, input.capabilities);
    return { ok: true, hash: this.tx() };
  }

  async revokeOperator(input: {
    owner: string;
    secret: string;
    business: string;
    operator: string;
  }): Promise<TxResult> {
    const b = this.businesses.get(input.business);
    if (!b || b.owner !== input.owner || !b.operators.delete(input.operator))
      return { ok: false, hash: this.tx(), error: "E_ARGS" };
    return { ok: true, hash: this.tx() };
  }

  async operatorCheck(business: string, account: string, capability: string) {
    const b = this.businesses.get(business);
    if (!b) throw new Error("no business");
    const generation = b.generation;
    if (account === b.owner)
      return { authorized: true, owner: b.owner, generation, reason: "owner" };
    const caps = b.operators.get(account);
    if (!caps) return { authorized: false, owner: b.owner, generation, reason: "not an operator" };
    return {
      authorized: caps.includes(capability),
      owner: b.owner,
      generation,
      reason: caps.includes(capability)
        ? `operator with ${capability}`
        : `not granted ${capability}`,
    };
  }

  // ---------- the two-party sale, with the contract's rules ----------

  /** Set to make the next proceeds payout fail in its callback (the contract restores it). */
  failNextPayout = false;

  private fail(error: string): TxResult {
    return { ok: false, hash: this.tx(), error: `Smart contract panicked: ${error}` };
  }

  private digest(business: string, id: string, d: ChainDeal["deal"]) {
    return createHash("sha256")
      .update(
        `business-deal/v2|${business}|${id}|${d.version}|${d.seller}|${d.buyer}|${d.price}|${d.expires_at_ms}|${d.terms_hash}|${d.expected_generation}`,
      )
      .digest("hex");
  }

  async proposeSale(input: {
    owner: string;
    secret: string;
    business: string;
    dealId: string;
    buyer: string;
    amount: string;
    expiresAtMs: number;
    termsHash: string;
  }): Promise<TxResult> {
    const b = this.businesses.get(input.business);
    if (!b || b.owner !== input.owner)
      return this.fail("E_NOT_OWNER: only the owner may propose a sale");
    if (b.deals.has(input.dealId)) return this.fail("E_ARGS: deal id already used");
    b.deals.set(input.dealId, {
      seller: input.owner,
      buyer: input.buyer,
      price: input.amount,
      expires_at_ms: String(input.expiresAtMs),
      terms_hash: input.termsHash,
      expected_generation: b.generation,
      version: 1,
      seller_accepted: null,
      buyer_accepted: null,
      held: "0",
      status: "Open",
      closed_at_ms: null,
    });
    return { ok: true, hash: this.tx() };
  }

  async reviseSale(input: {
    owner: string;
    secret: string;
    business: string;
    dealId: string;
    amount: string;
    expiresAtMs: number;
    termsHash: string;
  }): Promise<TxResult> {
    const d = this.businesses.get(input.business)?.deals.get(input.dealId);
    if (d?.status !== "Open") return this.fail("E_STATE: the deal is not open");
    if (d.seller !== input.owner) return this.fail("E_NOT_SELLER: only the seller revises terms");
    Object.assign(d, {
      price: input.amount,
      expires_at_ms: String(input.expiresAtMs),
      terms_hash: input.termsHash,
      version: d.version + 1,
      seller_accepted: null,
      buyer_accepted: null,
    });
    return { ok: true, hash: this.tx() };
  }

  /** Like ft_transfer_call: if the contract refuses, the token refunds and nothing moves. */
  async fundDeal(input: {
    buyer: string;
    secret: string;
    business: string;
    dealId: string;
    amount: string;
  }): Promise<TxResult> {
    const b = this.businesses.get(input.business);
    const d = b?.deals.get(input.dealId);
    const amount = BigInt(input.amount);
    const bal = this.balances.get(input.buyer) ?? 0n;
    if (
      !b ||
      !d ||
      d.status !== "Open" ||
      d.buyer !== input.buyer ||
      d.held !== "0" ||
      input.amount !== d.price ||
      bal < amount
    )
      return {
        ok: true,
        hash: this.tx(),
        error: "Smart contract panicked: E_FUNDS: refunded by the token",
      };
    this.balances.set(input.buyer, bal - amount);
    this.balances.set(input.business, (this.balances.get(input.business) ?? 0n) + amount);
    d.held = input.amount;
    b.dealHolds += amount;
    return { ok: true, hash: this.tx() };
  }

  async acceptSale(input: {
    party: string;
    secret: string;
    business: string;
    dealId: string;
    digest: string;
  }): Promise<TxResult> {
    const b = this.businesses.get(input.business);
    const d = b?.deals.get(input.dealId);
    if (!b || !d || d.status !== "Open") return this.fail("E_STATE: the deal is not open");
    if (Date.now() >= Number(d.expires_at_ms)) return this.fail("E_EXPIRED: the offer has expired");
    if (d.expected_generation !== b.generation || d.seller !== b.owner)
      return this.fail("E_GENERATION: control changed since these terms were proposed");
    const current = this.digest(input.business, input.dealId, d);
    if (input.digest !== current)
      return this.fail("E_TERMS: these are not the current terms; read the deal again");
    if (input.party === d.seller) d.seller_accepted = current;
    else if (input.party === d.buyer) {
      if (d.held !== d.price)
        return this.fail("E_FUNDS: fund the deal with the exact price before accepting");
      d.buyer_accepted = current;
    } else return this.fail("E_NOT_PARTY: only the seller or the buyer accepts");
    if (d.seller_accepted === current && d.buyer_accepted === current) {
      const price = BigInt(d.price);
      d.held = "0";
      b.dealHolds -= price;
      b.proceeds.set(d.seller, (b.proceeds.get(d.seller) ?? 0n) + price);
      b.proceedsTotal += price;
      b.owner = d.buyer;
      b.generation += 1;
      d.status = "Closed";
      d.closed_at_ms = String(Date.now());
      b.operators.clear();
      for (const [id, other] of b.deals)
        if (id !== input.dealId && other.status === "Open") other.status = "Void";
    }
    return { ok: true, hash: this.tx() };
  }

  async cancelSale(input: {
    party: string;
    secret: string;
    business: string;
    dealId: string;
  }): Promise<TxResult> {
    const d = this.businesses.get(input.business)?.deals.get(input.dealId);
    if (d?.status !== "Open") return this.fail("E_STATE: the deal is not open");
    if (input.party !== d.seller && input.party !== d.buyer) return this.fail("E_NOT_PARTY");
    d.status = "Cancelled";
    return { ok: true, hash: this.tx() };
  }

  async withdrawDealHold(input: {
    buyer: string;
    secret: string;
    business: string;
    dealId: string;
  }): Promise<TxResult> {
    const b = this.businesses.get(input.business);
    const d = b?.deals.get(input.dealId);
    if (!b || !d || d.buyer !== input.buyer) return this.fail("E_NOT_PARTY");
    if (d.status === "Closed")
      return this.fail("E_STATE: the sale closed; the hold paid the seller");
    const amount = BigInt(d.held);
    if (amount === 0n) return this.fail("E_FUNDS: nothing held");
    d.held = "0";
    d.buyer_accepted = null;
    b.dealHolds -= amount;
    this.balances.set(input.business, (this.balances.get(input.business) ?? 0n) - amount);
    this.balances.set(input.buyer, (this.balances.get(input.buyer) ?? 0n) + amount);
    return { ok: true, hash: this.tx() };
  }

  async claimProceeds(input: {
    seller: string;
    secret: string;
    business: string;
  }): Promise<TxResult> {
    const b = this.businesses.get(input.business);
    const p = b?.proceeds.get(input.seller) ?? 0n;
    if (!b || p === 0n) return this.fail("E_FUNDS: no sale proceeds to claim");
    if (this.failNextPayout) {
      this.failNextPayout = false;
      // The transaction succeeds; the token transfer fails and the callback restores proceeds.
      return { ok: true, hash: this.tx(), error: "Smart contract panicked: transfer failed" };
    }
    b.proceeds.delete(input.seller);
    b.proceedsTotal -= p;
    this.balances.set(input.business, (this.balances.get(input.business) ?? 0n) - p);
    this.balances.set(input.seller, (this.balances.get(input.seller) ?? 0n) + p);
    return { ok: true, hash: this.tx() };
  }

  async getDeal(business: string, dealId: string): Promise<ChainDeal | null> {
    const d = this.businesses.get(business)?.deals.get(dealId);
    return d ? { deal_id: dealId, digest: this.digest(business, dealId, d), deal: { ...d } } : null;
  }

  async control(business: string): Promise<Control> {
    const b = this.businesses.get(business);
    if (!b) throw new Error("no business");
    return {
      owner: b.owner,
      generation: b.generation,
      operators: [...b.operators].map(([a, caps]) => [
        a,
        { capabilities: caps, generation: b.generation },
      ]),
    };
  }

  async proceedsOf(business: string, account: string) {
    return String(this.businesses.get(business)?.proceeds.get(account) ?? 0n);
  }
}
