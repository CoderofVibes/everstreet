// Step 7 (docs/design/DEMO_ACCOUNT.md §2): several synthetic business contracts behind ONE set of
// transports. Each business has its own contract double (FixtureChain with its sale half); reads,
// operator submissions and wallet calls are routed by the contract account they name, and every
// contract shares one clock and block height (a block on one is a block on all), as on one chain.
// SYNTHETIC: no network; fictional accounts and test tokens.

import type { CustomerViewTransport, PinnedBlock } from "../../../server/src/customerRead.ts";
import type { CustomerChainWriter } from "../../../server/src/customerUse.ts";
import type { BlockRef, ViewTransport } from "../../../server/src/v3read.ts";
import {
  FixtureChain,
  FixtureReader,
  FixtureWriter,
  type Json,
  TOKEN,
} from "../../../server/test/customer-world.ts";

const BIG = 1_000_000_000;

export class DemoChains implements CustomerViewTransport, ViewTransport, CustomerChainWriter {
  readonly network = "testnet";
  readonly signer: string;
  readonly chains = new Map<string, FixtureChain>();
  private readonly readers = new Map<string, FixtureReader>();
  private readonly writers = new Map<string, FixtureWriter>();
  /** Companion contracts by account (server/test/companion-chain.ts) and their transactions. */
  readonly companions = new Map<
    string,
    {
      view(method: string, args: Json): string | undefined;
      walletCall?(signer: string, call: Json): Json;
    }
  >();
  private readonly companionTxs = new Map<string, Json>();

  constructor(
    private readonly verify: (pk: string, m: string, s: string) => boolean,
    signer: string,
  ) {
    this.signer = signer;
  }

  /** A new business contract double at `account`, on the shared clock. */
  add(account: string) {
    const c = new FixtureChain();
    c.business = account;
    c.ceiling = BIG;
    c.followWallClock = true; // its blocks are timestamped by the (simulated) process clock
    c.ts = BigInt(Date.now());
    // The token is ONE contract: every business double shares the same token ledger.
    const first = this.chains.values().next().value as FixtureChain | undefined;
    if (first) {
      c.balances = first.balances;
      c.tokenRegistered = first.tokenRegistered;
    }
    const r = new FixtureReader(c);
    r.ceiling = BIG;
    const w = new FixtureWriter(c, this.verify);
    w.ceiling = BIG;
    this.chains.set(account, c);
    this.readers.set(account, r);
    this.writers.set(account, w);
    this.align();
    return c;
  }

  /** One chain: the highest block any contract reached is every contract's block. */
  align() {
    let height = 0;
    let ts = 0n;
    for (const c of this.chains.values()) {
      if (c.height > height) height = c.height;
      if (c.ts > ts) ts = c.ts;
    }
    for (const c of this.chains.values()) {
      c.height = height;
      c.ts = ts;
    }
  }

  private of<T>(m: Map<string, T>, account: string): T {
    const x = m.get(account);
    if (!x) throw new Error(`no synthetic contract at ${account}`);
    return x;
  }

  // ---------- reads (customer views and v3 observations) ----------

  async finalBlock(): Promise<PinnedBlock> {
    // The chain keeps producing blocks while nothing happens: the newest block is "now".
    const now = BigInt(Date.now());
    for (const c of this.chains.values())
      if (c.ts < now) {
        c.ts = now;
        c.height += 1;
      }
    this.align();
    const first = this.readers.values().next().value as FixtureReader;
    return first.finalBlock();
  }

  async view(input: {
    network: string;
    account: string;
    method: string;
    args: Record<string, unknown>;
    block: BlockRef;
  }) {
    const companion = this.companions.get(input.account);
    if (companion) {
      const v = companion.view(input.method, input.args as Json);
      if (v === undefined) throw new Error(`MethodNotFound: ${input.method}`);
      return { result: v, block: input.block };
    }
    // Token reads go to the shared token ledger (any business double answers them alike).
    const reader =
      input.account === TOKEN
        ? (this.readers.values().next().value as FixtureReader)
        : this.of(this.readers, input.account);
    return reader.view(input as never);
  }

  /** The handoff proof: the synthetic chain runs no contract code and its accounts have no keys. */
  async accountState() {
    return { code_hash: "synthetic", keys: 0 };
  }

  async txOutcome(hash: string) {
    const own = this.companionTxs.get(hash);
    if (own) return own;
    for (const c of this.chains.values()) {
      const o = c.txs.get(hash);
      if (o) return o;
    }
    return null;
  }

  // ---------- the platform's operator submissions ----------

  async openHold(input: Parameters<CustomerChainWriter["openHold"]>[0]) {
    const out = await this.of(this.writers, input.account).openHold(input);
    this.align();
    return out;
  }

  async settleHold(input: Parameters<NonNullable<CustomerChainWriter["settleHold"]>>[0]) {
    const w = this.of(this.writers, input.account);
    if (!w.settleHold) throw new Error("settle not supported");
    const out = await w.settleHold(input);
    this.align();
    return out;
  }

  async releaseHoldFor(input: Parameters<NonNullable<CustomerChainWriter["releaseHoldFor"]>>[0]) {
    const w = this.of(this.writers, input.account);
    if (!w.releaseHoldFor) throw new Error("release not supported");
    const out = await w.releaseHoldFor(input);
    this.align();
    return out;
  }

  // ---------- a person's wallet ----------

  /**
   * A wallet transaction, applied to the contract it names: the business contract itself, or the
   * token contract on behalf of the business it pays (its `receiver_id`).
   */
  walletCall(signer: string, call: Json) {
    const companion = this.companions.get(String(call.receiverId));
    if (companion?.walletCall) {
      const out = companion.walletCall(signer, call);
      this.companionTxs.set(out.transaction.hash, out);
      return out;
    }
    const target =
      call.receiverId === TOKEN ? String(call.args?.receiver_id ?? "") : String(call.receiverId);
    // A token call that names no business (a registration) goes to the shared token ledger.
    const chain = this.chains.get(target) ?? this.chains.values().next().value;
    if (!chain) throw new Error("no synthetic contracts");
    const out = chain.walletCall(signer, call as never);
    this.align();
    return out;
  }
}

/**
 * The handoff proof's second provider over the same synthetic chain. `disagreeOwner` makes it
 * misreport the owner (a poisoned observation), so the proof's Uncertain state can be shown.
 */
export class SecondProvider implements CustomerViewTransport {
  readonly network = "testnet";
  disagreeOwner: string | null = null;
  constructor(private readonly chains: DemoChains) {}
  finalBlock() {
    return this.chains.finalBlock();
  }
  async view(input: Parameters<DemoChains["view"]>[0]) {
    const r = await this.chains.view(input);
    if (this.disagreeOwner === null || input.method !== "get_control") return r;
    return { ...r, result: JSON.stringify({ ...JSON.parse(r.result), owner: this.disagreeOwner }) };
  }
}
