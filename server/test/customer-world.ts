// Job 003m test world. A TEST DOUBLE of one business-v3 entitlement, seeded from the contract's own
// JSON (server/test/fixtures/v3/customer-readback.json and direct-accepting.json, produced by the
// contract's unit tests). It models only the open_hold rules the reservation relies on
// (lib.rs open_hold, revoke_key, skip_hold_seq, release_hold); it is not the contract, executes no
// transaction and proves no live authorization. Every synthetic change to fixture state is a named
// method here. The customer's key is the contract tests' synthetic seed 1, never a wallet key.
// Every producer has its own finite ceiling.

import { createHash, createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { everstreetApi } from "../src/app.ts";
import type { CustomerViewTransport, PinnedBlock } from "../src/customerRead.ts";
import {
  closedRootPreimage,
  type Envelope,
  envelopeDigest,
  fingerprintPreimage,
  preimageOfHold,
  preimageOfUse,
  sha256,
  sha256Hex,
} from "../src/customerSigning.ts";
import {
  type CustomerChainWriter,
  type CustomerUseOptions,
  CustomerUses,
  type InputProtection,
  type ProtectedContext,
  type ProtectedObjectInfo,
  type WriterAnswer,
} from "../src/customerUse.ts";
import { ManagedRuntime, type RuntimeOptions } from "../src/invocations.ts";
import { RuntimeFailure, type RuntimeProvider } from "../src/runtime.ts";
import type { Store } from "../src/store.ts";
import { V3Observations } from "../src/v3observe.ts";
import type { BlockRef, ViewTransport } from "../src/v3read.ts";
import { type Answer, correct, runtimeWorld, ScriptedRuntime } from "./runtime-world.ts";
import { SaleChain } from "./sale-chain.ts";

// biome-ignore lint/suspicious/noExplicitAny: fixture JSON is read field by field
export type Json = Record<string, any>;

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(here, "fixtures", "v3", `${name}.json`), "utf8")) as Record<
    string,
    string
  >;
export const READBACK = fixture("customer-readback");
export const ACCEPTING = fixture("direct-accepting");
export const SIGNING = JSON.parse(
  readFileSync(join(here, "fixtures", "v3", "customer-signing.json"), "utf8"),
) as Json;
export const view = (k: string) => JSON.parse(READBACK[k] as string) as Json;
/** Job 003web: the contract's own purchase-path fixture (customer-purchase.json). */
export const PURCHASE = JSON.parse(
  readFileSync(join(here, "fixtures", "v3", "customer-purchase.json"), "utf8"),
) as Json;
/** An event log line exactly as the contract writes it (lib.rs `emit`). */
const event = (name: string, data: Json) =>
  `EVENT_JSON:${JSON.stringify({ standard: "business_core", version: "3.0.0", event: name, data: [data] })}`;
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(b: Buffer) {
  let n = BigInt(`0x${b.toString("hex")}`);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  return out;
}

export const BUSINESS = "studio.biz.near";
export const CUSTOMER = "cara.near";
/** Job 003web: a fictional customer with no entitlement and no key, holding their own test tokens. */
export const FRESH = "dana.near";
export const TOKEN = "tusd.near";
export const OPERATOR = "meter.near";
export const T0 = 1_793_577_600_000n; // the contract tests' T0: 2026-11-02T00:00:00Z

/** A synthetic ed25519 signer from a 32-byte seed (the contract tests use seed 1). */
export function keyFromSeed(seed: number) {
  const der = Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    Buffer.alloc(32, seed),
  ]);
  const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  return (messageHex: string) => sign(null, Buffer.from(messageHex, "hex"), key).toString("hex");
}

const HASH_CHARS = "ABCDEFGHJK"; // base58 has no 0: map each digit to a letter
const hashOf = (h: number) =>
  `Bkh${String(h)
    .padStart(29, "0")
    .replace(/[0-9]/g, (d) => HASH_CHARS[Number(d)] as string)}`;

class ChainRefusal extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** The test double of the chain: one plan, one entitlement per customer. */
export class FixtureChain {
  /** The business contract account its signed messages name (job 003wf1: a .testnet one). */
  business = BUSINESS;
  height = 1_000;
  ts = T0;
  plan = view("plan_1");
  control: Json = JSON.parse(ACCEPTING.get_control as string);
  treasury: Json = JSON.parse(ACCEPTING.get_treasury as string);
  ents = new Map<string, Json>();
  private holdPk = new Map<string, string>();
  opened = 0;
  /** Units the double charged, and holds released through release_hold (job 003o). */
  charged = 0;
  released = 0;
  calls = 0;
  /** A finite call budget; a longer scenario names its own (still bounded) budget explicitly. */
  ceiling = 400;

  constructor() {
    // Funded 100, key slot 0 active at epoch 1, nothing held (the contract's own JSON).
    this.ents.set(CUSTOMER, view("funded_100.entitlement"));
    this.noDeal();
  }

  private bump() {
    if (++this.calls > this.ceiling) throw new Error("fixture chain ceiling reached");
  }

  /** Synthetic: the accepting fixture's control with its live deal removed. */
  noDeal() {
    this.control = { ...this.control, live_deal: null };
  }

  /** The contract-produced control with a live Direct deal in accepting (grants exclude meter). */
  accepting() {
    this.control = JSON.parse(ACCEPTING.get_control as string);
  }

  /** The contract-produced control after an actual sale: owner buyer.near, meter2 at gen 2. */
  afterSale() {
    this.control = view("after_sale.control");
  }

  /** Synthetic: the new owner appointed the platform's account again (appoint_operator). */
  reappointPlatform() {
    this.control = { ...this.control, operators: [[OPERATOR, 1, this.control.generation]] };
  }

  tick(ms: bigint) {
    this.ts += ms;
    this.height += 1;
  }

  /** A change lands in a new block one second later (block time rises: assumption A1). */
  private nextBlock() {
    this.height += 1;
    this.ts += 1_000n;
  }

  block(): PinnedBlock {
    return {
      height: String(this.height),
      hash: hashOf(this.height),
      timestamp_ms: String(this.ts),
    };
  }

  ent(customer = CUSTOMER) {
    return this.ents.get(customer) ?? null;
  }

  /**
   * Job 003wf2: the sale half of the same state model (DIRECT_SALE.md §6). When attached, it
   * answers control, treasury, outcomes, pending, party and sale-terms views and applies sale
   * calls; this double's purchases, holds, settlements and releases move its treasury buckets,
   * and metering is checked against its operators. Unattached, the fixed fixture views stay.
   */
  sale: SaleChain | null = null;

  /** Attaches a coherent sale double derived from this double's own state (no live deal). */
  attachSale(opts: { minReserve?: bigint; owner?: string } = {}) {
    const price = BigInt(this.plan.unit_price);
    let free = 0n;
    let held = 0n;
    let earned = 0n;
    for (const e of this.ents.values()) {
      free += BigInt(e.free) * price;
      held += BigInt(e.hold_active ? e.hold_units - e.hold_charged : 0) * price;
      earned += BigInt(e.consumed) * price;
    }
    const owner = opts.owner ?? (this.control.owner as string);
    this.sale = new SaleChain(
      {
        business: this.business,
        asset: TOKEN,
        now_ms: this.ts,
        storage_byte_cost: this.byteCost,
        min_reserve: opts.minReserve ?? 5n * price,
        plan_count: 1,
        payout_seq: 0n,
        deal_seq: 0n,
        control: {
          owner,
          generation: 1,
          // A plan created and the metering operator appointed: two control steps.
          control_seq: "2",
          close_mode: "direct",
          closer: null,
          service_manifest: "0".repeat(64),
          manifest_seq: "0",
          // The double's current metering operators (e.g. the configured platform account).
          operators: (this.control.operators as [string, number, number][]).map(([a, c]) => [
            a,
            c,
            1,
          ]),
          live_deal: null,
        },
        treasury: {
          held: String(free + held + earned),
          ent_free_value: String(free),
          ent_held_value: String(held),
          available: String(earned),
          pending_total: "0",
          claims_total: "0",
          escrow_total: "0",
        },
        pending: [],
        outcomes: [],
        parties: {
          [owner]: {
            profit_claim: "0",
            escrow_return_claim: "0",
            sale_proceeds_claim: "0",
            pending_refs: 0,
            payer: owner,
            deposit: "0",
          },
        },
      },
      { balances: this.balances, registered: this.tokenRegistered },
    );
    // The business holds the tokens its treasury accounts for.
    this.balances.set(this.business, free + held + earned);
    this.tokenRegistered.add(this.business);
    return this.sale;
  }

  /** A sale call: one of the business's sale methods, or a funding transfer to it. */
  private isSaleCall(call: { receiverId: string; methodName: string; args: Json }) {
    if (call.receiverId === this.business)
      return (
        /_guarded$|^accept_sale$|^close_sale$|^abort_close$/.test(call.methodName) &&
        call.methodName !== "revoke_key_guarded"
      );
    if (call.receiverId !== TOKEN || call.methodName !== "ft_transfer_call") return false;
    try {
      return "fund_deal" in (JSON.parse(String(call.args.msg)) as Json);
    } catch {
      return false;
    }
  }

  private saleUnits(units: number | bigint) {
    return BigInt(units) * BigInt(this.plan.unit_price);
  }

  answer(method: string, args: Record<string, unknown>): string {
    this.bump();
    if (this.sale) {
      this.sale.now = this.ts;
      const v = this.sale.view(method, args as Json);
      if (v !== undefined) return v;
    }
    if (method === "get_control") return JSON.stringify(this.control);
    if (method === "get_treasury") return JSON.stringify(this.treasury);
    if (method === "get_plan") return JSON.stringify(args.plan_id === 1 ? this.plan : null);
    if (method === "get_entitlement")
      return JSON.stringify(args.plan_id === 1 ? this.ent(String(args.customer)) : null);
    if (method === "check_use") return JSON.stringify(this.checkUse(args));
    if (method === "get_purchase_terms") {
      if (!this.purchaseTerms) throw new Error("MethodNotFound: get_purchase_terms");
      const c = String(args.customer);
      return JSON.stringify({
        version: 1,
        shell_bytes: String(811 + Buffer.byteLength(c)),
        storage_byte_cost: String(this.byteCost),
        binds_registration: true,
      });
    }
    // Job 003wec: the guarded revocation capability (lib.rs get_key_terms).
    if (method === "get_key_terms") {
      if (!this.keyTerms) throw new Error("MethodNotFound: get_key_terms");
      return JSON.stringify({ version: 1, guarded_revoke: true });
    }
    if (method.startsWith("ft_") || method.startsWith("storage_balance"))
      return this.tokenAnswer(method, args);
    throw new Error(`no view ${method}`);
  }

  // ---------- Job 003web: the offer's token and a fresh customer's purchase ----------
  // A TEST DOUBLE of the business's own fungible token (NEP-141/145, tusd.near) and of the
  // contract's sponsor_shell / ft_on_transfer, applying lib.rs's rules to the CALLS a wallet sends
  // (never seeding a post-state). Every outcome is checked against the contract's own
  // customer-purchase.json in server/test/purchase-world.test.ts. Its metadata is fictional.
  token = { spec: "ft-1.0.0", name: "Test USD (fixture)", symbol: "TUSD", decimals: 6 };
  /** Fictional balances: the fresh customer holds their OWN test tokens (no faucet here). */
  balances = new Map<string, bigint>([
    [CUSTOMER, 10_000_000n],
    [FRESH, 10_000_000n],
  ]);
  tokenRegistered = new Set<string>([CUSTOMER, FRESH, BUSINESS]);
  readonly storageMin = 1_250_000_000_000_000_000_000n;
  readonly byteCost = 10_000_000_000_000_000_000n;
  private regSeq = 1;
  readonly txs = new Map<string, Json>();
  /** False: an older deployed contract without get_purchase_terms (purchase unavailable). */
  purchaseTerms = true;
  /** False: an older deployed contract without get_key_terms (no guarded revocation). */
  keyTerms = true;
  /** Synthetic fault: the token's ft_resolve_transfer receipt fails (refund unconfirmed). */
  failResolution = false;
  private txCount = 0;

  private tokenAnswer(method: string, args: Record<string, unknown>): string {
    if (method === "ft_metadata")
      return JSON.stringify({ ...this.token, icon: null, reference: null, reference_hash: null });
    if (method === "ft_balance_of")
      return JSON.stringify(String(this.balances.get(String(args.account_id)) ?? 0n));
    if (method === "storage_balance_of")
      return JSON.stringify(
        this.tokenRegistered.has(String(args.account_id))
          ? { total: String(this.storageMin), available: "0" }
          : null,
      );
    if (method === "storage_balance_bounds")
      return JSON.stringify({ min: String(this.storageMin), max: String(this.storageMin) });
    throw new Error(`no token view ${method}`);
  }

  /** sponsor_shell (lib.rs): exactly the measured growth, the excess refunded, never twice. */
  private sponsorShell(payer: string, args: Json, deposit: bigint): string[] {
    const customer = String(args.customer);
    if (args.plan_id !== 1) throw new ChainRefusal("E_ARGS: no such plan");
    if (this.ents.has(customer)) throw new ChainRefusal("E_EXISTS: already registered");
    const bytes = 811n + BigInt(Buffer.byteLength(customer));
    const cost = bytes * this.byteCost;
    if (deposit < cost)
      throw new ChainRefusal(`E_STORAGE: attach at least ${cost} yoctoNEAR for ${bytes} bytes`);
    const regId = ++this.regSeq;
    const shell = JSON.parse(PURCHASE.shells[5].entitlement as string) as Json;
    this.ents.set(customer, {
      ...shell,
      reg_id: String(regId),
      storage_payer: payer,
      storage_paid: String(cost),
    });
    this.nextBlock();
    return [event("shell_sponsored", { customer, plan_id: 1, reg_id: String(regId), payer })];
  }

  /** ft_on_transfer + validate_buy (lib.rs): accepted, or the whole amount returned. */
  onTransfer(sender: string, amount: bigint, msg: string): { unused: bigint; logs: string[] } {
    const back = (reason: string) => ({
      unused: amount,
      logs: [event("purchase_returned", { customer: sender, amount: String(amount), reason })],
    });
    let buy: Json;
    try {
      buy = (JSON.parse(msg) as Json).buy as Json;
      if (!buy || typeof buy !== "object") return back("malformed message");
    } catch {
      return back("malformed message");
    }
    if (buy.plan_id !== 1) return back("no such plan");
    const e = this.ents.get(sender);
    if (!e) return back("no entitlement record; sponsor a shell first");
    if (buy.reg_id !== undefined && buy.reg_id !== null && String(buy.reg_id) !== e.reg_id)
      return back("registration changed since this purchase was prepared");
    const units = Number(buy.units);
    if (!Number.isInteger(units) || units < 1 || units > this.plan.max_units_per_purchase)
      return back("units outside the plan's purchase limit");
    if (BigInt(units) * BigInt(this.plan.unit_price) !== amount)
      return back("amount is not units times the plan price");
    if (buy.purchase_seq !== e.purchase_seq + 1)
      return back("purchase sequence is not the next one");
    const held = e.hold_active ? e.hold_units - e.hold_charged : 0;
    if (BigInt(e.free) + BigInt(held) + BigInt(units) > BigInt(this.plan.max_units_outstanding))
      return back("over the plan's outstanding units cap");
    const install = buy.install as Json | null | undefined;
    if (install) {
      const k = e.keys[install.slot] as Json | undefined;
      if (!k) return back("key slot 0-3");
      if (k.state === "active") return back("that key slot is in use");
      if (!/^[0-9a-f]{64}$/.test(String(install.pk)))
        return back("public key is 64 hex characters");
      if (
        install.max_hold_units < 1 ||
        install.max_hold_units > this.plan.max_hold_units ||
        install.max_units_per_day < 1
      )
        return back("key policy outside the plan");
      Object.assign(k, {
        state: "active",
        epoch: k.epoch + 1,
        public_key: install.pk,
        max_hold_units: install.max_hold_units,
        max_units_per_day: install.max_units_per_day,
      });
      e.key_states = e.keys.map(
        (x: Json) => ({ empty: 0, active: 1, revoked: 2 })[x.state as string],
      );
      e.key_epochs = e.keys.map((x: Json) => x.epoch);
    }
    Object.assign(e, {
      free: String(BigInt(e.free) + BigInt(units)),
      purchased: String(BigInt(e.purchased) + BigInt(units)),
      purchase_seq: e.purchase_seq + 1,
      active: true,
    });
    this.sale?.customerBought(amount);
    this.nextBlock();
    return {
      unused: 0n,
      logs: [
        event("units_bought", { customer: sender, plan_id: 1, units, amount: String(amount) }),
      ],
    };
  }

  /**
   * One wallet transaction from `signer`: sponsor_shell, the token's storage_deposit or its
   * ft_transfer_call, by their real rules. Returns the transaction's FINAL outcome (also kept by
   * hash for `tx`), with the business receipt's logs. A refusal is a failed transaction.
   */
  walletCall(
    signer: string,
    call: { receiverId: string; methodName: string; args: Json; deposit: string; gas: string },
  ): Json {
    this.bump();
    // Job 003wf2: the sale's calls go to the sale half of the same state (same ledger and log).
    if (this.sale && this.isSaleCall(call)) {
      this.sale.now = this.ts;
      const out = this.sale.walletCall(signer, call);
      this.txs.set(out.transaction.hash, out);
      this.nextBlock();
      return out;
    }
    const hash = base58(
      createHash("sha256")
        .update(`fixture-tx-${++this.txCount}`)
        .digest(),
    );
    const deposit = BigInt(call.deposit);
    const receipts: Json[] = [];
    const rid = (k: string) => `${hash.slice(0, 8)}-${k}`;
    const ok = (
      executor: string,
      logs: string[],
      value = "",
      id = rid("call"),
      children: string[] = [],
    ) => ({
      id,
      outcome: {
        executor_id: executor,
        logs,
        receipt_ids: children,
        status: { SuccessValue: value },
      },
    });
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");
    let failure: string | null = null;
    // The transaction's own final value: for ft_transfer_call, the token resolution's (the amount used).
    let topValue = "";
    try {
      if (call.receiverId === BUSINESS && call.methodName === "sponsor_shell") {
        receipts.push(ok(BUSINESS, this.sponsorShell(signer, call.args, deposit)));
      } else if (call.receiverId === TOKEN && call.methodName === "storage_deposit") {
        if (deposit < this.storageMin)
          throw new ChainRefusal("The attached deposit is less than the minimum storage balance");
        this.tokenRegistered.add(String(call.args.account_id ?? signer));
        receipts.push(ok(TOKEN, []));
      } else if (call.receiverId === TOKEN && call.methodName === "ft_transfer_call") {
        if (deposit !== 1n)
          throw new ChainRefusal("Requires attached deposit of exactly 1 yoctoNEAR");
        const amount = BigInt(String(call.args.amount));
        const receiver = String(call.args.receiver_id);
        if (!this.tokenRegistered.has(signer))
          throw new ChainRefusal(`The account ${signer} is not registered`);
        if (!this.tokenRegistered.has(receiver))
          throw new ChainRefusal(`The account ${receiver} is not registered`);
        const have = this.balances.get(signer) ?? 0n;
        if (have < amount) throw new ChainRefusal("The account doesn't have enough balance");
        this.balances.set(signer, have - amount);
        this.balances.set(receiver, (this.balances.get(receiver) ?? 0n) + amount);
        receipts.push({
          id: rid("call"),
          outcome: {
            executor_id: TOKEN,
            logs: [],
            receipt_ids: [rid("receiver"), rid("resolution")],
            status: { SuccessReceiptId: rid("resolution") },
          },
        });
        const r = this.onTransfer(signer, amount, String(call.args.msg));
        receipts.push(ok(BUSINESS, r.logs, b64(String(r.unused)), rid("receiver")));
        if (!this.failResolution) topValue = b64(String(amount - r.unused));
        if (r.unused > 0n) {
          // ft_resolve_transfer: the unused amount goes back to the sender.
          this.balances.set(receiver, (this.balances.get(receiver) ?? 0n) - r.unused);
          this.balances.set(signer, (this.balances.get(signer) ?? 0n) + r.unused);
        }
        receipts.push(
          this.failResolution
            ? {
                id: rid("resolution"),
                outcome: {
                  executor_id: TOKEN,
                  logs: [],
                  receipt_ids: [],
                  status: { Failure: { ActionError: "synthetic resolution failure" } },
                },
              }
            : ok(TOKEN, [], b64(String(amount - r.unused)), rid("resolution")),
        );
      } else throw new ChainRefusal("E_ARGS: not a purchase-path call");
    } catch (err) {
      if (!(err instanceof ChainRefusal)) throw err;
      failure = err.message;
    }
    const outcome = {
      final_execution_status: "FINAL",
      transaction: {
        hash,
        signer_id: signer,
        receiver_id: call.receiverId,
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
      status: failure
        ? { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: failure } } } } }
        : this.failResolution && call.methodName === "ft_transfer_call"
          ? { Failure: { ActionError: "synthetic resolution failure" } }
          : { SuccessValue: topValue },
      transaction_outcome: {
        id: hash,
        outcome: {
          executor_id: signer,
          logs: [],
          receipt_ids: [rid("call")],
          status: { SuccessReceiptId: rid("call") },
        },
      },
      receipts_outcome: failure
        ? [
            {
              id: rid("call"),
              outcome: {
                executor_id: call.receiverId,
                logs: [],
                receipt_ids: [],
                status: {
                  Failure: {
                    ActionError: { kind: { FunctionCallError: { ExecutionError: failure } } },
                  },
                },
              },
            },
          ]
        : receipts,
    };
    this.txs.set(hash, outcome);
    return outcome;
  }

  /** check_use (lib.rs `check_use`), over the double's state. */
  private checkUse(args: Record<string, unknown>) {
    const answer = (status: string, slot_used: boolean | null, closed_root: string | null) => ({
      status,
      slot_used,
      closed_root,
    });
    const e = this.ent(String(args.customer));
    if (!e || args.plan_id !== 1) return answer("no_entitlement", null, null);
    if (e.reg_id !== args.reg_id) return answer("other_registration", null, null);
    const fpHex = String(args.fingerprint);
    if (!/^[0-9a-f]{64}$/.test(fpHex)) return answer("invalid", null, null);
    const slot = Number(args.slot);
    const bit = slot < 10 ? 1 << slot : 0;
    if (e.hold_active && e.hold_seq === args.hold_seq) {
      if (slot >= e.hold_units) return answer("invalid", null, null);
      if ((e.hold_used & bit) === 0) return answer("unused", false, null);
      return e.hold_slots[slot] === fpHex
        ? answer("charged", true, null)
        : answer("conflict", true, null);
    }
    if (e.last_hold_seq === args.hold_seq && args.hold_seq !== 0)
      return answer("closed", bit !== 0 && (e.last_hold_used & bit) !== 0, e.last_hold_root);
    return answer("unknown_hold", null, null);
  }

  /** settle_hold (lib.rs): the whole batch is checked first; close returns the rest. */
  settleHold(
    signer: string,
    customer: string,
    holdSeq: number,
    uses: { slot: number; fingerprint: string; sig: string }[],
    close: boolean,
    verify: (pk: string, message: string, sig: string) => boolean,
  ): string[] {
    this.bump();
    if (!this.meters(signer)) throw new ChainRefusal("E_NOT_OPERATOR");
    const e = this.ent(customer) as Json;
    if (!e?.hold_active || e.hold_seq !== holdSeq) throw new ChainRefusal("E_HOLD_CLOSED");
    if (this.ts > BigInt(e.settle_until_ms)) throw new ChainRefusal("E_EXPIRED");
    if (uses.length > e.hold_units) throw new ChainRefusal("E_BATCH");
    let used = e.hold_used as number;
    const slots = [...(e.hold_slots as (string | null)[])];
    const out: string[] = [];
    let newly = 0;
    for (const u of uses) {
      if (u.slot >= e.hold_units) throw new ChainRefusal("E_SLOT");
      const ref = {
        business: this.business,
        plan_id: 1,
        customer,
        reg_id: e.reg_id as string,
        key_slot: e.hold_key_slot as number,
        key_epoch: e.hold_key_epoch as number,
      };
      const message = sha256(
        preimageOfUse(ref, { hold_seq: holdSeq, slot: u.slot, fingerprint: u.fingerprint }),
      ).toString("hex");
      if (!verify(this.holdPk.get(customer) as string, message, u.sig))
        throw new ChainRefusal("E_SIG");
      const bit = 1 << u.slot;
      if (used & bit) {
        if (slots[u.slot] === u.fingerprint) out.push("already");
        else throw new ChainRefusal("E_CONFLICT");
      } else {
        used |= bit;
        slots[u.slot] = u.fingerprint;
        newly++;
        out.push("charged");
      }
    }
    Object.assign(e, {
      hold_used: used,
      hold_slots: slots,
      hold_charged: e.hold_charged + newly,
      consumed: String(BigInt(e.consumed) + BigInt(newly)),
    });
    if (newly > 0) this.sale?.customerCharged(this.saleUnits(newly));
    if (close) this.release(customer);
    else this.nextBlock();
    if (newly > 0) this.charged += newly;
    return out;
  }

  /** release_hold (lib.rs): an operator any time; anyone once the settle deadline has passed. */
  releaseHold(signer: string, customer: string, holdSeq: number) {
    this.bump();
    const e = this.ent(customer) as Json;
    if (!e?.hold_active || e.hold_seq !== holdSeq) throw new ChainRefusal("E_HOLD_CLOSED");
    if (this.ts <= BigInt(e.settle_until_ms) && !this.meters(signer))
      throw new ChainRefusal("E_NOT_OPERATOR");
    this.release(customer);
    this.released++;
  }

  /** release_hold_for (lib.rs, 003o1): the registration is checked in the same call. */
  releaseHoldFor(signer: string, customer: string, regId: string, holdSeq: number) {
    const e = this.ent(customer);
    if (!e) throw new ChainRefusal("E_ARGS");
    if (e.reg_id !== regId) throw new ChainRefusal("E_REGISTRATION");
    this.releaseHold(signer, customer, holdSeq);
  }

  private meters(signer: string) {
    if (this.sale) return this.sale.meters(signer);
    if (signer === this.control.owner) return true;
    return (this.control.operators as [string, number, number][]).some(
      ([a, caps, g]) => a === signer && (caps & 1) !== 0 && g === this.control.generation,
    );
  }

  /** open_hold's rules, in the contract's order (lib.rs open_hold). */
  openHold(
    signer: string,
    customer: string,
    auth: {
      hold_seq: number;
      units: number;
      serve_until_ms: string;
      key_slot: number;
      key_epoch: number;
    },
    sig: string,
    verify: (pk: string, message: string, sig: string) => boolean,
  ): "opened" | "already" {
    this.bump();
    if (!this.meters(signer)) throw new ChainRefusal("E_NOT_OPERATOR");
    const e = this.ent(customer);
    if (!e) throw new ChainRefusal("E_STATE");
    const ref = {
      business: this.business,
      plan_id: 1,
      customer,
      reg_id: e.reg_id as string,
      key_slot: auth.key_slot,
      key_epoch: auth.key_epoch,
    };
    const message = sha256(preimageOfHold(ref, auth)).toString("hex");
    if (
      e.hold_active &&
      e.hold_seq === auth.hold_seq &&
      e.hold_units === auth.units &&
      e.serve_until_ms === auth.serve_until_ms &&
      e.hold_key_slot === auth.key_slot &&
      e.hold_key_epoch === auth.key_epoch
    ) {
      if (!verify(this.holdPk.get(customer) as string, message, sig))
        throw new ChainRefusal("E_SIG");
      return "already";
    }
    // 003wf3 (lib.rs open_hold): no NEW hold while the attached sale is Closing, for anyone.
    if (this.sale?.deal?.state === 2) throw new ChainRefusal("E_CLOSING");
    if (!(auth.hold_seq > e.hold_seq)) throw new ChainRefusal("E_HOLD_SEQ_USED");
    if (e.paused) throw new ChainRefusal("E_PAUSED");
    if (e.hold_active) throw new ChainRefusal("E_HOLD_ACTIVE");
    if (auth.hold_seq !== e.hold_seq + 1) throw new ChainRefusal("E_HOLD_SEQ");
    const k = e.keys[auth.key_slot];
    if (k?.state !== "active" || k.epoch !== auth.key_epoch) throw new ChainRefusal("E_KEY");
    if (!verify(k.public_key, message, sig)) throw new ChainRefusal("E_SIG");
    if (auth.units < 1 || BigInt(auth.units) > BigInt(e.free)) throw new ChainRefusal("E_UNITS");
    const serve = BigInt(auth.serve_until_ms);
    if (serve < this.ts + 60_000n) throw new ChainRefusal("E_EXPIRED");
    if (serve > this.ts + BigInt(this.plan.hold_ttl_ms)) throw new ChainRefusal("E_TTL");
    const day = Number(this.ts / 86_400_000n);
    const today = k.day === day ? k.held_today : 0;
    if (today + auth.units > k.max_units_per_day) throw new ChainRefusal("E_DAILY_CAP");
    k.day = day;
    k.held_today = today + auth.units;
    Object.assign(e, {
      hold_seq: auth.hold_seq,
      hold_active: true,
      hold_key_slot: auth.key_slot,
      hold_key_epoch: auth.key_epoch,
      hold_units: auth.units,
      hold_charged: 0,
      hold_used: 0,
      hold_slots: Array(auth.units).fill(null),
      hold_opened_at_ms: String(this.ts),
      serve_until_ms: auth.serve_until_ms,
      settle_until_ms: String(serve + BigInt(this.plan.settle_grace_ms)),
      free: String(BigInt(e.free) - BigInt(auth.units)),
    });
    this.sale?.customerHeld(this.saleUnits(auth.units));
    this.holdPk.set(customer, k.public_key);
    this.opened++;
    this.nextBlock();
    return "opened";
  }

  /** release_hold (lib.rs close_hold): uncharged units return; last_hold keeps seq/bitmap/root. */
  release(customer = CUSTOMER) {
    const e = this.ent(customer) as Json;
    const used = (e.hold_slots as (string | null)[])
      .map((f, i) => [i, f] as const)
      .filter((x): x is readonly [number, string] => x[1] !== null);
    this.sale?.customerReleased(this.saleUnits(e.hold_units - e.hold_charged));
    Object.assign(e, {
      free: String(BigInt(e.free) + BigInt(e.hold_units - e.hold_charged)),
      last_hold_seq: e.hold_seq,
      last_hold_used: e.hold_used,
      last_hold_charged: e.hold_charged,
      last_hold_root: sha256Hex(closedRootPreimage(used)),
      hold_active: false,
      hold_key_slot: 0,
      hold_key_epoch: 0,
      hold_units: 0,
      hold_charged: 0,
      hold_used: 0,
      hold_slots: [],
      hold_opened_at_ms: "0",
      serve_until_ms: "0",
      settle_until_ms: "0",
    });
    this.nextBlock();
  }

  /** revoke_key: the epoch rises; an active hold under that key stops serving now. */
  revoke(slot: number, customer = CUSTOMER) {
    const e = this.ent(customer) as Json;
    const k = e.keys[slot];
    k.epoch += 1;
    k.state = "revoked";
    e.key_states[slot] = 2;
    e.key_epochs[slot] = k.epoch;
    if (e.hold_active && e.hold_key_slot === slot && BigInt(e.serve_until_ms) > this.ts)
      e.serve_until_ms = String(this.ts);
    this.nextBlock();
  }

  /** skip_hold_seq: burns the next sequence (only with no hold open). */
  skip(customer = CUSTOMER) {
    const e = this.ent(customer) as Json;
    if (e.hold_active) throw new Error("E_HOLD_ACTIVE");
    e.hold_seq += 1;
    this.nextBlock();
  }

  /** set_paused. */
  pause(paused: boolean, customer = CUSTOMER) {
    (this.ent(customer) as Json).paused = paused;
    this.nextBlock();
  }
}

/** The read transport over the test double, with injected faults. Ceiling: the chain's. */
export class FixtureReader implements CustomerViewTransport {
  readonly network = "testnet";
  /** Answers this many reads with an older block (a lagging endpoint). */
  lagging = 0;
  failNext = 0;
  mixNext = false;
  malformedNext = false;
  /**
   * Labelled synthetic history (job 003m1): while set, every read answers at this block with
   * these views (decoded contract JSON), as an endpoint serving an older or forked state would.
   */
  scripted: { block: PinnedBlock; views: Record<string, Json | null> } | null = null;
  private reads = 0;
  constructor(private readonly chain: FixtureChain) {}
  private readGate: { release: Promise<void>; arrive: () => void } | null = null;
  /** The next read waits at its final block until opened (job 003o1); then answers as set then. */
  holdNextRead() {
    let open: () => void = () => {};
    let arrive: () => void = () => {};
    const release = new Promise<void>((r) => {
      open = r;
    });
    const entered = new Promise<void>((r) => {
      arrive = r;
    });
    this.readGate = { release, arrive };
    return { open, entered };
  }
  async finalBlock(): Promise<PinnedBlock> {
    if (++this.reads > 300) throw new Error("fixture reader ceiling reached");
    const gate = this.readGate;
    if (gate) {
      this.readGate = null;
      gate.arrive();
      await gate.release;
    }
    if (this.scripted) return this.scripted.block;
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("endpoint unavailable");
    }
    const b = this.chain.block();
    if (this.lagging > 0) {
      this.lagging--;
      const h = Number(b.height) - 5;
      return { height: String(h), hash: hashOf(h), timestamp_ms: b.timestamp_ms };
    }
    return b;
  }
  /** Runs once before the next view answers (job 003n: something lands during the read). */
  duringRead: (() => void) | null = null;
  /** Job 003web: a transaction's FINAL outcome, by hash, as the double recorded it. */
  async txOutcome(hash: string) {
    return this.chain.txs.get(hash) ?? null;
  }
  async view(input: { method: string; args: Record<string, unknown>; block: BlockRef }) {
    const during = this.duringRead;
    this.duringRead = null;
    during?.();
    const s = this.scripted;
    if (s && input.method in s.views)
      return { result: JSON.stringify(s.views[input.method]), block: input.block };
    let result = this.chain.answer(input.method, input.args);
    if (this.malformedNext && input.method !== "get_control") {
      this.malformedNext = false;
      // Synthetic mutation: an extra field the contract never sends.
      result = JSON.stringify({ ...(JSON.parse(result) as Json), surprise: 1 });
    }
    if (this.mixNext) {
      this.mixNext = false;
      const h = Number(input.block.height) + 1;
      return { result, block: { height: String(h), hash: hashOf(h) } };
    }
    return { result, block: input.block };
  }
}

interface Gate {
  /** Resolves once a submission is waiting at this gate. */
  entered: Promise<void>;
  /** Lets it through (idempotent). */
  open: () => void;
}
type Mode =
  | "ok"
  | "lose_reply"
  | "drop"
  | { gate: Gate; release: Promise<void>; arrive: () => void };

/** The hold writer over the test double. Ceiling: 50 submissions. */
export class FixtureWriter implements CustomerChainWriter {
  readonly network = "testnet";
  readonly signer = OPERATOR;
  modes: Mode[] = [];
  calls = 0;
  answers: WriterAnswer[] = [];
  /** The latest gate (`holdNext`), for tests holding one submission. */
  gateOpen: () => void = () => {};
  entered: Promise<void> = Promise.resolve();
  constructor(
    private readonly chain: FixtureChain,
    private readonly verify: (pk: string, m: string, s: string) => boolean,
  ) {}
  /** The next queued submission waits inside the writer until its gate opens. */
  holdNext(): Gate {
    let open: () => void = () => {};
    let arrive: () => void = () => {};
    const release = new Promise<void>((r) => {
      open = r;
    });
    const entered = new Promise<void>((r) => {
      arrive = r;
    });
    const gate = { entered, open };
    this.modes.push({ gate, release, arrive });
    this.gateOpen = open;
    this.entered = entered;
    return gate;
  }
  /** Settle and release submissions, counted apart (job 003o). */
  settleCalls = 0;
  releaseCalls = 0;
  /** Faults for settle/release only, so reservation faults stay independent. */
  unitModes: Mode[] = [];

  /** One submission: its fault mode, then the double's rule; the shared ceiling is 200. */
  private async submit(modes: Mode[], apply: () => WriterAnswer["status"]): Promise<WriterAnswer> {
    if (++this.calls > 200) throw new Error("fixture writer ceiling reached");
    const mode = modes.shift() ?? "ok";
    if (mode === "drop") throw new Error("network: the request never arrived");
    if (typeof mode === "object") {
      mode.arrive();
      await mode.release;
    }
    let answer: WriterAnswer;
    try {
      answer = { status: apply() } as WriterAnswer;
    } catch (e) {
      if (e instanceof ChainRefusal) answer = { status: "refused", code: e.code };
      else throw e;
    }
    this.answers.push(answer);
    if (mode === "lose_reply") throw new Error("network: the response was lost");
    return answer;
  }

  openHold(input: Parameters<CustomerChainWriter["openHold"]>[0]): Promise<WriterAnswer> {
    return this.submit(this.modes, () =>
      this.chain.openHold(this.signer, input.customer, input.auth, input.sig, this.verify),
    );
  }

  /** A unit-step gate (job 003o): the next settle or release waits until it opens. */
  holdNextUnit(): Gate {
    const g = this.holdNext();
    this.unitModes.push(this.modes.pop() as Mode);
    return g;
  }

  settleHold(input: Parameters<NonNullable<CustomerChainWriter["settleHold"]>>[0]) {
    this.settleCalls++;
    return this.submit(this.unitModes, () => {
      this.chain.settleHold(
        this.signer,
        input.customer,
        input.hold_seq,
        input.uses,
        input.close,
        this.verify,
      );
      return "applied";
    });
  }

  releaseHoldFor(input: Parameters<NonNullable<CustomerChainWriter["releaseHoldFor"]>>[0]) {
    this.releaseCalls++;
    return this.submit(this.unitModes, () => {
      this.chain.releaseHoldFor(this.signer, input.customer, input.reg_id, input.hold_seq);
      return "applied";
    });
  }
}

/** A labelled synthetic protection double: it keeps inputs in memory, never on disk. */
export class SyntheticProtection implements InputProtection {
  readonly scheme = "synthetic-test-only";
  kept = new Map<string, Buffer>();
  kinds = new Map<string, string>();
  calls = 0;
  /** The next this-many protect calls fail (job 003n). */
  failProtect = 0;
  deleted: string[] = [];
  /** The next this-many delete calls fail (job 003n1). */
  failDelete = 0;
  /** While set, protecting a result waits here (job 003n1: a crash before it is recorded). */
  resultGate: { release: Promise<void>; arrive: () => void } | null = null;
  private n = 0;
  holdResults() {
    let open: () => void = () => {};
    let arrive: () => void = () => {};
    const release = new Promise<void>((r) => {
      open = r;
    });
    const entered = new Promise<void>((r) => {
      arrive = r;
    });
    this.resultGate = { release, arrive };
    return { open, entered };
  }
  /** Job 003v: each reference's context; load and delete refuse any other, like the real store. */
  contexts = new Map<string, ProtectedContext>();
  created = new Map<string, number>();
  async protect(input: ProtectedContext & { bytes: Buffer }) {
    if (++this.calls > 100) throw new Error("synthetic protection ceiling reached");
    // The gate first, so a protection can also fail after it waited (job 003o1).
    if (input.kind === "result" && this.resultGate) {
      this.resultGate.arrive();
      await this.resultGate.release;
    }
    if (this.failProtect > 0) {
      this.failProtect--;
      throw new Error("synthetic protection failure");
    }
    const ref = `ref-${String(++this.n).padStart(6, "0")}`;
    this.kept.set(ref, input.bytes);
    this.kinds.set(ref, input.kind);
    this.contexts.set(ref, {
      person_id: input.person_id,
      request_id: input.request_id,
      kind: input.kind,
    });
    this.created.set(ref, Date.now());
    return ref;
  }
  private sameContext(ref: string, ctx: ProtectedContext) {
    const c = this.contexts.get(ref);
    return (
      !c ||
      (c.person_id === ctx.person_id && c.request_id === ctx.request_id && c.kind === ctx.kind)
    );
  }
  async load(ref: string, ctx: ProtectedContext) {
    const b = this.kept.get(ref);
    if (!b) throw new Error("no such reference");
    if (!this.sameContext(ref, ctx)) throw new Error("context mismatch");
    return b;
  }
  async delete(ref: string, ctx: ProtectedContext) {
    if (this.failDelete > 0) {
      this.failDelete--;
      throw new Error("synthetic delete failure");
    }
    if (!this.sameContext(ref, ctx)) throw new Error("context mismatch");
    this.kept.delete(ref);
    this.contexts.delete(ref);
    this.deleted.push(ref);
  }
  async list(after: string | null, limit: number): Promise<ProtectedObjectInfo[]> {
    return [...this.contexts.entries()]
      .filter(([ref]) => after === null || ref > after)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .slice(0, limit)
      .map(([ref, c]) => ({ ref, ...c, created_ms: this.created.get(ref) ?? 0 }));
  }
}

/**
 * A provider script held at a gate until opened (job 003n). `abortable` rejects on the abort
 * signal like a real transport; otherwise it answers late, ignoring a cancellation.
 */
export function heldScript(answer: () => Promise<Answer>, abortable = false) {
  let open: () => void = () => {};
  let arrive: () => void = () => {};
  const release = new Promise<void>((r) => {
    open = r;
  });
  const entered = new Promise<void>((r) => {
    arrive = r;
  });
  const script = async (_req: unknown, signal: AbortSignal): Promise<Answer> => {
    arrive();
    if (abortable)
      await Promise.race([
        release,
        new Promise<never>((_, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new RuntimeFailure("Stopped", "cancelled", null)),
            { once: true },
          ),
        ),
      ]);
    else await release;
    return answer();
  };
  return { script, open, entered };
}

/**
 * What a customer's client does before signing (§3): recompute every preimage and the digest
 * from the envelope's plain fields, then sign the two digests with its own key.
 */
export function clientCheck(env: Envelope & { envelope_digest: string }) {
  const ref = {
    business: env.business_account,
    plan_id: env.plan_id,
    customer: env.customer_account,
    reg_id: env.reg_id,
    key_slot: env.key_slot,
    key_epoch: env.key_epoch,
  };
  const fp = sha256Hex(
    fingerprintPreimage({
      ...ref,
      network: env.network,
      hold_seq: env.hold.hold_seq,
      slot: env.use.slot,
      request_id: env.request_id,
      offer_id: env.offer_id,
      release_id: env.release_id,
      artifact_digest: env.artifact_digest,
      input_sha256: env.commitment.input_sha256,
      salt: env.commitment.salt_hex,
    }),
  );
  const hold = preimageOfHold(ref, env.hold);
  const use = preimageOfUse(ref, {
    hold_seq: env.hold.hold_seq,
    slot: env.use.slot,
    fingerprint: fp,
  });
  const { envelope_digest, ...rest } = env;
  return (
    fp === env.use.fingerprint_hex &&
    hold.toString("hex") === env.hold.preimage_hex &&
    sha256(hold).toString("hex") === env.hold.message_hex &&
    use.toString("hex") === env.use.preimage_hex &&
    sha256(use).toString("hex") === env.use.message_hex &&
    envelopeDigest(rest as Envelope) === envelope_digest
  );
}

/**
 * A founder with an active release, bound to the fixture business account, and a customer linked
 * to the fixture's customer account. `make` rebuilds the app on a store (a restart).
 */
export async function customerWorld(
  opts: {
    dbPath?: string;
    customer?: Partial<CustomerUseOptions>;
    noReader?: boolean;
    noWriter?: boolean;
    /** The runtime's options (job 003n), e.g. a short time limit. */
    runtime?: RuntimeOptions;
    /** No runtime provider in the customer app (job 003n). */
    noProvider?: boolean;
    /** A v3 view transport for owner observations and sale reconciliation (job 003o). */
    v3Transport?: ViewTransport | null;
    /** Job 003wf1: the bound business contract account (default the fixture one). */
    businessAccount?: string;
    /**
     * Job 003wf1: the runtime provider instead of the scripted extractor, e.g. the real
     * AnthropicRuntime over a synthetic HTTP seam, so a release is evaluated on that identity.
     */
    runtimeProvider?: RuntimeProvider;
    /** The v3 observation clock (job 003s1: a fixture clock in the acquisition preview). */
    v3Now?: () => number;
  } = {},
) {
  // The scripted extractor that passes the release check (fictional documents only).
  const provider = new ScriptedRuntime(correct);
  const runtimeProvider: RuntimeProvider = opts.runtimeProvider ?? provider;
  const rw = runtimeWorld(runtimeProvider, opts.runtime ?? {}, { dbPath: opts.dbPath });
  const f = await rw.founder("Ava Chen");
  await rw.release(f);
  const release = rw.store.db
    .prepare("SELECT id FROM runtime_releases WHERE project_id = ? AND state = 'active'")
    .get(f.project) as { id: string };
  const chain = new FixtureChain();
  if (opts.businessAccount) chain.business = opts.businessAccount;
  const { verifiesEd25519 } = await import("../src/customerSigning.ts");
  const reader = new FixtureReader(chain);
  const writer = new FixtureWriter(chain, verifiesEd25519);
  const clock = { now: Number(T0) };
  const options = (): CustomerUseOptions => ({
    reader: opts.noReader ? null : reader,
    writer: opts.noWriter ? null : writer,
    operatorAccount: OPERATOR,
    now: () => clock.now,
    ...opts.customer,
  });
  const v3 = {
    transport: opts.v3Transport ?? null,
    bindings: [{ business_id: f.business, network: "testnet", account: chain.business }],
    ...(opts.v3Now ? { now: opts.v3Now } : {}),
  };
  /** The managed runtime for a store: the founder's own, or (a restart) a new one, recovered. */
  const runtimeFor = (store: Store) => {
    if (store === rw.store && !opts.noProvider) return rw.runtime;
    const r = new ManagedRuntime(store.db, store, opts.noProvider ? null : runtimeProvider, {
      ceilingCents: 1_000,
      ...opts.runtime,
    });
    r.recover();
    return r;
  };
  /** `extra` (job 003w-e harness): e.g. verified identity and the wallet configuration. */
  const make = (
    store: Store,
    runtime = runtimeFor(store),
    extra: Partial<Parameters<typeof everstreetApi>[1]> = {},
  ) => {
    state.runtime = runtime;
    return everstreetApi(store, {
      localPreview: true,
      environment: "test",
      v3,
      customer: options(),
      runtime,
      ...extra,
    });
  };
  /** A CustomerUses over the same store and runtime, for the worker-only methods (job 003n). */
  /** `transform` (job 002d) adjusts the options, e.g. to guard the adapters. */
  const service = (transform: (o: CustomerUseOptions) => CustomerUseOptions = (o) => o) =>
    new CustomerUses(
      state.store.db,
      state.store,
      new V3Observations(state.store.db, state.store, v3),
      transform(options()),
      state.runtime,
    );
  const state = {
    store: rw.store,
    runtime: rw.runtime,
    app: null as unknown as ReturnType<typeof everstreetApi>,
  };
  state.app = make(rw.store);
  let tokens = 0;
  const sessionFor = (personId: string) => {
    const token = `test-session-${++tokens}-${personId}`;
    state.store.db
      .prepare("INSERT INTO sessions (token, person_id, created_at) VALUES (?, ?, ?)")
      .run(token, personId, new Date().toISOString());
    return token;
  };
  const caller = (personId: string) => {
    const token = sessionFor(personId);
    const call = async (path: string, method = "GET", body?: unknown) => {
      const res = await state.app.request(path, {
        method,
        headers: { cookie: `es_session=${token}`, "content-type": "application/json" },
        body: body === undefined || method === "GET" ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as Json };
    };
    return Object.assign(call, { id: personId });
  };
  const person = (name: string) => {
    const id = `person-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`;
    state.store.db
      .prepare(
        "INSERT INTO people (id, display_name, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING",
      )
      .run(id, name, new Date().toISOString());
    return caller(id);
  };
  const link = (personId: string, account: string) =>
    state.store.db
      .prepare(
        "INSERT INTO chain_accounts (owner_kind, owner_id, account_id, secret, tx, created_at) VALUES ('person', ?, ?, NULL, 'fixture', ?)",
      )
      .run(personId, account, new Date().toISOString());
  const owner = caller(f.ava.id);
  const cara = person("Cara Okafor");
  link(cara.id, CUSTOMER);
  // Job 003web: a fresh customer: linked account, no entitlement, no key, their own test tokens.
  const dana = person("Dana Reyes");
  link(dana.id, FRESH);
  /** Job 003r: inspect a plan as the owner and return the digest a create must present. */
  const reviewed = async (
    terms: { plan_id?: number; retention_days?: number; release_id?: string } = {},
    by = owner,
  ) => {
    const r = await by(`/api/businesses/${f.business}/customer-offer-inspections`, "POST", {
      release_id: release.id,
      plan_id: 1,
      retention_days: 30,
      ...terms,
    });
    if (r.status !== 200) throw new Error(`inspect: ${r.body.error}`);
    return r.body.inspection.terms_digest as string;
  };
  let firstReview: string | null = null; // offer() is the same idempotent request every time
  const offer = async () => {
    firstReview ??= await reviewed();
    const r = await owner(`/api/businesses/${f.business}/customer-offers`, "POST", {
      idempotency_key: "offer-key-0001",
      release_id: release.id,
      plan_id: 1,
      retention_days: 30,
      reviewed_terms: firstReview,
    });
    if (r.status !== 201 && r.status !== 200) throw new Error(`offer: ${r.body.error}`);
    return r.body.offer.id as string;
  };
  const sign1 = keyFromSeed(1);
  /** Prepare, check as the client would, and sign with the synthetic seed-1 key. */
  const signed = (env: Envelope & { envelope_digest: string }, signer = sign1) => ({
    envelope_digest: env.envelope_digest,
    hold_signature: signer(env.hold.message_hex),
    use_signature: signer(env.use.message_hex),
  });
  return {
    rw,
    f,
    release: release.id,
    chain,
    reader,
    writer,
    clock,
    state,
    make,
    owner,
    cara,
    dana,
    person,
    link,
    caller,
    offer,
    reviewed,
    v3,
    signed,
    sign1,
    provider,
    service,
    runtimeFor,
  };
}

export type CustomerWorld = Awaited<ReturnType<typeof customerWorld>>;
