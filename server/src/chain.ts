// Everstreet's connection to NEAR testnet. People and businesses get real testnet accounts:
// a person's account pays and cancels; a business account runs the v2 contract from shared
// code (by hash) and is born with no keys. In this local preview the people's keys are kept on
// this computer (the UI says so); real sign-in with NEAR Auth replaces that before any real use.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  Account,
  actions,
  baseDecode,
  JsonRpcProvider,
  KeyPair,
  type KeyPairString,
  nearToYocto,
  teraToGas,
} from "near-api-js";

export interface Rules {
  customer_cancel_refund: boolean;
  credit_refundable: boolean;
  min_reserve: string;
}

export interface ChainOrder {
  customer: string;
  amount: string;
  offer: string;
  status: "Paid" | "Delivered" | "Refunding" | "Refunded";
  paid_at_ms: string;
  cancel_before_ms: string;
}

export interface Treasury {
  held: string;
  customer_credit: string;
  unearned_orders: string;
  available: string;
  withdrawable: string;
  pending_payouts: string;
  deal_holds: string;
  seller_proceeds: string;
}

export interface Period {
  orders_in: string;
  prepaid_in: string;
  earned: string;
  refunds: string;
  credit_used: string;
  credit_withdrawn: string;
  owner_withdrawals: string;
  sale_proceeds: string;
}

export interface TxResult {
  ok: boolean;
  hash: string;
  error?: string;
}

/** What Everstreet needs from NEAR. A test double implements the same rules in memory. */
export interface Chain {
  readonly network: string;
  readonly token: string;
  readonly decimals: number;
  readonly explorer: string;
  createPersonAccount(label: string): Promise<{ account_id: string; secret: string; tx: string }>;
  createBusinessAccount(input: {
    label: string;
    name: string;
    owner: string;
    rules: Rules;
  }): Promise<{ account_id: string; tx: string }>;
  payOrder(input: {
    payer: string;
    secret: string;
    business: string;
    orderId: string;
    amount: string;
    offer: string;
    cancelBeforeMs: number;
  }): Promise<TxResult>;
  getOrder(business: string, orderId: string): Promise<ChainOrder | null>;
  cancelOrder(input: {
    customer: string;
    secret: string;
    business: string;
    orderId: string;
  }): Promise<TxResult>;
  deliver(input: {
    owner: string;
    secret: string;
    business: string;
    orderId: string;
  }): Promise<TxResult>;
  withdrawProfit(input: {
    owner: string;
    secret: string;
    business: string;
    amount: string;
  }): Promise<TxResult>;
  treasury(business: string): Promise<Treasury>;
  period(business: string, yyyymm: number): Promise<Period>;
  tokenBalance(account: string): Promise<string>;
  faucet(account: string, amount: string): Promise<TxResult>;
  appointOperator(input: {
    owner: string;
    secret: string;
    business: string;
    operator: string;
    capabilities: string[];
  }): Promise<TxResult>;
  revokeOperator(input: {
    owner: string;
    secret: string;
    business: string;
    operator: string;
  }): Promise<TxResult>;
  operatorCheck(
    business: string,
    account: string,
    capability: string,
  ): Promise<{ authorized: boolean; owner: string; generation: number; reason: string }>;
}

function executionError(failure: unknown): string {
  const text = JSON.stringify(failure);
  const m = text.match(/"ExecutionError":"((?:[^"\\]|\\.)*)"/);
  return m?.[1] ? JSON.parse(`"${m[1]}"`) : text;
}

function suffix() {
  return Math.random().toString(16).slice(2, 6);
}

export function accountLabel(text: string) {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 20)
      .replace(/-$/, "") || "x"
  );
}

export interface NearChainConfig {
  rpc: string;
  root: string;
  token: string;
  decimals: number;
  codeHash: string;
}

export class NearChain implements Chain {
  readonly network = "testnet";
  readonly explorer = "https://testnet.nearblocks.io";
  readonly token: string;
  readonly decimals: number;
  private readonly provider: JsonRpcProvider;
  private readonly rootAccount: Account;

  constructor(
    private readonly config: NearChainConfig,
    rootKey: KeyPairString,
  ) {
    this.token = config.token;
    this.decimals = config.decimals;
    this.provider = new JsonRpcProvider(
      { url: config.rpc },
      { retries: 3, wait: 500, backoff: 1.5 },
    );
    this.rootAccount = new Account(config.root, this.provider, rootKey);
  }

  /** Builds the chain from config/testnet.json and the root key in ~/.near-credentials; null if either is missing. */
  static fromLocalConfig(): NearChain | null {
    if (!existsSync("config/testnet.json")) return null;
    const c = JSON.parse(
      readFileSync("config/testnet.json", "utf8"),
    ) as Partial<NearChainConfig> & { v2CodeHash?: string; tokenDecimals?: number };
    if (!c.root || !c.token || !c.v2CodeHash) return null;
    const keyFile = join(homedir(), ".near-credentials", "testnet", `${c.root}.json`);
    if (!existsSync(keyFile)) return null;
    const key = JSON.parse(readFileSync(keyFile, "utf8")) as { private_key?: string };
    if (!key.private_key) return null;
    return new NearChain(
      {
        rpc: process.env.NEAR_RPC ?? c.rpc ?? "https://test.rpc.fastnear.com",
        root: c.root,
        token: c.token,
        decimals: c.tokenDecimals ?? 6,
        codeHash: c.v2CodeHash,
      },
      key.private_key as KeyPairString,
    );
  }

  private as(accountId: string, secret: string) {
    return new Account(accountId, this.provider, secret as KeyPairString);
  }

  private async send(
    signer: Account,
    receiverId: string,
    method: string,
    args: Record<string, unknown>,
    deposit = 1n,
    gas = 100,
  ): Promise<TxResult> {
    const r = await signer.signAndSendTransaction({
      receiverId,
      actions: [actions.functionCall(method, args, teraToGas(gas), deposit)],
      waitUntil: "FINAL",
      throwOnFailure: false,
    });
    const status = r.status as { Failure?: unknown };
    // A receipt further down the chain (the contract's callback) can fail while the transaction succeeds.
    const failed = r.receipts_outcome.find(
      (o) => (o.outcome.status as { Failure?: unknown }).Failure !== undefined,
    );
    const failure =
      status.Failure ?? (failed?.outcome.status as { Failure?: unknown } | undefined)?.Failure;
    return {
      ok: status.Failure === undefined,
      hash: r.transaction.hash,
      ...(failure !== undefined ? { error: executionError(failure) } : {}),
    };
  }

  private async view<T>(
    contractId: string,
    method: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    return (await this.provider.callFunction({
      contractId,
      method,
      args,
      blockQuery: { finality: "final" },
    })) as T;
  }

  /** Registers an account with the token (storage) and, optionally, sends it test dollars, in one transaction. */
  private async registerWithToken(account: string, amount?: string) {
    const acts = [
      actions.functionCall(
        "storage_deposit",
        { account_id: account, registration_only: true },
        teraToGas(30),
        nearToYocto("0.01"),
      ),
    ];
    if (amount)
      acts.push(
        actions.functionCall("ft_transfer", { receiver_id: account, amount }, teraToGas(30), 1n),
      );
    return this.rootAccount.signAndSendTransaction({
      receiverId: this.token,
      actions: acts,
      waitUntil: "FINAL",
    });
  }

  async createPersonAccount(label: string) {
    const key = KeyPair.fromRandom("ed25519");
    const accountId = `p-${accountLabel(label)}-${suffix()}.${this.config.root}`;
    const r = await this.rootAccount.signAndSendTransaction({
      receiverId: accountId,
      actions: [
        actions.createAccount(),
        actions.transfer(nearToYocto("0.2")),
        actions.addFullAccessKey(key.getPublicKey()),
      ],
      waitUntil: "FINAL",
    });
    await this.registerWithToken(accountId, (200n * 10n ** BigInt(this.decimals)).toString());
    return { account_id: accountId, secret: key.toString(), tx: r.transaction.hash };
  }

  async createBusinessAccount(input: { label: string; name: string; owner: string; rules: Rules }) {
    const accountId = `b-${accountLabel(input.label)}-${suffix()}.${this.config.root}`;
    const r = await this.rootAccount.signAndSendTransaction({
      receiverId: accountId,
      actions: [
        actions.createAccount(),
        actions.transfer(nearToYocto("0.3")),
        // biome-ignore lint/correctness/useHookAtTopLevel: a NEAR transaction action, not a React hook
        actions.useGlobalContract({ codeHash: baseDecode(this.config.codeHash) }),
        actions.functionCall(
          "new",
          {
            name: input.name.slice(0, 64),
            owner: input.owner,
            asset: this.token,
            rules: input.rules,
          },
          teraToGas(30),
          0n,
        ),
      ],
      waitUntil: "FINAL",
    });
    await this.registerWithToken(accountId);
    return { account_id: accountId, tx: r.transaction.hash };
  }

  payOrder(input: {
    payer: string;
    secret: string;
    business: string;
    orderId: string;
    amount: string;
    offer: string;
    cancelBeforeMs: number;
  }) {
    const msg = JSON.stringify({
      order: {
        order_id: input.orderId,
        offer: input.offer,
        cancel_before_ms: String(input.cancelBeforeMs),
      },
    });
    return this.send(
      this.as(input.payer, input.secret),
      this.token,
      "ft_transfer_call",
      { receiver_id: input.business, amount: input.amount, msg },
      1n,
      80,
    );
  }

  async getOrder(business: string, orderId: string) {
    return (
      (await this.view<ChainOrder | null>(business, "get_order", { order_id: orderId })) ?? null
    );
  }

  cancelOrder(input: { customer: string; secret: string; business: string; orderId: string }) {
    return this.send(
      this.as(input.customer, input.secret),
      input.business,
      "cancel_order",
      { order_id: input.orderId },
      1n,
      60,
    );
  }

  deliver(input: { owner: string; secret: string; business: string; orderId: string }) {
    return this.send(
      this.as(input.owner, input.secret),
      input.business,
      "deliver",
      { order_id: input.orderId },
      1n,
      30,
    );
  }

  withdrawProfit(input: { owner: string; secret: string; business: string; amount: string }) {
    return this.send(
      this.as(input.owner, input.secret),
      input.business,
      "withdraw_profit",
      { amount: input.amount },
      1n,
      60,
    );
  }

  treasury(business: string) {
    return this.view<Treasury>(business, "get_treasury");
  }

  appointOperator(input: {
    owner: string;
    secret: string;
    business: string;
    operator: string;
    capabilities: string[];
  }) {
    return this.send(
      this.as(input.owner, input.secret),
      input.business,
      "appoint_operator",
      { account_id: input.operator, capabilities: input.capabilities },
      1n,
      30,
    );
  }

  revokeOperator(input: { owner: string; secret: string; business: string; operator: string }) {
    return this.send(
      this.as(input.owner, input.secret),
      input.business,
      "revoke_operator",
      { account_id: input.operator },
      1n,
      30,
    );
  }

  operatorCheck(business: string, account: string, capability: string) {
    return this.view<{ authorized: boolean; owner: string; generation: number; reason: string }>(
      business,
      "operator_check",
      { account_id: account, capability },
    );
  }

  period(business: string, yyyymm: number) {
    return this.view<Period>(business, "get_period", { yyyymm });
  }

  async tokenBalance(account: string) {
    return (await this.view<string>(this.token, "ft_balance_of", { account_id: account })) ?? "0";
  }

  async faucet(account: string, amount: string) {
    const r = await this.rootAccount.signAndSendTransaction({
      receiverId: this.token,
      actions: [
        actions.functionCall("ft_transfer", { receiver_id: account, amount }, teraToGas(30), 1n),
      ],
      waitUntil: "FINAL",
      throwOnFailure: false,
    });
    return {
      ok: (r.status as { Failure?: unknown }).Failure === undefined,
      hash: r.transaction.hash,
    };
  }
}
