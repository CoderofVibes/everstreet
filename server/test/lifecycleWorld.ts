// Job 003wf1: test support for the configured lifecycle in ACTUAL child processes
// (lifecycle-process.test.ts, entryChild.ts). Never used by the application.
//
// The child runs the normal entry logic (server/src/serve.ts) over the production composition, with
// only its two network transports injected. Both are answered HERE, in the test process, over the
// child's IPC channel, so the chain's state survives a child's stop, crash and restart, and a test
// can hold any answer at a deterministic barrier:
// - SyntheticRpc: a JSON-RPC endpoint over the contract-anchored FixtureChain (customer-world.ts):
//   blocks, the customer views, access keys, and send_tx/tx for the writer's signed
//   open_hold/settle_hold/release_hold_for, each decoded and its ed25519 signature checked, then
//   applied by the double's own rules; the same signed transaction twice is one transaction.
// - SyntheticModel: the Anthropic HTTP API's two paths (count_tokens, messages), answering what
//   the scripted extractor would, with usage; it can fail or hold a call.
// Fictional accounts, ephemeral keys, a fictional API key value. Nothing here touches a network.

import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
} from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseAiConfig } from "../src/ai-config.ts";
import { ANALYSIS_SYSTEM } from "../src/analysis.ts";
import { httpsTransport } from "../src/anthropic.ts";
import { validateConfig } from "../src/appConfig.ts";
import { composeApplication } from "../src/compose.ts";
import { verifiesEd25519 } from "../src/customerSigning.ts";
import { base58Encode } from "../src/customerWriter.ts";
import { nep413Digest } from "../src/identity.ts";
import { AnthropicRuntime } from "../src/runtime.ts";
import { standInFromContent } from "./analyst.ts";
import { CUSTOMER, customerWorld, FixtureChain, type Json, TOKEN } from "./customer-world.ts";
import { correct, INVOICE_SPEC } from "./runtime-world.ts";

export const RPC = "https://synthetic-testnet-rpc.example";
export const MODEL = "https://api.anthropic.com";
export const OP = "meter.testnet";
/** The fictional founder's account (bound to the bootstrap's founder for verified sign-in). */
export const FOUNDER = "ava-founder.near";
/** The fictional business contract (a .testnet account, as the configured app requires). */
export const BIZ = "studio-synthetic.testnet";
export const API_KEY_ENV = "EVERSTREET_SYNTHETIC_MODEL_KEY";
/** A fictional value: the composition requires a key variable; nothing ever reaches a provider. */
export const FICTIONAL_KEY = "synthetic-test-key-not-a-credential-0001";

/** A barrier: `entered` once a call waits at it; `open()` lets it through. */
export function barrier() {
  let open: () => void = () => {};
  let arrive: () => void = () => {};
  const release = new Promise<void>((r) => {
    open = r;
  });
  const entered = new Promise<void>((r) => {
    arrive = r;
  });
  return { entered, open, release, arrive };
}
type Barrier = ReturnType<typeof barrier>;

/** An ed25519 key in NEAR form (ephemeral, never a real account's). */
export function nearKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return {
    privateKey,
    secret: `ed25519:${base58Encode(Buffer.concat([seed, pub]))}`,
    id: `ed25519:${base58Encode(pub)}`,
    pub,
  };
}

/** The Anthropic HTTP API's two paths, fictional answers with usage. */
export class SyntheticModel {
  calls = { count_tokens: 0, messages: 0, builds: 0 };
  /** The next messages call answers this HTTP error instead (e.g. 529 overloaded). */
  failNext: number | null = null;
  private held: Barrier | null = null;
  holdNextMessage() {
    this.held = barrier();
    return this.held;
  }
  async answer(url: string, body: Json): Promise<{ status: number; body: string }> {
    if (url === `${MODEL}/v1/messages/count_tokens`) {
      this.calls.count_tokens++;
      return { status: 200, body: JSON.stringify({ input_tokens: 900 }) };
    }
    if (url !== `${MODEL}/v1/messages`) throw new Error(`synthetic model: refused ${url}`);
    this.calls.messages++;
    const h = this.held;
    if (h) {
      this.held = null;
      h.arrive();
      await h.release;
    }
    if (this.failNext !== null) {
      const status = this.failNext;
      this.failNext = null;
      return {
        status,
        body: JSON.stringify({
          type: "error",
          error: { type: "overloaded_error", message: "Overloaded" },
        }),
      };
    }
    // A build (its structured output asks for a spec with examples): the fixture invoice spec,
    // examples as key/value pairs, as the production provider reshapes them.
    if (JSON.stringify(body.output_config ?? {}).includes('"examples"')) {
      this.calls.builds++;
      const spec = {
        ...INVOICE_SPEC,
        examples: INVOICE_SPEC.examples.map((e) => ({
          input: e.input,
          values: Object.entries(e.output).map(([key, value]) => ({ key, value })),
        })),
      };
      return {
        status: 200,
        body: JSON.stringify({
          content: [{ type: "text", text: JSON.stringify(spec) }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1500, output_tokens: 800 },
        }),
      };
    }
    // An analysis request (AGENT_ANALYSIS.md): the labelled stand-in analyst.
    if (body.system === ANALYSIS_SYSTEM) {
      const output = standInFromContent(String((body.messages as Json[])[0]?.content ?? "{}"));
      return {
        status: 200,
        body: JSON.stringify({
          content: [{ type: "text", text: JSON.stringify(output) }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1100, output_tokens: 260 },
        }),
      };
    }
    // What the scripted extractor says about the document in this request.
    const a = await correct({ document: JSON.stringify(body) } as never);
    return {
      status: 200,
      body: JSON.stringify({
        content: [{ type: "text", text: JSON.stringify(a.output) }],
        stop_reason: "end_turn",
        usage: { input_tokens: a.usage.inputTokens, output_tokens: a.usage.outputTokens },
      }),
    };
  }
  /**
   * The next messages answer sends its headers at once and holds its BODY until opened; a
   * non-cooperating transport: it ignores cancellation (it never ends the held read itself).
   */
  holdNextBody() {
    this.heldBody = { ...barrier(), cancelled: false };
    return this.heldBody;
  }
  private heldBody: (Barrier & { cancelled: boolean }) | null = null;
  /** As a fetch, for in-process compositions: the two paths only, never a real fetch. */
  fetch(): typeof fetch {
    return (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "object" && "url" in input ? input.url : String(input);
      const r = await this.answer(url, JSON.parse(String(init?.body ?? "{}")));
      const h = url.endsWith("/v1/messages") ? this.heldBody : null;
      if (!h) return new Response(r.body, { status: r.status });
      this.heldBody = null;
      const bytes = new TextEncoder().encode(r.body);
      let sent = false;
      const body = new ReadableStream<Uint8Array>({
        async pull(c) {
          if (sent) return c.close();
          h.arrive();
          await h.release; // headers are out; the body waits
          sent = true;
          c.enqueue(bytes);
        },
        cancel() {
          h.cancelled = true; // noted, but the held read is not ended by the transport
        },
      });
      return new Response(body, { status: r.status });
    }) as typeof fetch;
  }
  /** The test RPC as an in-process fetch (the configured endpoint only). */
  static rpcFetch(rpc: SyntheticRpc) {
    return async (url: string, init: { body: string; signal?: AbortSignal }) => {
      if (url !== RPC) throw new Error(`synthetic RPC: refused ${url}`);
      const answer = rpc.answer(init.body);
      // Job 003wf3: when asked to, the caller's abort ends ITS wait, as a real fetch's does; the
      // request already sent goes on (a transaction may still land). Off by default: the
      // existing tests use a transport that ignores cancellation on purpose.
      const signal = init.signal;
      if (rpc.honorAbort && signal) {
        const aborted = new Promise<never>((_, reject) => {
          if (signal.aborted) reject(new DOMException("aborted", "AbortError"));
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            {
              once: true,
            },
          );
        });
        answer.catch(() => {});
        return new Response(await Promise.race([answer, aborted]), { status: 200 });
      }
      return new Response(await answer, { status: 200 });
    };
  }
}

/** Job 003wf3: the method a JSON-RPC send_tx request body calls (null if it isn't one). */
export function sendMethodOf(rawBody: string): string | null {
  try {
    const j = JSON.parse(rawBody) as { method?: string; params?: { signed_tx_base64?: string } };
    if (j.method !== "send_tx") return null;
    return decodeSigned(String(j.params?.signed_tx_base64)).method;
  } catch {
    return null;
  }
}

/** NEAR's signed transaction, read independently of the writer: every envelope field kept. */
function decodeSigned(b64: string) {
  const b = Buffer.from(b64, "base64");
  let i = 0;
  const need = (n: number) => {
    if (i + n > b.length) throw new Error("truncated");
  };
  const u32 = () => {
    need(4);
    const v = b.readUInt32LE(i);
    i += 4;
    return v;
  };
  const take = (n: number) => {
    need(n);
    const s = b.subarray(i, i + n);
    i += n;
    return s;
  };
  const str = () => take(u32()).toString("utf8");
  const u64 = () => {
    need(8);
    const v = b.readBigUInt64LE(i);
    i += 8;
    return v;
  };
  const signer = str();
  const keyType = take(1)[0];
  const publicKey = take(32);
  const nonce = u64();
  const receiver = str();
  const blockHash = take(32);
  const actions = u32();
  const actionKind = take(1)[0];
  const method = str();
  const args = JSON.parse(take(u32()).toString("utf8")) as Json;
  const gas = u64();
  const deposit = u64() + (u64() << 64n);
  const txBytes = b.subarray(0, i);
  const sigType = take(1)[0];
  const signature = take(64);
  return {
    signer,
    keyType,
    publicKey,
    nonce,
    receiver,
    blockHash,
    actions,
    actionKind,
    method,
    args,
    gas,
    deposit,
    txBytes,
    sigType,
    signature,
    rest: b.length - i,
  };
}

/** The business methods this double applies, each by the contract's rules (customer-world.ts). */
const METHODS = new Set(["open_hold", "settle_hold", "release_hold_for"]);
const GAS = 100_000_000_000_000n;
/** Job 003wf4 (M-2): an owner's own signed calls this double decodes (the sale double applies them). */
const OWNER_METHODS = new Set(["create_plan_guarded", "appoint_operator_guarded"]);
const MIN_OWNER_GAS = 1_000_000_000_000n;
const MAX_OWNER_GAS = 300_000_000_000_000n;

const spki = (raw: Buffer) =>
  createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]),
    format: "der",
    type: "spki",
  });

/** A JSON-RPC endpoint over the contract-anchored chain double. */
export class SyntheticRpc {
  /** Full-access keys this endpoint vouches for: "account|ed25519:…" → nonce. */
  readonly keys = new Map<string, bigint>();
  /**
   * Job 003wf3: a key's permission when it isn't full access, e.g. the closer's
   * { FunctionCall: { receiver_id, method_names: ["close_sale"], allowance } }.
   */
  readonly permissions = new Map<string, Json>();
  readonly outcomes = new Map<string, Json>();
  /** Every distinct signed transaction applied (method, args). */
  readonly applied: {
    method: string;
    args: Json;
    receiver?: string;
    signer?: string;
    nonce?: bigint;
  }[] = [];
  /**
   * Job 003wf3 (P-4): further business contracts on the SAME network: one block sequence and
   * clock (the primary's), one access-key nonce map, one transaction-outcome map and one token
   * ledger; views route by account and transactions by receiver, each to its own contract state.
   */
  readonly others: FixtureChain[] = [];
  private otherSnapshots = new Map<FixtureChain, Map<number, Json>>();
  /** send_tx arrivals, including repeats of the same transaction. */
  sends = 0;
  private hashes = new Map<string, number>();
  /**
   * What the contract's views showed at each block this endpoint issued (the last 64): a query
   * pinned to an older block answers THAT state, or is refused once it is gone; current state is
   * never labelled with an older block (Astra's LifecycleRpcEvidenceReview).
   */
  private snapshots = new Map<number, Json>();
  private heldSend: Barrier | null = null;
  private heldQuery: Barrier | null = null;
  /** Job 003wf3: the in-process fetch honours its caller's abort (as a real fetch). */
  honorAbort = false;
  /**
   * Job 003wf3: a send this predicate matches never reaches the network (its caller gets a
   * transport error; nothing is applied), e.g. every broadcast of one exact close order.
   */
  dropSend: ((method: string, args: Json) => boolean) | null = null;
  /** Job 003wf3: only a send of this method is held (null: the next send of any method). */
  private heldSendMethod: string | null = null;
  /** Job 003wf3: the next send of this method is applied, then its answer is lost. */
  private loseSendMethod: string | null = null;
  constructor(readonly chain: FixtureChain) {}

  private stateOf(c: FixtureChain): Json {
    return {
      control: structuredClone(c.control),
      treasury: structuredClone(c.treasury),
      plan: structuredClone(c.plan),
      ents: new Map([...c.ents].map(([k, v]) => [k, structuredClone(v)])),
      // Job 003wf2: the sale half of the same state and the token ledger, as they were then.
      sale: c.sale ? c.sale.fork() : null,
      balances: new Map(c.balances),
      tokenRegistered: new Set(c.tokenRegistered),
    };
  }

  private snapshot(height: number) {
    this.snapshots.set(height, this.stateOf(this.chain));
    for (const h of [...this.snapshots.keys()]) if (h < height - 64) this.snapshots.delete(h);
    for (const o of this.others) {
      const m = this.otherSnapshots.get(o) ?? new Map<number, Json>();
      this.otherSnapshots.set(o, m);
      m.set(height, this.stateOf(o));
      for (const h of [...m.keys()]) if (h < height - 64) m.delete(h);
    }
  }

  /** Job 003wf3 (P-4): another business contract on this network (shares the token ledger). */
  addChain(c: FixtureChain) {
    c.balances = this.chain.balances;
    c.tokenRegistered = this.chain.tokenRegistered;
    this.others.push(c);
    this.align();
  }

  /** Every other contract's clock follows the network's (the primary's), only forward. */
  private align() {
    for (const o of this.others) if (o.ts < this.chain.ts) o.tick(this.chain.ts - o.ts);
  }

  /** The contract a view or a transaction names, or null (no such account here). */
  private contractFor(account: string): FixtureChain | null {
    if (account === this.chain.business) return this.chain;
    return this.others.find((o) => o.business === account) ?? null;
  }

  /**
   * Job 003wf3: the next view query (call_function) is answered from its pinned block, then waits
   * until opened before the answer is returned: the reader keeps that block's evidence while the
   * chain moves on (an awaited read racing a later state change).
   */
  holdNextQuery() {
    this.heldQuery = barrier();
    return this.heldQuery;
  }

  /**
   * The next send_tx waits (before it is applied) until opened. With `method` (job 003wf3), only
   * the next send calling that method is held; others pass.
   */
  holdNextSend(method: string | null = null) {
    this.heldSend = barrier();
    this.heldSendMethod = method;
    return this.heldSend;
  }

  /**
   * Job 003wf3: the next send calling `method` is applied by the double's rules, then its answer
   * never reaches the caller (the transaction exists; only its own hash can show it).
   */
  loseNextSendAnswer(method: string) {
    this.loseSendMethod = method;
  }

  private methodOfSend(b64: string): string | null {
    try {
      return decodeSigned(b64).method;
    } catch {
      return null;
    }
  }

  private hashFor(height: number) {
    const h = base58Encode(createHash("sha256").update(`synthetic-block:${height}`).digest());
    this.hashes.set(h, height);
    return h;
  }

  /** The double follows this computer's clock, only forward, a block per read. */
  private sync() {
    const d = BigInt(Date.now()) - this.chain.ts;
    if (d > 0n) this.chain.tick(d);
    this.align();
  }

  async answer(raw: string): Promise<string> {
    const req = JSON.parse(raw) as { id: string; method: string; params: Json };
    const ok = (result: unknown) => JSON.stringify({ jsonrpc: "2.0", id: req.id, result });
    const fail = (name: string, info: unknown = {}) =>
      JSON.stringify({
        jsonrpc: "2.0",
        id: req.id,
        error: { name: "HANDLER_ERROR", cause: { name, info } },
      });
    const p = req.params;
    this.align();
    if (req.method === "block") {
      this.sync();
      this.snapshot(this.chain.height);
      return ok({
        header: {
          height: this.chain.height,
          hash: this.hashFor(this.chain.height),
          timestamp_nanosec: String(this.chain.ts * 1_000_000n),
        },
      });
    }
    if (req.method === "query" && p.request_type === "view_access_key") {
      const nonce = this.keys.get(`${p.account_id}|${p.public_key}`);
      if (nonce === undefined) return fail("UNKNOWN_ACCESS_KEY");
      return ok({
        nonce: Number(nonce),
        permission: this.permissions.get(`${p.account_id}|${p.public_key}`) ?? "FullAccess",
        block_height: this.chain.height,
        block_hash: this.hashFor(this.chain.height),
      });
    }
    if (req.method === "query" && p.request_type === "call_function") {
      // Only the one contract this double models and (job 003wf2) its token; any other account
      // doesn't exist here.
      const account = String(p.account_id);
      const c = account === TOKEN ? this.chain : this.contractFor(account);
      if (!c) return fail("UNKNOWN_ACCOUNT");
      const height = this.hashes.get(String(p.block_id));
      const snap =
        height === undefined
          ? undefined
          : c === this.chain
            ? this.snapshots.get(height)
            : this.otherSnapshots.get(c)?.get(height);
      if (height === undefined || !snap) return fail("UNKNOWN_BLOCK");
      const args = JSON.parse(Buffer.from(String(p.args_base64), "base64").toString("utf8"));
      // The double's own view rules, over the state as it was at that block.
      const then = Object.assign(Object.create(c) as FixtureChain, snap);
      let text: string;
      try {
        text = c.answer.call(then, String(p.method_name), args);
      } catch {
        return ok({ error: "synthetic: no such view", logs: [] });
      }
      const hq = this.heldQuery;
      if (hq) {
        this.heldQuery = null;
        hq.arrive();
        await hq.release;
      }
      return ok({
        result: [...Buffer.from(text, "utf8")],
        logs: [],
        block_height: height,
        block_hash: p.block_id,
      });
    }
    if (req.method === "send_tx") {
      this.sends++;
      const b64 = String(p.signed_tx_base64);
      if (this.dropSend) {
        let d: ReturnType<typeof decodeSigned> | null = null;
        try {
          d = decodeSigned(b64);
        } catch {
          d = null;
        }
        if (d && this.dropSend(d.method, d.args as Json))
          throw new Error("synthetic: the send didn't reach the network");
      }
      const method = this.heldSendMethod || this.loseSendMethod ? this.methodOfSend(b64) : null;
      const h = this.heldSend;
      if (h && (this.heldSendMethod === null || this.heldSendMethod === method)) {
        this.heldSend = null;
        this.heldSendMethod = null;
        h.arrive();
        await h.release;
      }
      const out = this.apply(b64, ok, fail);
      if (this.loseSendMethod !== null && this.loseSendMethod === method) {
        this.loseSendMethod = null;
        throw new Error("synthetic: the answer was lost after the transaction was applied");
      }
      return out;
    }
    if (req.method === "tx") {
      // Job 003wf2: a wallet's own transactions (applied to the double by the synthetic wallet)
      // are found by their hash too.
      const o = this.outcomes.get(String(p.tx_hash)) ?? this.chain.txs.get(String(p.tx_hash));
      return o ? ok(o) : fail("UNKNOWN_TRANSACTION");
    }
    return fail("METHOD_NOT_FOUND");
  }

  private apply(b64: string, ok: (r: unknown) => string, fail: (n: string, i?: unknown) => string) {
    let t: ReturnType<typeof decodeSigned>;
    try {
      t = decodeSigned(b64);
    } catch {
      return fail("INVALID_TRANSACTION", { InvalidTxError: "Malformed" });
    }
    // Job 003wf4 (M-2): an OWNER's signed call to the sale double (a founder's own wallet signs
    // it): any canonical deposit (it pays the measured storage) and gas within NEAR's range.
    const target = this.contractFor(t.receiver);
    const owner =
      OWNER_METHODS.has(t.method) && target?.sale !== null && target?.sale !== undefined;
    // The envelope this double can establish: ed25519, one FunctionCall to the modelled business,
    // a block this endpoint issued, the writer's gas and no deposit (an owner's call: its gas in
    // range and its encoded deposit), nothing trailing. Anything else is refused, never applied.
    if (
      t.keyType !== 0 ||
      t.sigType !== 0 ||
      t.actions !== 1 ||
      t.actionKind !== 2 ||
      t.rest !== 0 ||
      (owner
        ? t.gas < MIN_OWNER_GAS || t.gas > MAX_OWNER_GAS
        : t.gas !== GAS || t.deposit !== 0n) ||
      !this.hashes.has(base58Encode(t.blockHash))
    )
      return fail("INVALID_TRANSACTION", { InvalidTxError: "UnsupportedByThisDouble" });
    const closing =
      t.method === "close_sale" && target?.sale !== null && target?.sale !== undefined;
    if (!target || (!METHODS.has(t.method) && !closing && !owner))
      return fail("INVALID_TRANSACTION", { InvalidTxError: "UnknownReceiverOrMethod" });
    const hash = base58Encode(createHash("sha256").update(t.txBytes).digest());
    const seen = this.outcomes.get(hash);
    if (seen) return ok(seen); // the same signed transaction: one transaction
    const key = `${t.signer}|ed25519:${base58Encode(t.publicKey)}`;
    const last = this.keys.get(key);
    const digest = createHash("sha256").update(t.txBytes).digest();
    if (last === undefined || !verify(null, digest, spki(t.publicKey), t.signature))
      return fail("INVALID_TRANSACTION", { InvalidTxError: "InvalidSignature" });
    if (t.nonce <= last)
      return fail("INVALID_TRANSACTION", { InvalidTxError: { InvalidNonce: {} } });
    // Job 003wf3: a function-call key may call only its receiver and listed methods.
    const perm = this.permissions.get(key) as
      | { FunctionCall?: { receiver_id?: string; method_names?: string[] } }
      | undefined;
    if (
      perm?.FunctionCall &&
      (perm.FunctionCall.receiver_id !== t.receiver ||
        ((perm.FunctionCall.method_names ?? []).length > 0 &&
          !(perm.FunctionCall.method_names ?? []).includes(t.method)))
    )
      return fail("INVALID_TRANSACTION", { InvalidTxError: { InvalidAccessKeyError: {} } });
    // NEAR: a function-call access key can't attach a deposit.
    if (perm?.FunctionCall && t.deposit > 0n)
      return fail("INVALID_TRANSACTION", {
        InvalidTxError: { InvalidAccessKeyError: "DepositWithFunctionCall" },
      });
    this.keys.set(key, t.nonce);
    this.sync();
    if (owner) {
      // The owner's call by the sale double's own rules (receiver graph, logs, refund), recorded
      // under THIS signed transaction's hash and exact action, so its own check can find it.
      const sale = target.sale as NonNullable<typeof target.sale>;
      sale.now = target.ts;
      const out = sale.walletCall(t.signer, {
        receiverId: t.receiver,
        methodName: t.method,
        args: t.args,
        deposit: String(t.deposit),
        gas: String(t.gas),
      }) as Json;
      out.transaction = {
        ...out.transaction,
        hash,
        signer_id: t.signer,
        receiver_id: t.receiver,
        actions: [
          {
            FunctionCall: {
              method_name: t.method,
              args: Buffer.from(JSON.stringify(t.args)).toString("base64"),
              gas: Number(t.gas),
              deposit: String(t.deposit),
            },
          },
        ],
      };
      out.transaction_outcome = { ...out.transaction_outcome, id: hash };
      this.chain.tick(1_000n);
      this.align();
      this.applied.push({
        method: t.method,
        args: t.args,
        receiver: t.receiver,
        signer: t.signer,
        nonce: t.nonce,
      });
      this.outcomes.set(hash, out);
      return ok(out);
    }
    let status: Json;
    try {
      const a = t.args;
      if (t.method === "close_sale") {
        // Job 003wf3: the closer's signed order, by the sale double's own rules (lib.rs order).
        const sale = target.sale as NonNullable<typeof target.sale>;
        sale.now = target.ts;
        const r = sale.applySigned(t.signer, "close_sale", a);
        if (!r.ok) throw Object.assign(new Error(r.error), { code: r.error.split(":")[0] });
        // A change lands in a new block (as every chain write here): never the same block hash
        // with other state.
        this.chain.tick(1_000n);
        this.align();
      } else if (t.method === "open_hold")
        target.openHold(t.signer, a.customer, a.auth, a.sig, verifiesEd25519);
      else if (t.method === "settle_hold")
        target.settleHold(t.signer, a.customer, a.hold_seq, a.uses, a.close, verifiesEd25519);
      else target.releaseHoldFor(t.signer, a.customer, a.reg_id, a.hold_seq);
      // P-4: a write to another contract lands in a new NETWORK block too (the primary's sequence
      // is the network's), so a block id never shows two different states of that contract.
      if (target !== this.chain) {
        this.chain.tick(1_000n);
        this.align();
      }
      this.applied.push({
        method: t.method,
        args: a,
        receiver: t.receiver,
        signer: t.signer,
        nonce: t.nonce,
      });
      status = { SuccessValue: "" };
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (!code) throw e;
      status = {
        Failure: {
          ActionError: {
            kind: { FunctionCallError: { ExecutionError: `Smart contract panicked: ${code}` } },
          },
        },
      };
    }
    const outcome = {
      final_execution_status: "FINAL",
      status,
      transaction: { hash, signer_id: t.signer, receiver_id: t.receiver },
      transaction_outcome: { id: hash, outcome: { status: { SuccessReceiptId: `${hash}-r` } } },
      receipts_outcome: [{ id: `${hash}-r`, outcome: { status, logs: [] } }],
    };
    this.outcomes.set(hash, outcome);
    return ok(outcome);
  }
}

/**
 * A disposable configured installation: the durable database bootstrapped with ONLY the
 * prerequisites (founder, a release evaluated on the real AnthropicRuntime over the synthetic
 * model, the customer offer, Cara's person bound to her fictional account), files and a config.
 * Customer use, reservation, execution and settlement then happen in the child processes.
 */
/** Job 003wf3 (P-4): the second business's contract account and its founder's account. */
export const BIZ2 = "second-synthetic.testnet";
export const FOUNDER2 = "ben-founder.near";

export async function bootstrap(
  dir: string,
  port: number,
  maintenance: Json,
  opts: {
    second?: boolean;
    /**
     * Job 003wf4 (P-3): the business starts with no plan, no operator grant, no entitlement and no
     * offer; the founder's own routes create them (the sale double is attached, owner the founder).
     */
    fresh?: boolean;
    /**
     * Flagship journey (003wf parent): `fresh`, and the founder's project is a bare shell: no
     * budget, build, evaluation or release exists until the founder makes them in the child.
     */
    bare?: boolean;
    /** With `bare`: the shell's product type (the workflow engine: `saas_workflow`). */
    foundation?: string;
  } = {},
) {
  if (opts.bare) opts = { ...opts, fresh: true };
  const db = join(dir, "everstreet.db");
  const root = join(dir, "protected");
  mkdirSync(root, { recursive: true });
  const protectedKeys = join(dir, "protected-keys.json");
  writeFileSync(protectedKeys, JSON.stringify({ k1: randomBytes(32).toString("base64") }));
  const aiFile = join(dir, "ai.json");
  writeFileSync(
    aiFile,
    JSON.stringify({
      config_version: "lifecycle-test-1",
      provider: "anthropic",
      model: "claude-haiku-5-5",
      pricing_version: "2026-11-02",
      operator_ceiling_cents: 100,
      runtime_operator_ceiling_cents: 100,
    }),
  );
  const op = nearKey();
  const writerKey = join(dir, "operator-key.json");
  writeFileSync(
    writerKey,
    JSON.stringify({ account_id: OP, public_key: op.id, private_key: op.secret }),
  );
  const model = new SyntheticModel();
  const ai = parseAiConfig(readFileSync(aiFile, "utf8"), FICTIONAL_KEY);
  if (!ai.ok) throw new Error(ai.reason);
  const w = await customerWorld({
    dbPath: db,
    bare: opts.bare,
    ...(opts.foundation ? { foundation: opts.foundation } : {}),
    businessAccount: BIZ,
    runtimeProvider: new AnthropicRuntime(
      ai.config,
      httpsTransport(ai.apiKey, { fetchImpl: model.fetch() }),
    ),
  });
  // With `fresh`, no offer exists yet: the empty id (the founder creates one through the routes).
  const offer: string = opts.fresh ? "" : await w.offer();
  // Job 003wf3 (P-4): a second founder's business on the SAME database, with its own project,
  // budgets and release (evaluated on the same runtime identity), its own contract (Cara's
  // prepaid entitlement there too, the platform's metering grant) and its own binding. Its
  // customer offer is made later through the configured composition's own routes.
  let second: null | {
    founder: Awaited<ReturnType<typeof w.rw.founder>>;
    chain: FixtureChain;
    release: string;
  } = null;
  if (opts.second) {
    const founder = await w.rw.founder("Ben Okoro");
    await w.rw.release(founder);
    const rel = w.rw.store.db
      .prepare("SELECT id FROM runtime_releases WHERE project_id = ? AND state = 'active'")
      .get(founder.project) as { id: string };
    const chain2 = new FixtureChain();
    chain2.business = BIZ2;
    chain2.control = { ...chain2.control, operators: [[OP, 1, chain2.control.generation]] };
    chain2.tick(BigInt(Date.now()) - chain2.ts);
    w.state.store.db
      .prepare(
        "INSERT INTO person_accounts (account_id, person_id, network, created_at) VALUES (?, ?, 'testnet', ?) ON CONFLICT DO NOTHING",
      )
      .run(FOUNDER2, founder.ava.id, new Date().toISOString());
    second = { founder, chain: chain2, release: rel.id };
  }
  // The chain double appoints the platform's configured metering account; it follows real time.
  if (opts.fresh) {
    w.chain.withoutPlans();
    w.chain.attachSale({ owner: FOUNDER, plans: 0 });
  } else w.chain.control = { ...w.chain.control, operators: [[OP, 1, w.chain.control.generation]] };
  w.chain.tick(BigInt(Date.now()) - w.chain.ts);
  // Verified sign-in resolves Cara's account to her person (as the wallet harness binds it).
  w.state.store.db
    .prepare(
      "INSERT INTO person_accounts (account_id, person_id, network, created_at) VALUES (?, ?, 'testnet', ?) ON CONFLICT DO NOTHING",
    )
    .run(CUSTOMER, w.cara.id, new Date().toISOString());
  w.state.store.db
    .prepare(
      "INSERT INTO person_accounts (account_id, person_id, network, created_at) VALUES (?, ?, 'testnet', ?) ON CONFLICT DO NOTHING",
    )
    .run(FOUNDER, w.f.ava.id, new Date().toISOString());
  w.rw.store.db.close();
  const rpc = new SyntheticRpc(w.chain);
  if (second) rpc.addChain(second.chain);
  rpc.keys.set(`${OP}|${op.id}`, 0n);
  const cara = nearKey();
  rpc.keys.set(`${CUSTOMER}|${cara.id}`, 0n);
  // The founder signs in too (evaluations, builds), with her own ephemeral key.
  const ava = nearKey();
  rpc.keys.set(`${FOUNDER}|${ava.id}`, 0n);
  const config = {
    config_version: 1,
    mode: "configured",
    network: "testnet",
    listen: { host: "127.0.0.1", port },
    database: db,
    sign_in: { recipient: "everstreet.local", session_hours: 1 },
    rpc: { endpoint: RPC },
    v3: {
      bindings: [
        { business_id: w.f.business, account: BIZ },
        ...(second ? [{ business_id: second.founder.business, account: BIZ2 }] : []),
      ],
    },
    customer: { operator_account: OP, writer: { key_file: writerKey } },
    protected_storage: { root, active_key_id: "k1", keys_file: protectedKeys },
    model: { ai_config_file: aiFile, api_key_env: API_KEY_ENV },
    maintenance: { enabled: true, ...maintenance },
  };
  const configFile = join(dir, "config.json");
  writeFileSync(configFile, JSON.stringify(config));
  // The second founder signs in with their own ephemeral key.
  const ben = nearKey();
  if (second) rpc.keys.set(`${FOUNDER2}|${ben.id}`, 0n);
  return { w, offer, rpc, model, cara, ava, configFile, config, db, sign, second, ben };
}

/**
 * The same installation composed IN THIS PROCESS (the production composition; only the two
 * transports and the named key variable injected), for evidence that needs the composition's
 * own state after stop (running work, fence waiters). Child-process evidence is separate.
 */
export function composeIn(
  b: Awaited<ReturnType<typeof bootstrap>>,
  extra: { now?: () => number; config?: Json } = {},
) {
  return composeApplication(validateConfig({ ...b.config, ...extra.config }), {
    fetch: SyntheticModel.rpcFetch(b.rpc) as never,
    fetchLabel: "synthetic RPC (lifecycle test)",
    modelFetch: b.model.fetch(),
    modelFetchLabel: "synthetic model HTTP (lifecycle test)",
    envVar: (name) => (name === API_KEY_ENV ? FICTIONAL_KEY : undefined),
    now: extra.now,
  });
}

/** One browser over a composition's app (no listener): its own cookie jar. */
export function appBrowser(app: {
  request: (path: string, init?: RequestInit) => Response | Promise<Response>;
}) {
  const jar = new Map<string, string>();
  return async (path: string, method = "GET", body?: unknown) => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await app.request(path, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const set of res.headers.getSetCookie()) {
      const [pair, ...attrs] = set.split(";");
      const [name, ...rest] = (pair as string).split("=");
      const value = rest.join("=");
      if (!value || attrs.some((x) => /^max-age=0$/i.test(x.trim()))) jar.delete(name as string);
      else jar.set(name as string, value);
    }
    return { status: res.status, body: (await res.json().catch(() => null)) as Json };
  };
}

/** NEP-413 sign-in through the real routes, with an ephemeral full-access key. */
export async function signInAs(
  call: (path: string, method?: string, body?: unknown) => Promise<{ status: number; body: Json }>,
  account: string,
  key: ReturnType<typeof nearKey>,
) {
  const ch = (await call("/api/session/challenge", "POST")).body.challenge as Json;
  const digest = nep413Digest({
    message: ch.message,
    nonce: Buffer.from(ch.nonce, "base64"),
    recipient: ch.recipient,
  });
  const r = await call("/api/session/verify", "POST", {
    account_id: account,
    public_key: key.id,
    signature: sign(null, digest, key.privateKey).toString("base64"),
    nonce: ch.nonce,
  });
  if (r.status !== 200 && r.status !== 201)
    throw new Error(`sign-in ${r.status} ${JSON.stringify(r.body)}`);
}
