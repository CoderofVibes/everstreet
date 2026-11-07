// Job 003i: a read-only NEAR JSON-RPC adapter for business-v3 (docs/design/V3_OBSERVATIONS.md §8).
//
// It implements `ViewTransport` with two documented RPC requests only (docs.near.org/api/rpc):
// - `block` with `finality: "final"`, to pin a block (never combined with `block_id`);
// - `query` with `request_type: "call_function"` and `block_id: <that hash>`, for one of five
//   fixed views (get_control, get_outcomes, get_treasury, get_pending, get_period{yyyymm}).
// It has no keys, signs nothing, sends no transactions, creates no accounts and shares nothing
// with the v2 signing `Chain`. It reads TESTNET only; mainnet configuration is refused.
//
// Trust. The endpoint is operator configuration. Answers are what that endpoint reports
// (provenance, not proof): the adapter checks the JSON-RPC envelope, the request id, the block
// identity of every answer and the result bytes, but it can't verify which chain the endpoint
// serves; "testnet" is the operator's assertion about it.
//
// Resources. Every request has a deadline and honours the snapshot's abort signal: the fetch and
// the body read are both cancelled, not abandoned. Bodies are read as a stream with a byte cap
// (Content-Length is not trusted, and may be absent). Requests run at most `maxConcurrent` at a
// time. Redirects are refused. There are no retries and no failover. Errors carry fixed codes:
// no URL, header, body, RPC message or contract log ever reaches a public error or audit event.

import { type BlockRef, isAccountId, V3ReadError, type ViewTransport } from "./v3read.ts";

/** What `fetch` must provide; tests inject a synthetic one, so nothing reaches a real endpoint. */
export type FetchLike = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
    redirect: "error";
  },
) => Promise<Response>;

export interface RpcConfig {
  /** Only "testnet" is accepted in this slice. */
  network: string;
  /** An https URL with no credentials, query or fragment. */
  endpoint: string;
  /** Per request, including its body. Default 8 s. */
  requestTimeoutMs?: number;
  /** Bytes of one response body. Default 512 KiB. */
  maxResponseBytes?: number;
  /** Decoded bytes of one view result. Default 64 KiB. */
  maxResultBytes?: number;
  /** Requests at once. Default 2. */
  maxConcurrent?: number;
}

const VIEWS = new Set(["get_control", "get_outcomes", "get_treasury", "get_pending"]);

const refuse = (code: ConstructorParameters<typeof V3ReadError>[0], detail: string): never => {
  throw new V3ReadError(code, detail);
};

/** Validates trusted setup; throws a plain configuration error (never sent to people). */
export function validateRpcConfig(c: RpcConfig) {
  if (c.network !== "testnet") throw new Error("v3 rpc: only testnet is supported in this slice");
  let u: URL;
  try {
    u = new URL(c.endpoint);
  } catch {
    throw new Error("v3 rpc: the endpoint is not a URL");
  }
  if (u.protocol !== "https:") throw new Error("v3 rpc: the endpoint must use https");
  if (u.username || u.password) throw new Error("v3 rpc: the endpoint must not carry credentials");
  if (u.search || u.hash)
    throw new Error("v3 rpc: the endpoint must not carry a query or fragment");
  if (/mainnet/i.test(u.hostname)) throw new Error("v3 rpc: a mainnet endpoint is refused");
  for (const [k, v] of [
    ["requestTimeoutMs", c.requestTimeoutMs],
    ["maxResponseBytes", c.maxResponseBytes],
    ["maxResultBytes", c.maxResultBytes],
    ["maxConcurrent", c.maxConcurrent],
  ] as const)
    if (v !== undefined && (!Number.isSafeInteger(v) || v < 1))
      throw new Error(`v3 rpc: ${k} must be a positive whole number`);
}

/** An abort-aware counting semaphore. */
class Gate {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(private readonly max: number) {}
  async enter(signal: AbortSignal) {
    if (signal.aborted) refuse("timeout", "aborted before sending");
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const go = () => {
        signal.removeEventListener("abort", stop);
        this.active++;
        resolve();
      };
      const stop = () => {
        this.waiting = this.waiting.filter((w) => w !== go);
        reject(new V3ReadError("timeout", "aborted while waiting to send"));
      };
      this.waiting.push(go);
      signal.addEventListener("abort", stop, { once: true });
    });
  }
  leave() {
    this.active--;
    this.waiting.shift()?.();
  }
}

/** Heights are JSON numbers: only exact (safe) whole numbers are accepted, never rounded. */
function height(v: unknown, where: string): string {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0)
    return refuse("malformed", `${where} is not an exact block height`);
  return String(v);
}

const HASH = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
function hash(v: unknown, where: string): string {
  if (typeof v !== "string" || !HASH.test(v))
    return refuse("malformed", `${where} is not a block hash`);
  return v;
}

/** The documented handler causes, mapped to truthful codes; anything else is a generic RPC error. */
function rpcFailure(error: unknown): never {
  const cause =
    error && typeof error === "object" && "cause" in error
      ? ((error as { cause?: { name?: unknown } }).cause?.name ?? null)
      : null;
  switch (cause) {
    case "UNKNOWN_BLOCK":
    case "GARBAGE_COLLECTED_BLOCK":
      return refuse("block_unavailable", "the endpoint no longer has that block");
    case "UNKNOWN_ACCOUNT":
    case "INVALID_ACCOUNT":
    // Job 003w-b: an access key the account doesn't have (view_access_key) proves nothing either.
    case "UNKNOWN_ACCESS_KEY":
      return refuse("unknown_account", "the contract account isn't known there");
    case "NOT_SYNCED_YET":
      return refuse("unavailable", "the endpoint isn't synced");
    default:
      return refuse("rpc_error", "the endpoint refused the request");
  }
}

export class TestnetRpcTransport implements ViewTransport {
  readonly network = "testnet";
  private readonly gate: Gate;
  private next = 0;
  private readonly requestTimeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly maxResultBytes: number;

  constructor(
    private readonly config: RpcConfig,
    private readonly fetchImpl: FetchLike,
  ) {
    validateRpcConfig(config);
    this.gate = new Gate(config.maxConcurrent ?? 2);
    this.requestTimeoutMs = config.requestTimeoutMs ?? 8_000;
    this.maxResponseBytes = config.maxResponseBytes ?? 512 * 1024;
    this.maxResultBytes = config.maxResultBytes ?? 64 * 1024;
  }

  async finalBlock(network: string, signal?: AbortSignal): Promise<BlockRef> {
    if (network !== this.network) refuse("unsupported", "this transport reads testnet only");
    const r = await this.rpc("block", { finality: "final" }, signal);
    const header =
      r && typeof r === "object" ? (r as { header?: Record<string, unknown> }).header : undefined;
    if (!header || typeof header !== "object")
      return refuse("malformed", "the block has no header");
    return { height: height(header.height, "block height"), hash: hash(header.hash, "block hash") };
  }

  async view(
    input: Parameters<ViewTransport["view"]>[0],
  ): Promise<{ result: string; block: BlockRef }> {
    if (input.network !== this.network) refuse("unsupported", "this transport reads testnet only");
    if (!isAccountId(input.account)) refuse("unsupported", "not a contract account id");
    const args = this.checkedArgs(input.method, input.args);
    // The block identity requested is the pinned hash; finality is never sent with it.
    const r = (await this.rpc(
      "query",
      {
        request_type: "call_function",
        block_id: hash(input.block.hash, "requested block"),
        account_id: input.account,
        method_name: input.method,
        args_base64: Buffer.from(JSON.stringify(args), "utf8").toString("base64"),
      },
      input.signal,
    )) as Record<string, unknown> | null;
    if (!r || typeof r !== "object") return refuse("malformed", "the query has no result");
    // A contract failure arrives as HTTP 200 with a text `error` inside the result; its text and
    // any logs are never carried further.
    if ("error" in r) refuse("execution_failed", "the view call failed in the contract");
    const bytes = r.result;
    if (!Array.isArray(bytes)) return refuse("malformed", "the result is not a byte array");
    if (bytes.length > this.maxResultBytes) refuse("too_large", "the result is too large");
    const buf = new Uint8Array(bytes.length);
    for (const [i, b] of bytes.entries()) {
      if (typeof b !== "number" || !Number.isInteger(b) || b < 0 || b > 255)
        refuse("malformed", "the result holds a value that isn't a byte");
      buf[i] = b as number;
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch {
      return refuse("malformed", "the result isn't valid UTF-8");
    }
    return {
      result: text,
      block: {
        height: height(r.block_height, "result height"),
        hash: hash(r.block_hash, "result hash"),
      },
    };
  }

  /** Only the fixed views and their exact arguments are ever sent. */
  protected checkedArgs(method: string, args: Record<string, unknown>): Record<string, unknown> {
    const keys = args && typeof args === "object" ? Object.keys(args) : null;
    if (!keys) return refuse("unsupported", "arguments must be an object");
    if (VIEWS.has(method)) {
      if (keys.length !== 0) refuse("unsupported", "this view takes no arguments");
      return {};
    }
    if (method === "get_period") {
      const m = args.yyyymm;
      if (
        keys.length !== 1 ||
        typeof m !== "number" ||
        !Number.isInteger(m) ||
        m < 197_001 ||
        m > 999_912 ||
        m % 100 < 1 ||
        m % 100 > 12
      )
        refuse("unsupported", "get_period takes one month, yyyymm");
      return { yyyymm: m };
    }
    return refuse("unsupported", "not a supported view");
  }

  protected async rpc(
    method: "block" | "query" | "send_tx" | "tx",
    params: Record<string, unknown>,
    outer?: AbortSignal,
    /** Job 003w-d: return a JSON-RPC error object (as { rpcError }) instead of throwing. */
    rawErrors = false,
  ) {
    const controller = new AbortController();
    const stopOuter = () => controller.abort();
    if (outer?.aborted) controller.abort();
    outer?.addEventListener("abort", stopOuter, { once: true });
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const signal = controller.signal;
    try {
      await this.gate.enter(signal);
      try {
        const id = `es-${++this.next}`;
        let res: Response;
        try {
          res = await this.fetchImpl(this.config.endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
            signal,
            redirect: "error",
          });
        } catch {
          return refuse(signal.aborted ? "timeout" : "unavailable", "the request didn't complete");
        }
        if (
          res.redirected ||
          res.type === "opaqueredirect" ||
          (res.status >= 300 && res.status < 400)
        )
          refuse("unavailable", "the endpoint redirected");
        if (res.status !== 200) {
          await res.body?.cancel().catch(() => {});
          refuse("unavailable", "the endpoint answered with an HTTP error");
        }
        const declared = Number(res.headers.get("content-length") ?? "");
        if (Number.isFinite(declared) && declared > this.maxResponseBytes) {
          await res.body?.cancel().catch(() => {});
          refuse("too_large", "the response is too large");
        }
        const text = await this.readBody(res, signal);
        let env: unknown;
        try {
          env = JSON.parse(text);
        } catch {
          return refuse("malformed", "the response isn't JSON");
        }
        if (!env || typeof env !== "object" || Array.isArray(env))
          return refuse("malformed", "the response isn't a JSON-RPC object");
        const e = env as Record<string, unknown>;
        if (e.jsonrpc !== "2.0" || e.id !== id)
          refuse("malformed", "the response doesn't answer this request");
        const hasResult = "result" in e;
        const hasError = "error" in e;
        if (hasResult === hasError)
          refuse("malformed", "the response has neither or both of result and error");
        if (hasError && rawErrors) return { rpcError: e.error } as unknown;
        if (hasError) rpcFailure(e.error);
        return e.result;
      } finally {
        this.gate.leave();
      }
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener("abort", stopOuter);
    }
  }

  /** Reads the body as a stream, stopping (and cancelling it) at the byte cap or on abort. */
  private async readBody(res: Response, signal: AbortSignal): Promise<string> {
    if (!res.body) return refuse("malformed", "the response has no body");
    const reader = res.body.getReader();
    const aborted = new Promise<"aborted">((resolve) => {
      if (signal.aborted) resolve("aborted");
      signal.addEventListener("abort", () => resolve("aborted"), { once: true });
    });
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const step = reader.read();
        step.catch(() => {});
        const r = await Promise.race([step, aborted]);
        if (r === "aborted") refuse("timeout", "the response body stalled");
        const { done, value } = r as ReadableStreamReadResult<Uint8Array>;
        if (done) break;
        total += value.byteLength;
        if (total > this.maxResponseBytes) refuse("too_large", "the response is too large");
        chunks.push(value);
      }
    } catch (err) {
      await reader.cancel().catch(() => {});
      if (err instanceof V3ReadError) throw err;
      return refuse(signal.aborted ? "timeout" : "unavailable", "the response body failed");
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    } catch {
      return refuse("malformed", "the response isn't valid UTF-8");
    }
  }
}

// ---------- Job 003w-c: customer reads ----------

const U32_MAX = 0xffff_ffff;
const DECIMAL = /^(0|[1-9][0-9]{0,19})$/;
const FINGERPRINT = /^[0-9a-f]{64}$/;
const NANOS = /^[0-9]{1,30}$/;
const whole = (v: unknown, max: number) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;

/**
 * Job 003w-c: the read-only transport customer use needs (customerRead.ts `CustomerViewTransport`).
 * The same envelope, block-identity, size, deadline, redirect and concurrency rules as
 * `TestnetRpcTransport`; the final block also carries its own timestamp (milliseconds, from the
 * header's `timestamp_nanosec`, converted exactly), and only the customer views with their exact
 * arguments are sent. No keys, no transactions.
 */
export class TestnetCustomerRpcTransport extends TestnetRpcTransport {
  async finalBlock(network: string, signal?: AbortSignal) {
    if (network !== this.network) refuse("unsupported", "this transport reads testnet only");
    const r = await this.rpc("block", { finality: "final" }, signal);
    const header =
      r && typeof r === "object" ? (r as { header?: Record<string, unknown> }).header : undefined;
    if (!header || typeof header !== "object")
      return refuse("malformed", "the block has no header");
    const ns = header.timestamp_nanosec;
    if (typeof ns !== "string" || !NANOS.test(ns))
      return refuse("malformed", "the block has no exact timestamp");
    return {
      height: height(header.height, "block height"),
      hash: hash(header.hash, "block hash"),
      timestamp_ms: (BigInt(ns) / 1_000_000n).toString(),
    };
  }

  protected checkedArgs(method: string, args: Record<string, unknown>): Record<string, unknown> {
    const keys = args && typeof args === "object" ? Object.keys(args).sort() : null;
    if (!keys) return refuse("unsupported", "arguments must be an object");
    const exactly = (...k: string[]) =>
      keys.length === k.length && [...k].sort().every((x, i) => keys[i] === x);
    // Job 003wf2: the sale's views (outcomes and pending payouts take no arguments).
    if (
      method === "get_control" ||
      method === "get_treasury" ||
      method === "get_outcomes" ||
      method === "get_pending" ||
      // Job 003wf4: the guarded plan-creation terms and the measured quote.
      method === "get_plan_terms"
    ) {
      if (keys.length !== 0) refuse("unsupported", "this view takes no arguments");
      return {};
    }
    // Job 003wf2: one party's record, and the declared sale terms for one buyer.
    if (method === "get_party") {
      if (!exactly("account") || typeof args.account !== "string" || !isAccountId(args.account))
        refuse("unsupported", "get_party takes one account");
      return { account: args.account };
    }
    if (method === "get_sale_terms") {
      if (!exactly("buyer") || typeof args.buyer !== "string" || !isAccountId(args.buyer))
        refuse("unsupported", "get_sale_terms takes one buyer account");
      return { buyer: args.buyer };
    }
    if (method === "get_plan") {
      if (!exactly("plan_id") || !whole(args.plan_id, U32_MAX))
        refuse("unsupported", "get_plan takes one plan_id");
      return { plan_id: args.plan_id };
    }
    if (method === "get_entitlement") {
      if (
        !exactly("customer", "plan_id") ||
        typeof args.customer !== "string" ||
        !isAccountId(args.customer) ||
        !whole(args.plan_id, U32_MAX)
      )
        refuse("unsupported", "get_entitlement takes a customer account and a plan_id");
      return { customer: args.customer, plan_id: args.plan_id };
    }
    if (method === "check_use") {
      if (
        !exactly("customer", "plan_id", "reg_id", "hold_seq", "slot", "fingerprint") ||
        typeof args.customer !== "string" ||
        !isAccountId(args.customer) ||
        !whole(args.plan_id, U32_MAX) ||
        typeof args.reg_id !== "string" ||
        !DECIMAL.test(args.reg_id) ||
        !whole(args.hold_seq, U32_MAX) ||
        !whole(args.slot, 255) ||
        typeof args.fingerprint !== "string" ||
        !FINGERPRINT.test(args.fingerprint)
      )
        refuse("unsupported", "check_use takes one exact slot");
      return {
        customer: args.customer,
        plan_id: args.plan_id,
        reg_id: args.reg_id,
        hold_seq: args.hold_seq,
        slot: args.slot,
        fingerprint: args.fingerprint,
      };
    }
    // Job 003wf3: the business contract's managed-handover capabilities (no arguments).
    if (method === "get_handover_terms") {
      if (keys.length !== 0) refuse("unsupported", "get_handover_terms takes no arguments");
      return {};
    }
    // Job 003wec: the business contract's device-key capabilities (no arguments).
    if (method === "get_key_terms") {
      if (keys.length !== 0) refuse("unsupported", "get_key_terms takes no arguments");
      return {};
    }
    // Job 003web: the business contract's declared purchase terms for one customer.
    if (method === "get_purchase_terms") {
      if (!exactly("customer") || typeof args.customer !== "string" || !isAccountId(args.customer))
        refuse("unsupported", "get_purchase_terms takes one customer account");
      return { customer: args.customer };
    }
    // Companion contracts (asset-key, spend-allowance) and the MPC signer's derived keys.
    if (method === "get_config" || method === "get_allowance") {
      if (keys.length !== 0) refuse("unsupported", "this view takes no arguments");
      return {};
    }
    if (method === "get_payments") {
      if (!exactly("from", "limit") || !whole(args.from, 10_000) || !whole(args.limit, 50))
        refuse("unsupported", "get_payments takes from and limit (at most 50)");
      return { from: args.from, limit: args.limit };
    }
    if (method === "get_payment") {
      if (
        !exactly("invoice") ||
        typeof args.invoice !== "string" ||
        !FINGERPRINT.test(args.invoice)
      )
        refuse("unsupported", "get_payment takes one invoice digest");
      return { invoice: args.invoice };
    }
    if (method === "get_claim") {
      if (!exactly("supplier") || typeof args.supplier !== "string" || !isAccountId(args.supplier))
        refuse("unsupported", "get_claim takes one supplier account");
      return { supplier: args.supplier };
    }
    if (method === "derived_public_key") {
      if (
        !exactly("path", "predecessor", "domain_id") ||
        typeof args.path !== "string" ||
        !/^gen-[1-9][0-9]{0,9}$/.test(args.path) ||
        typeof args.predecessor !== "string" ||
        !isAccountId(args.predecessor) ||
        args.domain_id !== 0
      )
        refuse(
          "unsupported",
          "derived_public_key takes a generation path, a predecessor and domain 0",
        );
      return { path: args.path, predecessor: args.predecessor, domain_id: 0 };
    }
    // Job 003web (§10.2): the offer token's standard views, with exact arguments.
    if (method === "ft_metadata" || method === "storage_balance_bounds") {
      if (keys.length !== 0) refuse("unsupported", "this view takes no arguments");
      return {};
    }
    if (method === "ft_balance_of" || method === "storage_balance_of") {
      if (
        !exactly("account_id") ||
        typeof args.account_id !== "string" ||
        !isAccountId(args.account_id)
      )
        refuse("unsupported", `${method} takes one account_id`);
      return { account_id: args.account_id };
    }
    return refuse("unsupported", "not a supported customer view");
  }

  /**
   * The handoff proof: the contract account's code hash and how many access keys it has, both at
   * exactly `block` (`view_account` and `view_access_key_list`). Read-only; no key material is
   * kept, only the count.
   */
  async accountState(input: {
    network: string;
    account: string;
    block: BlockRef;
    signal?: AbortSignal;
  }): Promise<{ code_hash: string; keys: number }> {
    if (input.network !== this.network) refuse("unsupported", "this transport reads testnet only");
    if (!isAccountId(input.account)) refuse("unsupported", "not an account id");
    const at = { block_id: hash(input.block.hash, "requested block"), account_id: input.account };
    const acct = (await this.rpc(
      "query",
      { request_type: "view_account", ...at },
      input.signal,
    )) as Record<string, unknown> | null;
    const code = acct?.code_hash;
    if (typeof code !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(code))
      return refuse("malformed", "the account has no code hash");
    const list = (await this.rpc(
      "query",
      { request_type: "view_access_key_list", ...at },
      input.signal,
    )) as { keys?: unknown } | null;
    if (!list || !Array.isArray(list.keys)) return refuse("malformed", "no access key list");
    return { code_hash: code, keys: list.keys.length };
  }

  /**
   * Job 003web (§10.4): one transaction's FINAL outcome, raw (the purchase resolver checks its
   * exact identity, arguments and receipts). Null when it isn't known or isn't final.
   */
  async txOutcome(hash: string, sender: string, signal?: AbortSignal): Promise<unknown | null> {
    if (!/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash) || !isAccountId(sender)) return null;
    try {
      const r = (await this.rpc(
        "tx",
        { tx_hash: hash, sender_account_id: sender, wait_until: "FINAL" },
        signal,
        true,
      )) as Record<string, unknown> | null;
      if (!r || "rpcError" in r) return null;
      return r.final_execution_status === "FINAL" ? r : null;
    } catch {
      return null;
    }
  }
}

// ---------- Job 003w-b: account key authority, for verified sign-in ----------

export interface AccessKeyReader {
  /** Whether `publicKey` is a FullAccess key of `account` at the final block now. */
  isFullAccessKey(account: string, publicKey: string, signal?: AbortSignal): Promise<boolean>;
}

const PUBLIC_KEY = /^ed25519:[1-9A-HJ-NP-Za-km-z]{32,50}$/;

/**
 * Job 003w-b: one documented read, `query` with `request_type: "view_access_key"` at final
 * finality. An unknown account or key is "no" (it proves nothing); any other failure is a
 * `V3ReadError`, so sign-in fails closed. Read-only, as the class it extends.
 */
export class TestnetAccessKeyReader extends TestnetRpcTransport implements AccessKeyReader {
  async isFullAccessKey(account: string, publicKey: string, signal?: AbortSignal) {
    if (!isAccountId(account)) refuse("unsupported", "not an account id");
    if (!PUBLIC_KEY.test(publicKey)) refuse("unsupported", "not an ed25519 public key");
    let r: unknown;
    try {
      r = await this.rpc(
        "query",
        {
          request_type: "view_access_key",
          finality: "final",
          account_id: account,
          public_key: publicKey,
        },
        signal,
      );
    } catch (e) {
      if (e instanceof V3ReadError && e.code === "unknown_account") return false;
      throw e;
    }
    if (!r || typeof r !== "object") return refuse("malformed", "the key query has no result");
    // Older endpoints report an unknown key as a result carrying `error`.
    if ("error" in (r as object)) return false;
    return (r as { permission?: unknown }).permission === "FullAccess";
  }
}
