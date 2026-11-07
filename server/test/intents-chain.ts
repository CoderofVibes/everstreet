// SYNTHETIC doubles for funding escrow through NEAR's intents verifier: the verifier itself (its
// rules and error texts as in NEAR's published source, which contracts/intents-funding runs on a
// local node), a second test token the buyer pays with, and Everstreet's solver with a throwaway
// local key. For the demo and the app's tests; nothing here is a real key or a real chain.

import { createHash, sign as edSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { verifyNep413 } from "../src/identity.ts";
import { IntentsRefused, type SolverPort } from "../src/intentsFunding.ts";
import { b58, toB58 } from "../src/lightClient.ts";
import { outcome } from "./companion-chain.ts";

// biome-ignore lint/suspicious/noExplicitAny: decoded contract JSON
type Json = any;

/** A NEP-141 ledger: balances and storage registrations. */
export interface Ledger {
  balances: Map<string, bigint>;
  registered: Set<string>;
}

class Refusal extends Error {}
const refuse = (m: string): never => {
  throw new Refusal(m);
};
const MAGIC = "5628f6c6";

export class VerifierDouble {
  /** account → token id (nep141:<token>) → balance held inside the verifier. */
  inside = new Map<string, Map<string, bigint>>();
  keys = new Map<string, Set<string>>();
  nonces = new Set<string>();
  salt = "a1b2c3d4";
  now: () => number = () => Date.now();
  /** Tokens it can pay out, by account. */
  constructor(
    readonly account: string,
    readonly ledgers: Map<string, Ledger>,
  ) {}

  private bal(who: string, id: string) {
    return this.inside.get(who)?.get(id) ?? 0n;
  }
  private add(who: string, id: string, d: bigint) {
    const m = this.inside.get(who) ?? new Map<string, bigint>();
    const v = (m.get(id) ?? 0n) + d;
    if (v < 0n) refuse("insufficient balance or overflow");
    m.set(id, v);
    this.inside.set(who, m);
  }

  /** A token transfer into the verifier (ft_on_transfer): credited to the sender, or `msg`'s receiver. */
  onDeposit(token: string, sender: string, amount: bigint, msg: string) {
    const receiver = msg
      ? String((JSON.parse(msg) as { receiver_id: string }).receiver_id)
      : sender;
    this.add(receiver, `nep141:${token}`, amount);
  }

  /** Checks and applies a batch of signed intents, all or nothing. */
  private run(signed: Json[], apply: boolean) {
    const snapshot = new Map([...this.inside].map(([k, v]) => [k, new Map(v)]));
    const nonces = new Set(this.nonces);
    const deltas = new Map<string, bigint>();
    try {
      for (const s of signed) {
        if (s?.standard !== "nep413") refuse("invalid signature");
        const p = s.payload as Json;
        const nonce = Buffer.from(String(p.nonce), "base64");
        const sig = Buffer.from(b58(String(s.signature).replace(/^ed25519:/, ""))).toString(
          "base64",
        );
        if (
          !verifyNep413({
            message: String(p.message),
            nonce,
            recipient: String(p.recipient),
            callbackUrl: typeof p.callback_url === "string" ? p.callback_url : null,
            publicKey: String(s.public_key),
            signature: sig,
          })
        )
          refuse("invalid signature");
        const m = JSON.parse(String(p.message)) as Json;
        if (p.recipient !== this.account) refuse("wrong verifying_contract");
        const deadline = Date.parse(String(m.deadline));
        if (!(deadline >= this.now())) refuse("deadline has expired");
        const signer = String(m.signer_id);
        if (!this.keys.get(signer)?.has(String(s.public_key)))
          refuse(`public key '${s.public_key}' doesn't exist for account '${signer}'`);
        if (nonce.subarray(0, 4).toString("hex") === MAGIC) {
          if (nonce.subarray(5, 9).toString("hex") !== this.salt) refuse("invalid salt");
          const nonceDeadline = Number(nonce.readBigInt64LE(9) / 1_000_000n);
          if (deadline > nonceDeadline) refuse("deadline is greater than nonce");
          if (nonceDeadline < this.now()) refuse("nonce was already expired");
        }
        const key = `${signer}:${p.nonce}`;
        if (this.nonces.has(key)) refuse("nonce was already used");
        this.nonces.add(key);
        for (const intent of m.intents as Json[]) {
          if (intent.intent !== "token_diff") refuse("invalid intent");
          for (const [id, v] of Object.entries(intent.diff as Record<string, string>)) {
            const d = BigInt(v);
            if (d === 0n) refuse("invalid intent");
            this.add(signer, id, d);
            deltas.set(id, (deltas.get(id) ?? 0n) + d);
          }
        }
      }
      const unmatched = [...deltas].filter(([, v]) => v !== 0n);
      if (!apply || unmatched.length > 0) {
        this.inside = snapshot;
        this.nonces = nonces;
      }
      return unmatched.length > 0
        ? {
            invariant_violated: {
              unmatched_deltas: Object.fromEntries(unmatched.map(([k, v]) => [k, String(v)])),
            },
          }
        : {};
    } catch (e) {
      this.inside = snapshot;
      this.nonces = nonces;
      throw e;
    }
  }

  /** `execute_intents`: refused whole if any side fails or the diffs don't balance. */
  execute(signed: Json[]) {
    const r = this.run(signed, true);
    if (r.invariant_violated) refuse("invariant violated");
  }

  view(method: string, args: Json): string | undefined {
    switch (method) {
      case "mt_balance_of":
        return JSON.stringify(String(this.bal(String(args.account_id), String(args.token_id))));
      case "has_public_key":
        return JSON.stringify(
          this.keys.get(String(args.account_id))?.has(String(args.public_key)) ?? false,
        );
      case "is_nonce_used":
        return JSON.stringify(this.nonces.has(`${args.account_id}:${args.nonce}`));
      case "current_salt":
        return JSON.stringify(this.salt);
      case "simulate_intents": {
        try {
          return JSON.stringify({ state: { fee: 0 }, ...this.run(args.signed as Json[], false) });
        } catch (e) {
          if (e instanceof Refusal) throw new Error(`Smart contract panicked: ${e.message}`);
          throw e;
        }
      }
      default:
        return undefined;
    }
  }

  walletCall(signer: string, call: Json) {
    const result = (() => {
      try {
        const deposit = BigInt(call.deposit);
        const a = call.args as Json;
        if (call.methodName === "add_public_key") {
          if (deposit !== 1n) refuse("Requires attached deposit of exactly 1 yoctoNEAR");
          const set = this.keys.get(signer) ?? new Set<string>();
          if (set.has(String(a.public_key)))
            refuse(`public key '${a.public_key}' already exists for account '${signer}'`);
          set.add(String(a.public_key));
          this.keys.set(signer, set);
          return { ok: true as const, logs: [], value: null };
        }
        if (call.methodName === "ft_withdraw") {
          if (deposit !== 1n) refuse("Requires attached deposit of exactly 1 yoctoNEAR");
          const token = String(a.token);
          const ledger = this.ledgers.get(token) ?? refuse(`token_id: nep141:${token}`);
          const amount = BigInt(a.amount);
          this.add(signer, `nep141:${token}`, -amount);
          const to = String(a.receiver_id);
          if (!ledger.registered.has(to)) {
            // The token refuses the transfer; the verifier's resolve credits it back.
            this.add(signer, `nep141:${token}`, amount);
            return { ok: true as const, logs: [], value: "0" };
          }
          ledger.balances.set(this.account, (ledger.balances.get(this.account) ?? 0n) - amount);
          ledger.balances.set(to, (ledger.balances.get(to) ?? 0n) + amount);
          return { ok: true as const, logs: [], value: String(amount) };
        }
        if (call.methodName === "execute_intents") {
          this.execute(a.signed as Json[]);
          return { ok: true as const, logs: [], value: null };
        }
        refuse(`MethodNotFound: ${call.methodName}`);
      } catch (e) {
        if (e instanceof Refusal) return { ok: false as const, error: e.message };
        throw e;
      }
    })() as { ok: true; logs: string[]; value: unknown } | { ok: false; error: string };
    return outcome(this.account, signer, call, result);
  }
}

/** A second NEP-141 test token: what the buyer pays with. */
export class AltTokenDouble {
  readonly ledger: Ledger = { balances: new Map(), registered: new Set() };
  constructor(
    readonly account: string,
    readonly symbol: string,
    private readonly verifier: VerifierDouble,
  ) {}

  view(method: string, args: Json): string | undefined {
    if (method === "ft_balance_of")
      return JSON.stringify(String(this.ledger.balances.get(String(args.account_id)) ?? 0n));
    if (method === "ft_metadata")
      return JSON.stringify({
        spec: "ft-1.0.0",
        name: this.symbol,
        symbol: this.symbol,
        decimals: 6,
      });
    if (method === "storage_balance_of")
      return JSON.stringify(
        this.ledger.registered.has(String(args.account_id))
          ? { total: "1250000000000000000000", available: "0" }
          : null,
      );
    return undefined;
  }

  walletCall(signer: string, call: Json) {
    const a = call.args as Json;
    const r = (() => {
      if (call.methodName === "storage_deposit") {
        this.ledger.registered.add(String(a.account_id ?? signer));
        return { ok: true as const, logs: [], value: null };
      }
      if (call.methodName !== "ft_transfer_call" && call.methodName !== "ft_transfer")
        return { ok: false as const, error: `MethodNotFound: ${call.methodName}` };
      if (call.deposit !== "1")
        return { ok: false as const, error: "Requires attached deposit of exactly 1 yoctoNEAR" };
      const to = String(a.receiver_id);
      const amount = BigInt(a.amount);
      if (!this.ledger.registered.has(to))
        return { ok: false as const, error: `The account ${to} is not registered` };
      if ((this.ledger.balances.get(signer) ?? 0n) < amount)
        return { ok: false as const, error: "The account doesn't have enough balance" };
      this.ledger.balances.set(signer, (this.ledger.balances.get(signer) ?? 0n) - amount);
      this.ledger.balances.set(to, (this.ledger.balances.get(to) ?? 0n) + amount);
      if (call.methodName === "ft_transfer_call") {
        if (to !== this.verifier.account) {
          // No receiver contract here: the whole amount comes back.
          this.ledger.balances.set(to, (this.ledger.balances.get(to) ?? 0n) - amount);
          this.ledger.balances.set(signer, (this.ledger.balances.get(signer) ?? 0n) + amount);
          return { ok: true as const, logs: [], value: "0" };
        }
        this.verifier.onDeposit(this.account, signer, amount, String(a.msg ?? ""));
      }
      return { ok: true as const, logs: [], value: String(amount) };
    })();
    return outcome(this.account, signer, call, r);
  }
}

/** Everstreet's solver, with a throwaway local key: signs its side and submits the pair. */
export class SyntheticSolver implements SolverPort {
  readonly source = "synthetic" as const;
  readonly publicKey: string;
  private readonly key: KeyObject;
  /** Makes the next submission's response go missing (it still runs). */
  loseNext = false;
  constructor(
    readonly account: string,
    private readonly verifier: VerifierDouble,
  ) {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    this.key = privateKey;
    const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
    this.publicKey = `ed25519:${toB58(Uint8Array.from(raw))}`;
    const set = verifier.keys.get(account) ?? new Set<string>();
    set.add(this.publicKey);
    verifier.keys.set(account, set);
  }
  sign(digest: Buffer) {
    return edSign(null, digest, this.key);
  }
  async execute(_verifier: string, signed: unknown[]) {
    try {
      this.verifier.execute(signed as Json[]);
    } catch (e) {
      if (e instanceof Refusal) throw new IntentsRefused(e.message);
      throw e;
    }
    if (this.loseNext) {
      this.loseNext = false;
      throw new Error("the response didn't arrive");
    }
    const hash = createHash("sha256")
      .update(`${Date.now()}-${JSON.stringify(signed)}`)
      .digest();
    return { hash: toB58(Uint8Array.from(hash)) };
  }
}

export const VERIFIER = "intents.synthetic.near";
export const ALT_TOKEN = "talt.synthetic.near";
export const SOLVER = "solver.synthetic.near";

/**
 * The verifier, the second token and the solver next to one synthetic world. `sale` is the sale
 * token's shared ledger; the solver's `solverFloat` of it sits inside the verifier, ready.
 */
export function attachIntents(
  chain: {
    companions: Map<
      string,
      { view(m: string, a: Json): string | undefined; walletCall?(s: string, c: Json): Json }
    >;
  },
  sale: { token: string; ledger: Ledger },
  solverFloat: bigint,
) {
  const ledgers = new Map<string, Ledger>();
  const verifier = new VerifierDouble(VERIFIER, ledgers);
  const alt = new AltTokenDouble(ALT_TOKEN, "tALT", verifier);
  ledgers.set(sale.token, sale.ledger);
  ledgers.set(ALT_TOKEN, alt.ledger);
  sale.ledger.registered.add(VERIFIER);
  alt.ledger.registered.add(VERIFIER);
  sale.ledger.balances.set(VERIFIER, (sale.ledger.balances.get(VERIFIER) ?? 0n) + solverFloat);
  verifier.inside.set(SOLVER, new Map([[`nep141:${sale.token}`, solverFloat]]));
  const solver = new SyntheticSolver(SOLVER, verifier);
  chain.companions.set(VERIFIER, verifier);
  chain.companions.set(ALT_TOKEN, alt);
  return { verifier, alt, solver };
}
