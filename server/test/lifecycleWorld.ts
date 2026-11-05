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
import { httpsTransport } from "../src/anthropic.ts";
import { validateConfig } from "../src/appConfig.ts";
import { composeApplication } from "../src/compose.ts";
import { verifiesEd25519 } from "../src/customerSigning.ts";
import { base58Encode } from "../src/customerWriter.ts";
import { nep413Digest } from "../src/identity.ts";
import { AnthropicRuntime } from "../src/runtime.ts";
import { CUSTOMER, customerWorld, type FixtureChain, type Json, TOKEN } from "./customer-world.ts";
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
    return async (url: string, init: { body: string }) => {
      if (url !== RPC) throw new Error(`synthetic RPC: refused ${url}`);
      return new Response(await rpc.answer(init.body), { status: 200 });
    };
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
  readonly outcomes = new Map<string, Json>();
  /** Every distinct signed transaction applied (method, args). */
  readonly applied: { method: string; args: Json }[] = [];
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
  constructor(readonly chain: FixtureChain) {}

  private snapshot(height: number) {
    const c = this.chain;
    this.snapshots.set(height, {
      control: structuredClone(c.control),
      treasury: structuredClone(c.treasury),
      plan: structuredClone(c.plan),
      ents: new Map([...c.ents].map(([k, v]) => [k, structuredClone(v)])),
      // Job 003wf2: the sale half of the same state and the token ledger, as they were then.
      sale: c.sale ? c.sale.fork() : null,
      balances: new Map(c.balances),
      tokenRegistered: new Set(c.tokenRegistered),
    });
    for (const h of [...this.snapshots.keys()]) if (h < height - 64) this.snapshots.delete(h);
  }

  /** The next send_tx waits (before it is applied) until opened. */
  holdNextSend() {
    this.heldSend = barrier();
    return this.heldSend;
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
        permission: "FullAccess",
        block_height: this.chain.height,
        block_hash: this.hashFor(this.chain.height),
      });
    }
    if (req.method === "query" && p.request_type === "call_function") {
      // Only the one contract this double models and (job 003wf2) its token; any other account
      // doesn't exist here.
      if (p.account_id !== this.chain.business && p.account_id !== TOKEN)
        return fail("UNKNOWN_ACCOUNT");
      const height = this.hashes.get(String(p.block_id));
      const snap = height === undefined ? undefined : this.snapshots.get(height);
      if (height === undefined || !snap) return fail("UNKNOWN_BLOCK");
      const args = JSON.parse(Buffer.from(String(p.args_base64), "base64").toString("utf8"));
      // The double's own view rules, over the state as it was at that block.
      const then = Object.assign(Object.create(this.chain) as FixtureChain, snap);
      let text: string;
      try {
        text = this.chain.answer.call(then, String(p.method_name), args);
      } catch {
        return ok({ error: "synthetic: no such view", logs: [] });
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
      const h = this.heldSend;
      if (h) {
        this.heldSend = null;
        h.arrive();
        await h.release;
      }
      return this.apply(String(p.signed_tx_base64), ok, fail);
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
    // The envelope this double can establish: ed25519, one FunctionCall to the modelled business,
    // a block this endpoint issued, the writer's gas and no deposit, nothing trailing. Anything
    // else is refused, never applied as a fixture method.
    if (
      t.keyType !== 0 ||
      t.sigType !== 0 ||
      t.actions !== 1 ||
      t.actionKind !== 2 ||
      t.rest !== 0 ||
      t.gas !== GAS ||
      t.deposit !== 0n ||
      !this.hashes.has(base58Encode(t.blockHash))
    )
      return fail("INVALID_TRANSACTION", { InvalidTxError: "UnsupportedByThisDouble" });
    if (t.receiver !== this.chain.business || !METHODS.has(t.method))
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
    this.keys.set(key, t.nonce);
    this.sync();
    let status: Json;
    try {
      const a = t.args;
      if (t.method === "open_hold")
        this.chain.openHold(t.signer, a.customer, a.auth, a.sig, verifiesEd25519);
      else if (t.method === "settle_hold")
        this.chain.settleHold(t.signer, a.customer, a.hold_seq, a.uses, a.close, verifiesEd25519);
      else this.chain.releaseHoldFor(t.signer, a.customer, a.reg_id, a.hold_seq);
      this.applied.push({ method: t.method, args: a });
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
export async function bootstrap(dir: string, port: number, maintenance: Json) {
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
    businessAccount: BIZ,
    runtimeProvider: new AnthropicRuntime(
      ai.config,
      httpsTransport(ai.apiKey, { fetchImpl: model.fetch() }),
    ),
  });
  const offer = await w.offer();
  // The chain double appoints the platform's configured metering account; it follows real time.
  w.chain.control = { ...w.chain.control, operators: [[OP, 1, w.chain.control.generation]] };
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
    v3: { bindings: [{ business_id: w.f.business, account: BIZ }] },
    customer: { operator_account: OP, writer: { key_file: writerKey } },
    protected_storage: { root, active_key_id: "k1", keys_file: protectedKeys },
    model: { ai_config_file: aiFile, api_key_env: API_KEY_ENV },
    maintenance: { enabled: true, ...maintenance },
  };
  const configFile = join(dir, "config.json");
  writeFileSync(configFile, JSON.stringify(config));
  return { w, offer, rpc, model, cara, ava, configFile, config, db, sign };
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
