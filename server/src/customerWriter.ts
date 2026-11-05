// Job 003w-d: the customer chain writer (docs/design/APPLICATION_COMPOSITION.md §8).
//
// It submits exactly three business-v3 calls as the configured operator on TESTNET:
// open_hold, settle_hold and release_hold_for (the registration-guarded release; there is no
// unguarded one). Durable submission identity: every call names an OPERATION (the request and
// the method); the writer keeps one durable attempt per operation in the records database, with
// the exact payload digest, nonce, block hash, signed bytes and hash, written BEFORE broadcast.
// - The same operation again never signs a fresh transaction while an earlier one could still
//   land: it reads that transaction's status and, if unknown, rebroadcasts the SAME signed bytes
//   (the same hash, so the chain can include it at most once). Only a used-nonce or expired-hash
//   admission refusal received by the SOLE counted sender of those bytes allows a fresh attempt
//   (§8); an expiry, a missing status or a row from before the upgrade never does.
// - A final outcome is recorded and answered again without a new transaction. A different
//   payload under the same operation is refused before anything is signed.
// - Nonces are allocated under SQLite's write lock (BEGIN IMMEDIATE) together with the attempt,
//   so separate connections and processes never sign two transactions with one nonce.
// The answer is an event only: the customer-use state machine's exact readback stays the proof.
//
// Wire formats (the NEAR protocol specification; to be re-verified against primary docs in the
// testnet rehearsal packet before any live use): Transaction { signer_id: string, public_key:
// { key_type: u8 = 0, data: [u8; 32] }, nonce: u64, receiver_id: string, block_hash: [u8; 32],
// actions: Vec<Action> }, Action::FunctionCall = variant 2 { method_name: string, args: Vec<u8>,
// gas: u64, deposit: u128 }; SignedTransaction { transaction, signature: { key_type: u8 = 0,
// data: [u8; 64] } }; the hash is sha256(borsh(transaction)), signed with ed25519. RPC methods:
// `block` (final), `query` view_access_key, `send_tx`, `tx`.

import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import type { CustomerChainWriter, WriterAnswer } from "./customerUse.ts";
import type { Db } from "./db.ts";
import { base58Decode } from "./identity.ts";
import { isAccountId } from "./v3read.ts";
import { type FetchLike, type RpcConfig, TestnetRpcTransport } from "./v3rpc.ts";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58Encode(b: Uint8Array): string {
  let n = 0n;
  for (const x of b) n = n * 256n + BigInt(x);
  let s = "";
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const x of b) {
    if (x !== 0) break;
    s = `1${s}`;
  }
  return s;
}

// ---------- Borsh ----------

class Borsh {
  private parts: Buffer[] = [];
  u8(v: number) {
    this.parts.push(Buffer.from([v]));
    return this;
  }
  u32(v: number) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v);
    this.parts.push(b);
    return this;
  }
  u64(v: bigint) {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(v);
    this.parts.push(b);
    return this;
  }
  u128(v: bigint) {
    const b = Buffer.alloc(16);
    b.writeBigUInt64LE(v & 0xffff_ffff_ffff_ffffn);
    b.writeBigUInt64LE(v >> 64n, 8);
    this.parts.push(b);
    return this;
  }
  bytes(b: Buffer) {
    this.parts.push(b);
    return this;
  }
  vec(b: Buffer) {
    return this.u32(b.length).bytes(b);
  }
  str(s: string) {
    return this.vec(Buffer.from(s, "utf8"));
  }
  done() {
    return Buffer.concat(this.parts);
  }
}

export interface FunctionCallTx {
  signer: string;
  publicKey: Buffer; // 32 bytes
  nonce: bigint;
  receiver: string;
  blockHash: Buffer; // 32 bytes
  method: string;
  args: Buffer;
  gas: bigint;
  deposit: bigint;
}

/** borsh(Transaction) with one FunctionCall action. */
export function encodeTransaction(t: FunctionCallTx): Buffer {
  if (t.publicKey.length !== 32 || t.blockHash.length !== 32)
    throw new Error("tx: bad key or hash");
  return new Borsh()
    .str(t.signer)
    .u8(0)
    .bytes(t.publicKey)
    .u64(t.nonce)
    .str(t.receiver)
    .bytes(t.blockHash)
    .u32(1)
    .u8(2)
    .str(t.method)
    .vec(t.args)
    .u64(t.gas)
    .u128(t.deposit)
    .done();
}

// ---------- the operator key ----------

const SECRET = /^ed25519:([1-9A-HJ-NP-Za-km-z]{60,100})$/;
const PUBLIC = /^ed25519:([1-9A-HJ-NP-Za-km-z]{32,50})$/;
const PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");

/** An operator key from its NEAR form; the secret never leaves this object. */
export class OperatorKey {
  readonly publicKey: string;
  readonly publicBytes: Buffer;
  private readonly key: ReturnType<typeof createPrivateKey>;
  constructor(secret: string, expectedPublic: string) {
    const m = SECRET.exec(secret);
    const p = PUBLIC.exec(expectedPublic);
    if (!m || !p) throw new Error("writer: the operator key isn't an ed25519 NEAR key");
    const raw = base58Decode(m[1] as string);
    if (raw.length !== 64) throw new Error("writer: the operator key isn't an ed25519 NEAR key");
    this.key = createPrivateKey({
      key: Buffer.concat([PKCS8_ED25519, raw.subarray(0, 32)]),
      format: "der",
      type: "pkcs8",
    });
    const derived = createPublicKey(this.key).export({ format: "der", type: "spki" }).subarray(-32);
    if (!derived.equals(raw.subarray(32)) || !derived.equals(base58Decode(p[1] as string)))
      throw new Error("writer: the operator key doesn't match its public key");
    this.publicBytes = Buffer.from(derived);
    this.publicKey = expectedPublic;
  }
  sign(hash: Buffer): Buffer {
    return sign(null, hash, this.key);
  }
}

// ---------- the transaction transport (allowlisted RPC) ----------

export type TxOutcome =
  | { kind: "success" }
  | { kind: "failure"; code: string }
  | { kind: "invalid"; reason: "nonce" | "expired" | "other" }
  | { kind: "not_found" }
  | { kind: "unknown" };

const ERROR_CODE = /\b(E_[A-Z_]{1,40})\b/;

/**
 * A FINAL outcome for exactly this transaction, mapped; anything else (an optimistic or partial
 * answer, another transaction's outcome, an unfinished receipt) is unknown. Astra reproduced the
 * earlier parser accepting SuccessReceiptId for the wrong hash at a non-final status.
 */
function outcomeOf(r: unknown, expectedHash: string): TxOutcome {
  const o = r as {
    final_execution_status?: unknown;
    transaction?: { hash?: unknown };
    status?: unknown;
  } | null;
  if (o?.final_execution_status !== "FINAL" || o.transaction?.hash !== expectedHash)
    return { kind: "unknown" };
  const status = o.status as Record<string, unknown> | undefined;
  if (!status || typeof status !== "object") return { kind: "unknown" };
  if ("SuccessValue" in status) {
    // The transaction succeeded; a receipt can still fail (the contract call). Check them.
    const failed = (
      (r as { receipts_outcome?: { outcome?: { status?: Record<string, unknown> } }[] })
        .receipts_outcome ?? []
    ).find((o) => o.outcome?.status && "Failure" in (o.outcome.status as object));
    if (failed)
      return {
        kind: "failure",
        code: ERROR_CODE.exec(JSON.stringify(failed.outcome?.status))?.[1] ?? "E_UNRECOGNIZED",
      };
    return { kind: "success" };
  }
  if ("Failure" in status)
    return {
      kind: "failure",
      code: ERROR_CODE.exec(JSON.stringify(status.Failure))?.[1] ?? "E_UNRECOGNIZED",
    };
  return { kind: "unknown" };
}

function errorOutcome(err: unknown): TxOutcome {
  const cause = (err as { cause?: { name?: unknown; info?: unknown } } | null)?.cause;
  const name = cause?.name;
  if (name === "UNKNOWN_TRANSACTION") return { kind: "not_found" };
  if (name === "INVALID_TRANSACTION") {
    const text = JSON.stringify(cause?.info ?? err);
    return {
      kind: "invalid",
      reason: /InvalidNonce/.test(text) ? "nonce" : /Expired/.test(text) ? "expired" : "other",
    };
  }
  return { kind: "unknown" }; // TIMEOUT_ERROR and anything else: the outcome isn't known
}

export interface TxRpc {
  accessKey(
    account: string,
    publicKey: string,
    signal?: AbortSignal,
  ): Promise<{ nonce: bigint; permission: unknown } | null>;
  latestBlock(signal?: AbortSignal): Promise<{ hash: string; height: bigint }>;
  sendTx(signedBase64: string, expectedHash: string, signal?: AbortSignal): Promise<TxOutcome>;
  txStatus(hash: string, sender: string, signal?: AbortSignal): Promise<TxOutcome>;
}

/** The writer's RPC: four documented methods only, with 003i's bounds (read-only base class). */
export class TestnetTxTransport extends TestnetRpcTransport implements TxRpc {
  constructor(config: RpcConfig, fetchImpl: FetchLike) {
    super(config, fetchImpl);
  }
  async accessKey(account: string, publicKey: string, signal?: AbortSignal) {
    const r = (await this.rpc(
      "query",
      {
        request_type: "view_access_key",
        finality: "final",
        account_id: account,
        public_key: publicKey,
      },
      signal,
      true,
    )) as Record<string, unknown> | null;
    if (!r || "rpcError" in r || "error" in r) return null;
    const nonce = r.nonce;
    if (typeof nonce !== "number" && typeof nonce !== "string") return null;
    return { nonce: BigInt(nonce), permission: r.permission };
  }
  async latestBlock(signal?: AbortSignal) {
    const r = (await this.rpc("block", { finality: "final" }, signal)) as {
      header?: { hash?: unknown; height?: unknown };
    };
    const h = r?.header;
    if (
      typeof h?.hash !== "string" ||
      typeof h.height !== "number" ||
      !Number.isSafeInteger(h.height)
    )
      throw new Error("writer: the final block has no hash or height");
    return { hash: h.hash, height: BigInt(h.height) };
  }
  async sendTx(signedBase64: string, expectedHash: string, signal?: AbortSignal) {
    try {
      const r = (await this.rpc(
        "send_tx",
        { signed_tx_base64: signedBase64, wait_until: "FINAL" },
        signal,
        true,
      )) as Record<string, unknown>;
      return r && "rpcError" in r ? errorOutcome(r.rpcError) : outcomeOf(r, expectedHash);
    } catch {
      return { kind: "unknown" } as const; // no answer: it may or may not land
    }
  }
  async txStatus(hash: string, sender: string, signal?: AbortSignal) {
    try {
      const r = (await this.rpc(
        "tx",
        { tx_hash: hash, sender_account_id: sender, wait_until: "FINAL" },
        signal,
        true,
      )) as Record<string, unknown>;
      return r && "rpcError" in r ? errorOutcome(r.rpcError) : outcomeOf(r, hash);
    } catch {
      return { kind: "unknown" } as const;
    }
  }
}

// ---------- the writer ----------

/** Blocks a transaction stays valid for (NEAR's transaction validity period; conservative). */
export const VALIDITY_BLOCKS = 86_400n;
const GAS = 100_000_000_000_000n; // 100 Tgas
const OPERATION = /^[A-Za-z0-9_.:-]{1,160}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;
const U64_DEC = /^(0|[1-9][0-9]{0,19})$/;

interface Attempt {
  operation: string;
  attempt: number;
  payload_digest: string;
  method: string;
  nonce: string;
  block_height: string;
  tx_hash: string;
  signed_tx: string;
  state: "signed" | "success" | "failure" | "invalid";
  code: string | null;
  signer: string;
  public_key: string;
  /** 'counted': every send since signing was claimed; 'uncounted': from before the upgrade. */
  history: "counted" | "uncounted";
  /** 'legacy_invalid': an earlier writer's invalid classification, not proof (db.ts upgrade). */
  reconcile: "legacy_invalid" | null;
}

export interface WriterOptions {
  network: "testnet";
  signer: string;
  key: OperatorKey;
  rpc: TxRpc;
  now?: () => number;
  /** TEST INSTRUMENTATION ONLY: called after an attempt is persisted, before it is broadcast. */
  afterPersist?: () => void;
  /**
   * Job 003wf3: the durable attempts table. The customer writer's is `chain_tx_attempts`; the
   * closer's is its own `closer_tx_attempts` (same columns and rules, MANAGED_HANDOVER.md §16).
   */
  table?: "chain_tx_attempts" | "closer_tx_attempts";
  /** Job 003wf3: refuse a full-access key (the closer must sign with its function-call key). */
  functionCallKeyOnly?: boolean;
}

export class TestnetCustomerWriter implements CustomerChainWriter {
  readonly network = "testnet";
  readonly signer: string;
  protected readonly now: () => number;
  protected readonly table: "chain_tx_attempts" | "closer_tx_attempts";

  constructor(
    protected readonly db: Db,
    protected readonly opts: WriterOptions,
  ) {
    this.table = opts.table ?? "chain_tx_attempts";
    if (opts.network !== "testnet") throw new Error("writer: only testnet is supported");
    if (!isAccountId(opts.signer) || !opts.signer.endsWith(".testnet"))
      throw new Error("writer: the operator must be a testnet account");
    this.signer = opts.signer;
    this.now = opts.now ?? Date.now;
  }

  openHold(input: Parameters<CustomerChainWriter["openHold"]>[0]) {
    const a = input.auth;
    const ok =
      HEX128.test(input.sig) &&
      U64_DEC.test(a.serve_until_ms) &&
      [a.hold_seq, a.key_epoch].every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff_ffff) &&
      [a.units, a.key_slot].every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
    return this.call(input, "open_hold", ok, {
      customer: input.customer,
      plan_id: input.plan_id,
      auth: {
        hold_seq: a.hold_seq,
        units: a.units,
        serve_until_ms: a.serve_until_ms,
        key_slot: a.key_slot,
        key_epoch: a.key_epoch,
      },
      sig: input.sig,
    });
  }

  settleHold(input: Parameters<NonNullable<CustomerChainWriter["settleHold"]>>[0]) {
    const ok =
      Number.isInteger(input.hold_seq) &&
      input.uses.length >= 1 &&
      input.uses.length <= 8 &&
      input.uses.every(
        (u) =>
          Number.isInteger(u.slot) &&
          u.slot >= 0 &&
          u.slot <= 255 &&
          HEX64.test(u.fingerprint) &&
          HEX128.test(u.sig),
      );
    return this.call(input, "settle_hold", ok, {
      customer: input.customer,
      plan_id: input.plan_id,
      hold_seq: input.hold_seq,
      uses: input.uses.map((u) => ({ slot: u.slot, fingerprint: u.fingerprint, sig: u.sig })),
      close: input.close,
    });
  }

  /** The registration-guarded release only: the contract checks reg_id in the same call. */
  releaseHoldFor(input: Parameters<NonNullable<CustomerChainWriter["releaseHoldFor"]>>[0]) {
    const ok = U64_DEC.test(input.reg_id) && Number.isInteger(input.hold_seq);
    return this.call(input, "release_hold_for", ok, {
      customer: input.customer,
      plan_id: input.plan_id,
      reg_id: input.reg_id,
      hold_seq: input.hold_seq,
    });
  }

  private async call(
    input: {
      network: string;
      account: string;
      customer: string;
      plan_id: number;
      operation?: string;
      signal: AbortSignal;
    },
    method: "open_hold" | "settle_hold" | "release_hold_for",
    shapeOk: boolean,
    args: Record<string, unknown>,
  ): Promise<WriterAnswer> {
    const refused = (code: string): WriterAnswer => ({ status: "refused", code });
    // Identities and payload shape first: nothing is read, signed or sent for a bad call.
    if (input.network !== "testnet") return refused("E_NETWORK");
    if (!isAccountId(input.account) || !input.account.endsWith(".testnet"))
      return refused("E_ACCOUNT");
    if (!isAccountId(input.customer)) return refused("E_ARGS");
    if (
      !Number.isInteger(input.plan_id) ||
      input.plan_id < 0 ||
      input.plan_id > 0xffff_ffff ||
      !shapeOk
    )
      return refused("E_ARGS");
    if (typeof input.operation !== "string" || !OPERATION.test(input.operation))
      return refused("E_OPERATION");
    const success = method === "open_hold" ? "opened" : "applied";
    return this.submit(input.operation, method, input.account, args, input.signal, success);
  }

  /**
   * One durable submission of exactly (method, receiver, args) under `operation`: the same
   * attempt rules for every caller (job 003wf3 shares them with the closer).
   */
  protected async submit(
    operation: string,
    method: string,
    receiver: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
    success: "opened" | "applied",
  ): Promise<WriterAnswer> {
    const refused = (code: string): WriterAnswer => ({ status: "refused", code });
    const op = `${operation}|${method}`;
    const payload = JSON.stringify({ method, receiver, args });
    const digest = createHash("sha256").update(payload).digest("hex");
    const input = { account: receiver, signal };

    const latest = this.latest(op);
    if (latest && latest.payload_digest !== digest) return refused("E_PAYLOAD_MISMATCH");
    // An attempt made under another operator account or key is never queried or rebroadcast
    // under this one: it needs explicit reconciliation.
    if (latest && (latest.signer !== this.signer || latest.public_key !== this.opts.key.publicKey))
      return refused("E_SIGNER_CHANGED");
    if (latest?.state === "success") return { status: "already", tx: latest.tx_hash };
    if (latest?.state === "failure")
      return { status: "refused", code: latest.code ?? "E_UNRECOGNIZED", tx: latest.tx_hash };
    if (latest?.state === "signed") {
      const resolved = await this.resolve(latest, input.signal);
      return resolved === "success" ? { status: success, tx: latest.tx_hash } : resolved;
    }
    // An 'invalid' newest attempt allows a fresh one only if EVERY attempt of this operation was
    // proven invalid by its sole counted sender. Otherwise (an upgraded earlier classification)
    // nothing fresh is read or signed: only that attempt's own FINAL status can resolve it.
    if (latest && !this.freshAllowed(op)) {
      const resolved = await this.resolveLegacy(latest, input.signal);
      return resolved === "success" ? { status: success, tx: latest.tx_hash } : resolved;
    }

    // A fresh attempt: read the key's nonce and permission and a recent block, then allocate,
    // sign and persist in ONE write transaction, and only then broadcast.
    let key: Awaited<ReturnType<TxRpc["accessKey"]>>;
    let block: Awaited<ReturnType<TxRpc["latestBlock"]>>;
    try {
      [key, block] = await Promise.all([
        this.opts.rpc.accessKey(this.signer, this.opts.key.publicKey, input.signal),
        this.opts.rpc.latestBlock(input.signal),
      ]);
    } catch {
      return { status: "unknown", detail: "read_failed" }; // nothing was signed
    }
    if (!key || !permits(key.permission, input.account, method)) return refused("E_SIGNER_KEY");
    if (this.opts.functionCallKeyOnly && key.permission === "FullAccess")
      return refused("E_FULL_ACCESS_KEY");
    const blockHash = base58Decode(block.hash);
    if (blockHash.length !== 32) return { status: "unknown", detail: "read_failed" };
    const created = this.persistAttempt(
      op,
      digest,
      method,
      input.account,
      args,
      key.nonce,
      blockHash,
      block,
    );
    if (created.kind === "raced") return { status: "unknown", detail: "in_flight" }; // another caller holds it
    if (created.kind === "blocked") return { status: "unknown", detail: "needs_reconciliation" };
    this.opts.afterPersist?.();
    return this.broadcast(created.attempt, input.signal, success);
  }

  /** The newest attempt for an operation. */
  private latest(op: string): Attempt | null {
    return (
      (this.db
        .prepare(`SELECT * FROM ${this.table} WHERE operation = ? ORDER BY attempt DESC LIMIT 1`)
        .get(op) as unknown as Attempt | undefined) ?? null
    );
  }

  /** Whether a fresh attempt may follow: every attempt so far is a COUNTED, proven invalid. */
  private freshAllowed(op: string): boolean {
    const r = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM ${this.table} WHERE operation = ? AND NOT (state = 'invalid' AND history = 'counted' AND reconcile IS NULL)`,
      )
      .get(op) as { n: number };
    return r.n === 0;
  }

  /**
   * The newest attempt is 'invalid' but that isn't proof for the whole operation (db.ts upgrade
   * policy). An upgraded 'legacy_invalid' attempt is resolved ONLY by its own FINAL status for its
   * exact hash, read without sending anything; anything else needs explicit reconciliation, and
   * no fresh transaction is ever made.
   */
  private async resolveLegacy(a: Attempt, signal: AbortSignal): Promise<"success" | WriterAnswer> {
    const unresolved = {
      status: "unknown",
      detail: "needs_reconciliation",
      tx: a.tx_hash,
    } as WriterAnswer;
    if (a.reconcile !== "legacy_invalid") return unresolved;
    const o = await this.opts.rpc.txStatus(a.tx_hash, this.signer, signal);
    if (o.kind !== "success" && o.kind !== "failure") return unresolved;
    const changed = this.db
      .prepare(
        `UPDATE ${this.table} SET state = ?, code = ?, reconcile = NULL, updated_ms = ? WHERE operation = ? AND attempt = ? AND state = 'invalid' AND reconcile = 'legacy_invalid'`,
      )
      .run(o.kind, o.kind === "failure" ? o.code : null, this.now(), a.operation, a.attempt);
    if (changed.changes !== 1) return this.fromRow(a);
    return o.kind === "success" ? "success" : { status: "refused", code: o.code, tx: a.tx_hash };
  }

  /**
   * An earlier attempt whose outcome isn't recorded (it may have been broadcast and may have
   * executed). Only its own FINAL status decides it. While it is still valid the SAME bytes are
   * broadcast again (one hash: included at most once). Nothing observed here, a missing status,
   * an expiry or a used nonce, proves it did NOT execute (Astra's CustomerWriterReview), so it
   * stays unknown and NO fresh transaction is ever made for this operation: past its validity it
   * needs explicit reconciliation, and the customer-use readback stays the authority.
   */
  private async resolve(a: Attempt, signal: AbortSignal): Promise<"success" | WriterAnswer> {
    const status = await this.opts.rpc.txStatus(a.tx_hash, this.signer, signal);
    if (status.kind === "success" || status.kind === "failure") return this.record(a, status);
    if (status.kind === "not_found") {
      let height: bigint;
      try {
        height = (await this.opts.rpc.latestBlock(signal)).height;
      } catch {
        return { status: "unknown", detail: "read_failed", tx: a.tx_hash } as WriterAnswer;
      }
      if (height > BigInt(a.block_height) + VALIDITY_BLOCKS)
        return { status: "unknown", detail: "needs_reconciliation", tx: a.tx_hash } as WriterAnswer;
      return this.send(a, signal);
    }
    return { status: "unknown", detail: "pending", tx: a.tx_hash } as WriterAnswer;
  }

  /**
   * Records a FINAL outcome, only over a still-'signed' attempt. If something else already
   * recorded a terminal state (another sender, a late callback), that durable state is the answer;
   * a late reply never undoes it.
   */
  private record(
    a: Attempt,
    o: { kind: "success" } | { kind: "failure"; code: string },
  ): "success" | WriterAnswer {
    if (!this.mark(a, o.kind, o.kind === "failure" ? o.code : null)) return this.fromRow(a);
    return o.kind === "success" ? "success" : { status: "refused", code: o.code, tx: a.tx_hash };
  }

  /** Moves a 'signed' attempt to a terminal state; false if it was no longer 'signed'. */
  private mark(a: Attempt, state: Attempt["state"], code: string | null): boolean {
    return (
      this.db
        .prepare(
          `UPDATE ${this.table} SET state = ?, code = ?, updated_ms = ? WHERE operation = ? AND attempt = ? AND state = 'signed'`,
        )
        .run(state, code, this.now(), a.operation, a.attempt).changes === 1
    );
  }

  /** The attempt's durable state as an answer. */
  private fromRow(a: Attempt): "success" | WriterAnswer {
    const r = this.db
      .prepare(
        `SELECT state, code, reconcile FROM ${this.table} WHERE operation = ? AND attempt = ?`,
      )
      .get(a.operation, a.attempt) as
      | { state: Attempt["state"]; code: string | null; reconcile: string | null }
      | undefined;
    if (r?.state === "success") return "success";
    if (r?.state === "failure")
      return { status: "refused", code: r.code ?? "E_UNRECOGNIZED", tx: a.tx_hash };
    return {
      status: "unknown",
      detail: r?.state !== "invalid" ? "pending" : r.reconcile ? "needs_reconciliation" : "invalid",
      tx: a.tx_hash,
    } as WriterAnswer;
  }

  /**
   * Job 003w-d (Astra's overlapping first-broadcast counterexample): every send of an attempt's
   * bytes, first or repeated, by any connection or process, is CLAIMED durably before it
   * happens, by incrementing its `broadcasts` count while it is still 'signed'. A crash after
   * the claim counts as a send. So `broadcasts = 1` at the moment of a compare-and-set proves
   * that exactly one send of these bytes ever started: this one. That holds only for a row
   * COUNTED since it was signed (`history = 'counted'`); a row from before the upgrade may have
   * been sent any number of times by earlier code, so its count proves nothing (db.ts policy).
   * - A final status is recorded (`record`).
   * - A used-nonce or expired-hash admission refusal makes the attempt 'invalid' (and so allows
   *   a fresh transaction later) ONLY by a CAS requiring a counted row, `broadcasts = 1` and this
   *   sender to be that one send. Otherwise the refusal proves nothing about another copy, and
   *   the attempt stays 'signed' (unknown).
   * - A sender whose claim finds the attempt no longer 'signed' doesn't send at all.
   */
  private async send(a: Attempt, signal: AbortSignal): Promise<"success" | WriterAnswer> {
    const claimed = this.db
      .prepare(
        `UPDATE ${this.table} SET broadcasts = broadcasts + 1, updated_ms = ? WHERE operation = ? AND attempt = ? AND state = 'signed' RETURNING broadcasts, history`,
      )
      .get(this.now(), a.operation, a.attempt) as
      | { broadcasts: number; history: Attempt["history"] }
      | undefined;
    if (!claimed) return this.fromRow(a);
    const o = await this.opts.rpc.sendTx(a.signed_tx, a.tx_hash, signal);
    if (o.kind === "success" || o.kind === "failure") return this.record(a, o);
    if (
      o.kind === "invalid" &&
      (o.reason === "nonce" || o.reason === "expired") &&
      claimed.history === "counted" &&
      claimed.broadcasts === 1 &&
      this.db
        .prepare(
          `UPDATE ${this.table} SET state = 'invalid', code = ?, updated_ms = ? WHERE operation = ? AND attempt = ? AND state = 'signed' AND history = 'counted' AND broadcasts = 1`,
        )
        .run(o.reason, this.now(), a.operation, a.attempt).changes === 1
    )
      return { status: "unknown", detail: `invalid_${o.reason}`, tx: a.tx_hash } as WriterAnswer;
    return {
      status: "unknown",
      detail: o.kind === "invalid" ? "invalid_unproven" : "no_answer",
      tx: a.tx_hash,
    } as WriterAnswer;
  }

  private persistAttempt(
    op: string,
    digest: string,
    method: string,
    receiver: string,
    args: Record<string, unknown>,
    chainNonce: bigint,
    blockHash: Buffer,
    block: { hash: string; height: bigint },
  ): { kind: "created"; attempt: Attempt } | { kind: "raced" } | { kind: "blocked" } {
    const db = this.db;
    db.exec("BEGIN IMMEDIATE");
    try {
      const cur = this.latest(op);
      if (cur && cur.payload_digest !== digest) throw new Error("payload changed");
      if (cur && cur.state !== "invalid") {
        db.exec("COMMIT");
        return { kind: "raced" };
      }
      if (cur && !this.freshAllowed(op)) {
        db.exec("COMMIT");
        return { kind: "blocked" };
      }
      const row = db
        .prepare("SELECT next_nonce FROM chain_tx_nonces WHERE signer = ? AND public_key = ?")
        .get(this.signer, this.opts.key.publicKey) as { next_nonce: string } | undefined;
      const stored = row ? BigInt(row.next_nonce) : 0n;
      // biome-ignore lint/complexity/useMathMinMax: BigInt values (Math.max takes numbers only)
      const nonce = stored > chainNonce + 1n ? stored : chainNonce + 1n;
      db.prepare(
        "INSERT INTO chain_tx_nonces (signer, public_key, next_nonce) VALUES (?, ?, ?) ON CONFLICT(signer, public_key) DO UPDATE SET next_nonce = excluded.next_nonce",
      ).run(this.signer, this.opts.key.publicKey, String(nonce + 1n));
      const tx = encodeTransaction({
        signer: this.signer,
        publicKey: this.opts.key.publicBytes,
        nonce,
        receiver,
        blockHash,
        method,
        args: Buffer.from(JSON.stringify(args), "utf8"),
        gas: GAS,
        deposit: 0n,
      });
      const hash = createHash("sha256").update(tx).digest();
      const signed = Buffer.concat([tx, Buffer.from([0]), this.opts.key.sign(hash)]);
      const attempt: Attempt = {
        operation: op,
        attempt: (cur?.attempt ?? 0) + 1,
        payload_digest: digest,
        method,
        nonce: String(nonce),
        block_height: String(block.height),
        tx_hash: base58Encode(hash),
        signed_tx: signed.toString("base64"),
        state: "signed",
        code: null,
        signer: this.signer,
        public_key: this.opts.key.publicKey,
        history: "counted",
        reconcile: null,
      };
      db.prepare(
        `INSERT INTO ${this.table} (operation, attempt, payload_digest, method, receiver, signer, public_key, nonce,
           block_hash, block_height, tx_hash, signed_tx, history, state, code, created_ms, updated_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'counted', 'signed', NULL, ?, ?)`,
      ).run(
        op,
        attempt.attempt,
        digest,
        method,
        receiver,
        this.signer,
        this.opts.key.publicKey,
        attempt.nonce,
        block.hash,
        attempt.block_height,
        attempt.tx_hash,
        attempt.signed_tx,
        this.now(),
        this.now(),
      );
      db.exec("COMMIT");
      return { kind: "created", attempt };
    } catch (e) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw e;
    }
  }

  private async broadcast(
    a: Attempt,
    signal: AbortSignal,
    success: WriterAnswer["status"],
  ): Promise<WriterAnswer> {
    const r = await this.send(a, signal);
    return r === "success" ? ({ status: success, tx: a.tx_hash } as WriterAnswer) : r;
  }
}

/** Whether an access key may call `method` on `receiver` with no deposit. */
export function permits(permission: unknown, receiver: string, method: string): boolean {
  if (permission === "FullAccess") return true;
  const fc = (
    permission as { FunctionCall?: { receiver_id?: unknown; method_names?: unknown } } | null
  )?.FunctionCall;
  if (!fc || fc.receiver_id !== receiver) return false;
  const names = Array.isArray(fc.method_names) ? fc.method_names : [];
  return names.length === 0 || names.includes(method);
}

/**
 * Job 003wf3 (MANAGED_HANDOVER.md §7, §16.3): the configured closer. It submits exactly one call,
 * `close_sale({ order })` on the bound business account, with no deposit, signed by a
 * FUNCTION-CALL access key (a full-access key is refused), through the same durable attempt rules
 * as the customer writer, in its own `closer_tx_attempts`. Its answer is an event only: the
 * contract's outcome ring decides whether the business closed.
 */
export class TestnetCloserWriter extends TestnetCustomerWriter {
  constructor(db: Db, opts: Omit<WriterOptions, "table" | "functionCallKeyOnly">) {
    super(db, { ...opts, table: "closer_tx_attempts", functionCallKeyOnly: true });
  }

  closeSale(input: {
    operation: string;
    account: string;
    order: Record<string, unknown>;
    signal: AbortSignal;
  }): Promise<WriterAnswer> {
    const o = input.order;
    const keys = [
      "deal_seq",
      "version",
      "digest",
      "expected_generation",
      "closing_control_seq",
      "manifest",
      "manifest_seq",
      "issued_at_ms",
    ];
    const ok =
      Object.keys(o).length === keys.length &&
      keys.every((k) => k in o) &&
      U64_DEC.test(String(o.deal_seq)) &&
      Number.isInteger(o.version) &&
      HEX64.test(String(o.digest)) &&
      Number.isInteger(o.expected_generation) &&
      U64_DEC.test(String(o.closing_control_seq)) &&
      HEX64.test(String(o.manifest)) &&
      U64_DEC.test(String(o.manifest_seq)) &&
      U64_DEC.test(String(o.issued_at_ms));
    if (!isAccountId(input.account) || !input.account.endsWith(".testnet"))
      return Promise.resolve({ status: "refused", code: "E_ACCOUNT" });
    if (!ok) return Promise.resolve({ status: "refused", code: "E_ARGS" });
    if (!OPERATION.test(input.operation))
      return Promise.resolve({ status: "refused", code: "E_OPERATION" });
    return this.submit(
      input.operation,
      "close_sale",
      input.account,
      { order: o },
      input.signal,
      "applied",
    );
  }
}
