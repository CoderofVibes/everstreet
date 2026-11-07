// SYNTHETIC doubles of the two companion contracts and the external registry, for the demo and
// the app's tests. Each follows its contract's rules and refusal codes exactly:
// contracts/asset-key (signs two typed EVM actions for the business's current owner, generation
// in the path), contracts/spend-allowance (an agent's capped supplier budget that ends when the
// business's generation changes) and the registry the asset-key signs for (only its controller
// may act; a transaction is pending until a few blocks have passed). The signer here is the local
// stand-in's deterministic test key (contracts/test-signer): public by design, never a real key.

import { createHash } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  type AssetAction,
  addressOf,
  callData,
  type MpcSignature,
  payloadOf,
  signerOf,
  type TxParams,
  toHex,
  unsignedTx,
} from "../src/evm.ts";

// biome-ignore lint/suspicious/noExplicitAny: decoded contract JSON
type Json = any;
type Control = () => { owner: string; generation: number; control_seq: string };

const b64 = (v: unknown) =>
  Buffer.from(v === undefined ? "" : JSON.stringify(v)).toString("base64");
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
let txCount = 0;
function hashOf(seed: string) {
  let n = BigInt(`0x${createHash("sha256").update(`${seed}-${++txCount}`).digest("hex")}`);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  return out;
}
const event = (standard: string, name: string, data: unknown) =>
  `EVENT_JSON:${JSON.stringify({ standard, version: "1.0.0", event: name, data: [data] })}`;

/** A wallet transaction's FINAL outcome, in the RPC's shape (one receipt, or a failure). */
export function outcome(
  receiver: string,
  signer: string,
  call: { methodName: string; args: Json; gas: string; deposit: string },
  r: { ok: true; logs: string[]; value: unknown } | { ok: false; error: string },
) {
  const hash = hashOf(`${receiver}-${call.methodName}`);
  const id = `${hash.slice(0, 10)}-call`;
  const status = r.ok
    ? { SuccessValue: b64(r.value) }
    : {
        Failure: {
          ActionError: {
            kind: { FunctionCallError: { ExecutionError: `Smart contract panicked: ${r.error}` } },
          },
        },
      };
  return {
    final_execution_status: "FINAL",
    transaction: {
      hash,
      signer_id: signer,
      receiver_id: receiver,
      actions: [
        {
          FunctionCall: {
            method_name: call.methodName,
            args: Buffer.from(JSON.stringify(call.args)).toString("base64"),
            gas: Number(call.gas),
            deposit: call.deposit,
          },
        },
      ],
    },
    status,
    transaction_outcome: {
      id: hash,
      outcome: {
        executor_id: signer,
        logs: [],
        receipt_ids: [id],
        status: { SuccessReceiptId: id },
      },
    },
    receipts_outcome: [
      {
        id,
        outcome: { executor_id: receiver, logs: r.ok ? r.logs : [], receipt_ids: [], status },
      },
    ],
  };
}

class Refusal extends Error {}
const refuse = (m: string): never => {
  throw new Refusal(m);
};

/** The local stand-in signer's key for (predecessor, path) (contracts/test-signer). */
export function testKey(predecessor: string, path: string) {
  return sha256(new TextEncoder().encode(`everstreet-test-signer:${predecessor},${path}`));
}
export const testAddress = (predecessor: string, path: string) =>
  addressOf(secp256k1.getPublicKey(testKey(predecessor, path), false));

// ---------- the registry on the other chain ----------

export class RegistryDouble {
  controller: string;
  published: string[] = [];
  /** Next expected nonce per sender (as an EVM chain counts them). */
  nonces = new Map<string, number>();
  height = 100;
  /** Blocks after inclusion before a transaction counts as final. */
  finality = 3;
  txs = new Map<
    string,
    { status: "included" | "failed"; block: number; from: string; error?: string }
  >();
  constructor(
    readonly chainId: bigint,
    readonly address: string,
    controller: string,
  ) {
    this.controller = controller.toLowerCase();
  }
  /** One signed transaction: who signed it decides; a wrong nonce is never included. */
  submit(hash: string, from: string, nonce: number, action: AssetAction) {
    const f = from.toLowerCase();
    if ((this.nonces.get(f) ?? 0) !== nonce) return { accepted: false, error: "nonce" };
    this.nonces.set(f, nonce + 1);
    this.height += 1;
    if (f !== this.controller) {
      this.txs.set(hash, {
        status: "failed",
        block: this.height,
        from: f,
        error: "not controller",
      });
      return { accepted: true };
    }
    if (action.kind === "publish") this.published.push(action.digest);
    else this.controller = action.to.toLowerCase();
    this.txs.set(hash, { status: "included", block: this.height, from: f });
    return { accepted: true };
  }
  /** Pending until `finality` blocks have passed after inclusion; a revert is final too. */
  statusOf(hash: string): "unknown" | "pending" | "final" | "failed" {
    const t = this.txs.get(hash);
    if (!t) return "unknown";
    if (this.height - t.block < this.finality) return "pending";
    return t.status === "failed" ? "failed" : "final";
  }
  mine(blocks = 1) {
    this.height += blocks;
  }
}

// ---------- contracts/asset-key ----------

export class AssetKeyDouble {
  signed = 0;
  constructor(
    readonly account: string,
    private readonly control: Control,
    readonly config: {
      chain_id: bigint;
      registry: string;
      max_gas_limit: bigint;
      max_fee_per_gas: bigint;
      signer: string;
      business: string;
    },
  ) {}

  view(method: string, args: Json): string | undefined {
    if (method === "get_config")
      return JSON.stringify({
        business: this.config.business,
        signer: this.config.signer,
        chain_id: String(this.config.chain_id),
        registry: this.config.registry,
        max_gas_limit: String(this.config.max_gas_limit),
        max_fee_per_gas: String(this.config.max_fee_per_gas),
      });
    if (method === "get_path") return JSON.stringify(`gen-${Number(args.generation)}`);
    if (method === "get_signed_nonce") {
      const n = this.signedNonce.get(`gen-${Number(args.generation)}`);
      return JSON.stringify(n === undefined ? null : String(n));
    }
    return undefined;
  }

  /** The highest nonce signed per path (the fixed contract's nonce discipline). */
  readonly signedNonce = new Map<string, bigint>();

  private request(caller: string, deposit: bigint, action: AssetAction, tx: TxParams) {
    if (deposit < 1n) refuse("E_DEPOSIT: attach the signer's fee");
    const gas = BigInt(tx.gas_limit);
    if (gas <= 0n || gas > this.config.max_gas_limit) refuse("E_GAS: gas limit out of range");
    if (
      BigInt(tx.max_fee_per_gas) > this.config.max_fee_per_gas ||
      BigInt(tx.max_priority_fee_per_gas) > BigInt(tx.max_fee_per_gas)
    )
      refuse("E_FEE: fee out of range");
    // A publish's digest is checked at entry; a move names no destination (it is derived).
    if (action.kind === "publish")
      try {
        callData(action);
      } catch {
        refuse("E_INPUT: the action's fields are malformed");
      }
    const c = this.control();
    const refused = (code: string) => ({
      logs: [event("asset-key", "asset_refused", { caller, code })],
      value: { refused: code },
    });
    if (c.owner !== caller) return refused("E_NOT_OWNER");
    let generation = c.generation;
    let signedAction: AssetAction = action;
    if (action.kind === "set_controller") {
      // As the fixed contract: the destination is always the current generation's own address,
      // derived here; a caller's `to` is ignored. Moving from the current generation is refused.
      if (action.from_generation === 0 || action.from_generation >= c.generation)
        return refused("E_GENERATION");
      generation = action.from_generation;
      signedAction = {
        kind: "set_controller",
        from_generation: action.from_generation,
        to: addressOf(secp256k1.getPublicKey(testKey(this.account, `gen-${c.generation}`), false)),
      };
    }
    // Nonce discipline: at most one past the highest nonce signed for this path.
    const highest = this.signedNonce.get(`gen-${generation}`);
    if (BigInt(tx.nonce) > (highest === undefined ? 0n : highest + 1n)) return refused("E_NONCE");
    const unsigned = unsignedTx(this.config.chain_id, this.config.registry, tx, signedAction);
    const payload = payloadOf(unsigned);
    const path = `gen-${generation}`;
    const raw = secp256k1.sign(payload, testKey(this.account, path), {
      prehash: false,
      format: "recovered",
    });
    const rec = raw[0] as number;
    const signature: MpcSignature = {
      scheme: "Secp256k1",
      big_r: {
        affine_point: `${rec & 1 ? "03" : "02"}${Buffer.from(raw.slice(1, 33)).toString("hex")}`,
      },
      s: { scalar: Buffer.from(raw.slice(33)).toString("hex") },
      recovery_id: rec,
    };
    this.signed++;
    if (highest === undefined || BigInt(tx.nonce) > highest)
      this.signedNonce.set(path, BigInt(tx.nonce));
    const hexPayload = Buffer.from(payload).toString("hex");
    return {
      logs: [
        event("asset-key", "asset_sign_requested", {
          caller,
          generation,
          owner_generation: c.generation,
          control_seq: c.control_seq,
          path,
          payload: hexPayload,
          nonce: tx.nonce,
          action: signedAction,
        }),
      ],
      value: { generation, path, payload: hexPayload, unsigned_tx: toHex(unsigned), signature },
    };
  }

  walletCall(
    signer: string,
    call: { methodName: string; args: Json; gas: string; deposit: string },
  ) {
    try {
      if (call.methodName !== "request") refuse("MethodNotFound");
      const r = this.request(signer, BigInt(call.deposit), call.args.action, call.args.tx);
      return outcome(this.account, signer, call, { ok: true, ...r });
    } catch (e) {
      if (!(e instanceof Refusal)) throw e;
      return outcome(this.account, signer, call, { ok: false, error: e.message });
    }
  }
}

// ---------- contracts/spend-allowance ----------

interface Grant {
  agent: string;
  suppliers: string[];
  per_payment: string;
  per_period: string;
  period_ms: string;
  review_above: string;
  generation: number;
  granted_by: string;
}
type PaymentState = "AwaitingApproval" | "Sending" | "Paid" | "Claim" | "Refused";
interface Payment {
  supplier: string;
  amount: string;
  invoice: string;
  state: PaymentState;
  generation: number;
  at_ms: string;
}

export class AllowanceDouble {
  grant: Grant | null = null;
  balance = 0n;
  reserved = 0n;
  claimsTotal = 0n;
  periodStart = 0;
  spentInPeriod = 0n;
  payments = new Map<string, Payment>();
  claims = new Map<string, bigint>();
  /** Suppliers the token would refuse a transfer to (not registered). */
  unregistered = new Set<string>();
  now: () => number = () => Date.now();
  logs: string[] = [];
  constructor(
    readonly account: string,
    private readonly control: Control,
    readonly token: string,
    readonly business: string,
  ) {}

  private available() {
    return this.balance - this.reserved - this.claimsTotal;
  }

  view(method: string, args: Json): string | undefined {
    if (method === "get_allowance")
      return JSON.stringify({
        business: this.business,
        token: this.token,
        grant: this.grant,
        balance: String(this.balance),
        reserved: String(this.reserved),
        claims_total: String(this.claimsTotal),
        available: String(this.available()),
        period_start_ms: String(this.periodStart),
        spent_in_period: String(this.spentInPeriod),
      });
    if (method === "get_payment")
      return JSON.stringify(this.payments.get(String(args.invoice)) ?? null);
    if (method === "get_payments") {
      const from = Number(args.from ?? 0);
      const limit = Math.min(Number(args.limit ?? 50), 50);
      return JSON.stringify([...this.payments.values()].slice(from, from + limit));
    }
    if (method === "get_claim")
      return JSON.stringify(String(this.claims.get(String(args.supplier)) ?? 0n));
    return undefined;
  }

  /** Funding with msg "fund" (the demo's setup moves the tokens itself). */
  fund(amount: bigint) {
    this.balance += amount;
  }

  private ev(name: string, data: unknown) {
    const l = event("spend-allowance", name, data);
    this.logs.push(l);
    return l;
  }

  private settle(invoice: string, p: Payment) {
    this.reserved -= BigInt(p.amount);
    if (this.unregistered.has(p.supplier)) {
      this.claims.set(p.supplier, (this.claims.get(p.supplier) ?? 0n) + BigInt(p.amount));
      this.claimsTotal += BigInt(p.amount);
      p.state = "Claim";
      return [this.ev("payment_claim", { payment: p })];
    }
    this.balance -= BigInt(p.amount);
    p.state = "Paid";
    this.payments.set(invoice, p);
    return [this.ev("payment_paid", { payment: p })];
  }

  private refuseHeld(invoice: string, p: Payment, code: string) {
    this.reserved -= BigInt(p.amount);
    this.spentInPeriod =
      this.spentInPeriod > BigInt(p.amount) ? this.spentInPeriod - BigInt(p.amount) : 0n;
    p.state = "Refused";
    return [this.ev("payment_refused", { invoice, code })];
  }

  /** The agent's one action (Everstreet's agent calls it with its function-call key). */
  pay(
    caller: string,
    supplier: string,
    amount: bigint,
    invoice: string,
  ): { value: string; logs: string[] } {
    const g = this.grant ?? refuse("E_NO_GRANT: no allowance is granted");
    if (caller !== g.agent) refuse("E_NOT_AGENT: only the granted agent can pay");
    if (!/^[0-9a-fA-F]{64}$/.test(invoice))
      refuse("E_INPUT: the invoice digest is 64 hex characters");
    if (this.payments.has(invoice)) refuse("E_REPLAY: this invoice was already submitted");
    if (!g.suppliers.includes(supplier)) refuse("E_SUPPLIER: not an allowed supplier");
    const review = amount > BigInt(g.review_above);
    if (!(amount > 0n && (review || amount <= BigInt(g.per_payment))))
      refuse("E_CAP: above the per-payment cap");
    const now = this.now();
    if (now >= this.periodStart + Number(g.period_ms)) {
      this.periodStart = now;
      this.spentInPeriod = 0n;
    }
    if (this.spentInPeriod + amount > BigInt(g.per_period))
      refuse("E_PERIOD_CAP: the period's cap would be exceeded");
    if (amount > this.available()) refuse("E_BUDGET: not enough budget");
    this.spentInPeriod += amount;
    this.reserved += amount;
    const p: Payment = {
      supplier,
      amount: String(amount),
      invoice,
      state: review ? "AwaitingApproval" : "Sending",
      generation: g.generation,
      at_ms: String(now),
    };
    this.payments.set(invoice, p);
    if (review)
      return {
        value: "awaiting_approval",
        logs: [this.ev("payment_awaiting_approval", { payment: p })],
      };
    // The control read happens after the reservation (the contract's cross-contract order).
    if (this.control().generation !== g.generation)
      return { value: "E_GRANT_ENDED", logs: this.refuseHeld(invoice, p, "E_GRANT_ENDED") };
    const logs = this.settle(invoice, p);
    return { value: p.state === "Paid" ? "paid" : "claim", logs };
  }

  private ownerCall(
    signer: string,
    method: string,
    args: Json,
  ): { value: unknown; logs: string[] } {
    const c = this.control();
    if (method === "grant") {
      if (!Array.isArray(args.suppliers) || args.suppliers.length < 1 || args.suppliers.length > 10)
        refuse("E_INPUT: 1 to 10 suppliers");
      if (!(BigInt(args.per_payment) > 0n && BigInt(args.per_payment) <= BigInt(args.per_period)))
        refuse("E_INPUT: per-payment cap within the period cap");
      if (BigInt(args.review_above) < BigInt(args.per_payment))
        refuse("E_INPUT: the review threshold is at least the per-payment cap");
      if (Number(args.period_ms) < 60_000) refuse("E_INPUT: a period of at least a minute");
      if (c.owner !== signer) refuse("E_NOT_OWNER: only the business's current owner can grant");
      this.grant = {
        agent: args.agent,
        suppliers: args.suppliers,
        per_payment: String(args.per_payment),
        per_period: String(args.per_period),
        period_ms: String(args.period_ms),
        review_above: String(args.review_above),
        generation: c.generation,
        granted_by: signer,
      };
      this.periodStart = this.now();
      this.spentInPeriod = 0n;
      return { value: "granted", logs: [this.ev("allowance_granted", { grant: this.grant })] };
    }
    if (method === "reject") {
      const p = this.payments.get(String(args.invoice)) ?? refuse("E_NO_PAYMENT: no such invoice");
      if (p.state !== "AwaitingApproval") refuse("E_STATE: not awaiting approval");
      if (this.grant?.granted_by !== signer)
        refuse("E_NOT_OWNER: only the grant's owner can reject");
      if (c.owner !== signer) return { value: "E_NOT_OWNER", logs: [] };
      return { value: "rejected", logs: this.refuseHeld(String(args.invoice), p, "E_REJECTED") };
    }
    if (method === "approve") {
      const p = this.payments.get(String(args.invoice)) ?? refuse("E_NO_PAYMENT: no such invoice");
      if (p.state !== "AwaitingApproval") refuse("E_STATE: not awaiting approval");
      if (this.grant?.granted_by !== signer)
        refuse("E_NOT_OWNER: only the grant's owner can approve");
      // As the fixed contract: the owner check answers a code (the invoice stays awaiting).
      if (c.owner !== signer) return { value: "E_NOT_OWNER", logs: [] };
      if (!this.grant || this.grant.generation !== c.generation || p.generation !== c.generation)
        return {
          value: "E_GRANT_ENDED",
          logs: this.refuseHeld(String(args.invoice), p, "E_GRANT_ENDED"),
        };
      const logs = this.settle(String(args.invoice), p);
      return { value: p.state === "Paid" ? "paid" : "claim", logs };
    }
    return refuse("MethodNotFound");
  }

  walletCall(
    signer: string,
    call: { methodName: string; args: Json; gas: string; deposit: string },
  ) {
    try {
      const r = this.ownerCall(signer, call.methodName, call.args);
      return outcome(this.account, signer, call, { ok: true, logs: r.logs, value: r.value });
    } catch (e) {
      if (!(e instanceof Refusal)) throw e;
      return outcome(this.account, signer, call, { ok: false, error: e.message });
    }
  }
}

/** Who signed a payload with an answer from the asset-key double (re-exported for tests). */
export { signerOf };

// ---------- attaching companions to a synthetic business ----------

import type { EvmPort } from "../src/companions.ts";

/** The local stand-in signer's view: each (predecessor, path)'s public key, uncompressed hex. */
export class SignerDouble {
  view(method: string, args: Json): string | undefined {
    if (method !== "derived_public_key") return undefined;
    const pk = secp256k1.getPublicKey(testKey(String(args.predecessor), String(args.path)), false);
    return JSON.stringify(Buffer.from(pk).toString("hex"));
  }
}

/** The registry reached as Everstreet would reach an EVM chain (synthetic, labelled so). */
export class SyntheticEvm implements EvmPort {
  readonly chainName = "synthetic EVM chain";
  readonly source = "synthetic" as const;
  constructor(readonly registry: RegistryDouble) {}
  async controller() {
    return this.registry.controller;
  }
  async nonce(address: string) {
    return this.registry.nonces.get(address.toLowerCase()) ?? 0;
  }
  async broadcast(raw: Uint8Array, meta: { from: string; nonce: number; action: AssetAction }) {
    const hash = toHex(sha256(raw));
    const r = this.registry.submit(hash, meta.from, meta.nonce, meta.action);
    if (!r.accepted) throw new Error(`not accepted: ${r.error}`);
    return hash;
  }
  async status(hash: string) {
    return this.registry.statusOf(hash);
  }
  async fees() {
    return {
      max_fee_per_gas: "3000000000",
      max_priority_fee_per_gas: "1000000000",
      gas_limit: "80000",
    };
  }
}

export const SIGNER = "signer.synthetic.near";

/**
 * Attaches the two companions, the stand-in signer and the registry to one synthetic business
 * (its control read straight from its sale double, as the companions' cross-contract call would).
 */
export function attachCompanions(
  chain: {
    companions: Map<
      string,
      { view(m: string, a: Json): string | undefined; walletCall?(s: string, c: Json): Json }
    >;
  },
  business: string,
  control: Control,
  o: { asset: string; allowance: string; token: string; chainId?: bigint; registry?: string },
) {
  const chainId = o.chainId ?? 11155111n;
  const registryAddress = o.registry ?? `0x${"5e".repeat(20)}`;
  const registry = new RegistryDouble(
    chainId,
    registryAddress,
    testAddress(o.asset, `gen-${control().generation}`),
  );
  const asset = new AssetKeyDouble(o.asset, control, {
    chain_id: chainId,
    registry: registryAddress,
    max_gas_limit: 200_000n,
    max_fee_per_gas: 50_000_000_000n,
    signer: SIGNER,
    business,
  });
  const allowance = new AllowanceDouble(o.allowance, control, o.token, business);
  chain.companions.set(o.asset, asset);
  chain.companions.set(o.allowance, allowance);
  chain.companions.set(SIGNER, new SignerDouble());
  return { asset, allowance, registry, evm: new SyntheticEvm(registry) };
}
