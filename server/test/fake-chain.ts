// An in-memory stand-in for NEAR testnet with the v2 contract's money rules (contracts/
// business-v2, tested on a real node in its sandbox test). Used only by platform tests.

import type { Chain, ChainOrder, Period, Rules, Treasury, TxResult } from "../src/chain.ts";

interface Biz {
  owner: string;
  rules: Rules;
  orders: Map<string, ChainOrder>;
  unearned: bigint;
  available: bigint;
  earned: bigint;
  refunds: bigint;
  withdrawn: bigint;
  ordersIn: bigint;
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
      owner: input.owner,
      rules: input.rules,
      orders: new Map(),
      unearned: 0n,
      available: 0n,
      earned: 0n,
      refunds: 0n,
      withdrawn: 0n,
      ordersIn: 0n,
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
    if (!b || b.owner !== input.owner)
      return { ok: false, hash: this.tx(), error: "E_NOT_AUTHORIZED" };
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
      deal_holds: "0",
      seller_proceeds: "0",
    };
  }

  async period(business: string): Promise<Period> {
    const b = this.businesses.get(business);
    if (!b) throw new Error("no business");
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
}
