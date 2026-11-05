// Job 003w-b: verified account sign-in (docs/design/APPLICATION_COMPOSITION.md §4).
//
// NEP-413 (github.com/near/NEPs/blob/master/neps/nep-0413.md): a wallet signs
//   sha256( u32_le(2^31 + 413) || borsh(Payload { message: string, nonce: [u8; 32],
//                                                recipient: string, callbackUrl: Option<string> }) )
// with an account's FULL-ACCESS ed25519 key. This module issues a one-use challenge (the server
// chooses message, nonce and recipient), rebuilds that exact payload, verifies the signature with
// node:crypto, and asks an injected `AccessKeyReader` whether the key is a FullAccess key of the
// claimed account now. A returned account id alone is never proof.
//
// This is ACCOUNT PROOF only. It is never customer-use authorization: the contract verifies
// raw hold/use digests signed by registered device use keys (WalletIntegrationAlignment), and
// NEP-413's tagged payload is a different message. Nothing here signs, holds keys or transacts.

import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import type { Person, Store } from "./store.ts";
import { HttpError } from "./store.ts";
import { isAccountId } from "./v3read.ts";
import type { AccessKeyReader } from "./v3rpc.ts";

export const NEP413_TAG = 2 ** 31 + 413;
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Base58 (Bitcoin alphabet) decode; throws on any other character. */
export function base58Decode(s: string): Buffer {
  let n = 0n;
  for (const ch of s) {
    const v = B58.indexOf(ch);
    if (v < 0) throw new Error("not base58");
    n = n * 58n + BigInt(v);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const ch of s) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  return Buffer.from(bytes);
}

const borshString = (s: string) => {
  const b = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(b.length);
  return Buffer.concat([len, b]);
};

/**
 * The exact bytes NEP-413 signs (their SHA-256). `callbackUrl` absent or null: `None`; a string:
 * `Some(that exact string)` (job 003w-e1: the pinned MyNearWallet module always sends one).
 */
export function nep413Digest(p: {
  message: string;
  nonce: Buffer;
  recipient: string;
  callbackUrl?: string | null;
}): Buffer {
  if (p.nonce.length !== 32) throw new Error("the nonce must be 32 bytes");
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(NEP413_TAG);
  const payload = Buffer.concat([
    borshString(p.message),
    p.nonce,
    borshString(p.recipient),
    typeof p.callbackUrl === "string"
      ? Buffer.concat([Buffer.from([1]), borshString(p.callbackUrl)])
      : Buffer.from([0]),
  ]);
  return createHash("sha256")
    .update(Buffer.concat([tag, payload]))
    .digest();
}

const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");
const PUBLIC_KEY = /^ed25519:([1-9A-HJ-NP-Za-km-z]{32,50})$/;

/** Verifies an ed25519 signature (base64) over the NEP-413 digest; false for anything malformed. */
export function verifyNep413(input: {
  message: string;
  nonce: Buffer;
  recipient: string;
  callbackUrl?: string | null;
  publicKey: string;
  signature: string;
}): boolean {
  try {
    const m = PUBLIC_KEY.exec(input.publicKey);
    if (!m) return false;
    const raw = base58Decode(m[1] as string);
    if (raw.length !== 32) return false;
    const sig = Buffer.from(input.signature, "base64");
    if (sig.length !== 64 || sig.toString("base64") !== input.signature) return false;
    const key = createPublicKey({
      key: Buffer.concat([SPKI_ED25519, raw]),
      format: "der",
      type: "spki",
    });
    return verify(null, nep413Digest(input), key, sig);
  } catch {
    return false;
  }
}

export interface SignInOptions {
  /** The application identity the payload must name (NEP-413 `recipient`). */
  recipient: string;
  /** Only "testnet" in this slice. */
  network: string;
  reader: AccessKeyReader;
  /**
   * Job 003w-e1: the exact callback URL issued with every challenge (`<return origin>/signin/return`)
   * so a wallet that signs it can be verified. Never taken from a client.
   */
  callbackUrl?: string | null;
  challengeTtlMs?: number;
  /** Absolute session lifetime; 15 min to 7 days; default 12 h. */
  sessionTtlMs?: number;
  readTimeoutMs?: number;
  now?: () => number;
}

const RECIPIENT = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const BINDING = /^[A-Za-z0-9_-]{43}$/;
const bindingHash = (b: string) => createHash("sha256").update(b).digest("hex");
const NONCE_B64 = /^[A-Za-z0-9+/]{43}=$/;

export class AccountSignIn {
  readonly sessionTtlMs: number;
  private readonly challengeTtlMs: number;
  private readonly readTimeoutMs: number;
  readonly now: () => number;

  constructor(
    private readonly store: Store,
    private readonly opts: SignInOptions,
  ) {
    if (opts.network !== "testnet") throw new Error("sign-in: only testnet is supported");
    if (!RECIPIENT.test(opts.recipient)) throw new Error("sign-in: the recipient is invalid");
    this.sessionTtlMs = opts.sessionTtlMs ?? 12 * 3_600_000;
    if (
      !Number.isSafeInteger(this.sessionTtlMs) ||
      this.sessionTtlMs < 900_000 ||
      this.sessionTtlMs > 7 * 86_400_000
    )
      throw new Error("sign-in: the session lifetime must be 15 minutes to 7 days");
    if (opts.callbackUrl != null) {
      const u = new URL(opts.callbackUrl);
      if (
        u.href !== opts.callbackUrl ||
        u.pathname !== "/signin/return" ||
        u.search ||
        u.hash ||
        !/^https?:$/.test(u.protocol)
      )
        throw new Error("sign-in: the callback must be <origin>/signin/return");
    }
    this.challengeTtlMs = opts.challengeTtlMs ?? 300_000;
    this.readTimeoutMs = opts.readTimeoutMs ?? 10_000;
    this.now = opts.now ?? Date.now;
  }

  get network() {
    return this.opts.network;
  }

  get challengeTtl() {
    return this.challengeTtlMs;
  }

  /** The exact callback URL challenges are issued with, or null (wallet sign-in can't verify it). */
  get callbackUrl() {
    return this.opts.callbackUrl ?? null;
  }

  /**
   * A fresh one-use challenge for a wallet to sign (NEP-413), bound to the browser that asked:
   * its binding is a random secret the route sets as an HttpOnly cookie; only its hash is stored, and
   * verify needs the same cookie (Astra's CompositionDesignReview: a proof started in one browser
   * must never sign in another).
   */
  challenge() {
    const now = this.now();
    const message = `Sign in to Everstreet (${this.opts.recipient})`;
    const binding = randomBytes(32).toString("base64url");
    const nonce = this.store.createChallenge(
      message,
      this.opts.recipient,
      bindingHash(binding),
      this.challengeTtlMs,
      now,
      this.callbackUrl,
    );
    return {
      binding,
      challenge: {
        message,
        nonce,
        recipient: this.opts.recipient,
        callback_url: this.callbackUrl,
        expires_at: new Date(now + this.challengeTtlMs).toISOString(),
      },
    };
  }

  /**
   * Verifies a signed challenge and returns the person and a verified session. Every refusal is
   * a fixed 401 (nothing about which check failed beyond its code), and the challenge is spent
   * whether or not the rest succeeds, so it can't be replayed.
   */
  async verify(
    body: {
      account_id?: unknown;
      public_key?: unknown;
      signature?: unknown;
      nonce?: unknown;
    },
    /** The initiating browser's binding cookie (absent: refused). */
    binding: string | undefined,
  ): Promise<{ person: Person; token: string; expiresMs: number }> {
    const deny = (code: string): never => {
      throw new HttpError(401, "That sign-in couldn't be verified; start again", code);
    };
    const { account_id, public_key, signature, nonce } = body;
    if (
      typeof account_id !== "string" ||
      !isAccountId(account_id) ||
      typeof public_key !== "string" ||
      typeof signature !== "string" ||
      typeof nonce !== "string" ||
      !NONCE_B64.test(nonce)
    )
      return deny("sign_in_invalid");
    if (typeof binding !== "string" || !BINDING.test(binding)) return deny("sign_in_binding");
    const challenge = this.store.consumeChallenge(nonce, bindingHash(binding), this.now());
    if (!challenge) return deny("sign_in_challenge");
    // A challenge issued under another configured application identity is never honoured.
    if (challenge.recipient !== this.opts.recipient) return deny("sign_in_recipient");
    // Exactly two payloads (§9.2): without a callback, or with the one THIS challenge was issued
    // with. Never a URL from the client.
    const variants: ["none" | "issued", string | null][] = [["none", null]];
    if (challenge.callback_url) variants.push(["issued", challenge.callback_url]);
    const verified = variants.find(([, callbackUrl]) =>
      verifyNep413({
        message: challenge.message,
        nonce: Buffer.from(nonce, "base64"),
        recipient: challenge.recipient,
        callbackUrl,
        publicKey: public_key,
        signature,
      }),
    );
    if (!verified) return deny("sign_in_signature");
    this.store.recordChallengeVariant(nonce, verified[0]);
    let full = false;
    try {
      full = await this.opts.reader.isFullAccessKey(
        account_id,
        public_key,
        AbortSignal.timeout(this.readTimeoutMs),
      );
    } catch {
      throw new HttpError(
        503,
        "NEAR couldn't be read to confirm the account; try again",
        "sign_in_unavailable",
      );
    }
    if (!full) return deny("sign_in_key");
    const expiresMs = this.now() + this.sessionTtlMs;
    // A logout in this browser while the key was being read cancelled the challenge: no session.
    const done = this.store.finishSignIn(nonce, account_id, this.opts.network, expiresMs);
    if (!done) return deny("sign_in_cancelled");
    return { ...done, expiresMs };
  }

  /**
   * Job 003w-e1: a logout, or a newer challenge, from the browser holding this binding ends its
   * earlier attempt: challenges cancelled, and a session it minted but never delivered deleted.
   */
  cancel(binding: string | undefined) {
    if (typeof binding === "string" && BINDING.test(binding))
      this.store.endBinding(bindingHash(binding), this.now());
  }
}
