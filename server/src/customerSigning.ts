// Job 003m: the exact bytes a customer's use-key signs, and the app's own commitments
// (docs/design/CUSTOMER_USE_RUNTIME.md §4). Borsh's encoding written by hand: a string is a u32 LE
// byte length then its UTF-8 bytes; integers are little-endian at their exact width; a fixed byte
// array has no length prefix. Never bare concatenation. Checked byte-for-byte against the
// contract-produced fixture (server/test/fixtures/v3/customer-signing.json). This module verifies
// signatures; it never creates one and never holds a private key.

import { createHash, createPublicKey, verify } from "node:crypto";

export const HOLD_DOMAIN = "business-hold/v1";
export const USE_DOMAIN = "business-use/v1";
export const FINGERPRINT_DOMAIN = "customer-use-fingerprint/v1";
export const ENVELOPE_VERSION = "customer-sign-envelope/v1";
/** The contract's shortest hold (`MIN_SERVE_MS`): a HoldAuth is accepted until serve_until − this. */
export const MIN_SERVE_MS = 60_000n;

const U32_MAX = 0xffff_ffffn;
const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
const HEX32 = /^[0-9a-f]{64}$/;
const HEX64 = /^[0-9a-f]{128}$/;
const DEC = /^(0|[1-9][0-9]{0,38})$/;

/** A canonical decimal string (no sign, no leading zeros) within `max`. */
export function canonicalDecimal(s: unknown, max: bigint): s is string {
  return typeof s === "string" && DEC.test(s) && BigInt(s) <= max;
}

/** An append-only borsh-style writer; every method checks its range and throws on misuse. */
export class Enc {
  private parts: Buffer[] = [];
  str(s: string) {
    const b = Buffer.from(s, "utf8");
    this.u32(b.length);
    this.parts.push(b);
    return this;
  }
  u8(n: number) {
    if (!Number.isInteger(n) || n < 0 || n > 0xff) throw new RangeError("u8 out of range");
    this.parts.push(Buffer.from([n]));
    return this;
  }
  u16(n: number) {
    if (!Number.isInteger(n) || n < 0 || n > 0xffff) throw new RangeError("u16 out of range");
    const b = Buffer.alloc(2);
    b.writeUInt16LE(n);
    this.parts.push(b);
    return this;
  }
  u32(n: number) {
    if (!Number.isInteger(n) || n < 0 || BigInt(n) > U32_MAX)
      throw new RangeError("u32 out of range");
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    this.parts.push(b);
    return this;
  }
  u64(s: string) {
    if (!canonicalDecimal(s, U64_MAX)) throw new RangeError("u64 is not a canonical decimal");
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(s));
    this.parts.push(b);
    return this;
  }
  u128(s: string) {
    if (!canonicalDecimal(s, U128_MAX)) throw new RangeError("u128 is not a canonical decimal");
    const v = BigInt(s);
    const b = Buffer.alloc(16);
    b.writeBigUInt64LE(v & U64_MAX, 0);
    b.writeBigUInt64LE(v >> 64n, 8);
    this.parts.push(b);
    return this;
  }
  /** A fixed 32-byte array from lowercase hex: no length prefix. */
  bytes32(hex: string) {
    if (!HEX32.test(hex)) throw new RangeError("not 32 bytes of lowercase hex");
    this.parts.push(Buffer.from(hex, "hex"));
    return this;
  }
  done(): Buffer {
    return Buffer.concat(this.parts);
  }
}

export const sha256 = (b: Buffer) => createHash("sha256").update(b).digest();
export const sha256Hex = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

/** The identity every message shares: one entitlement and one of its keys. */
export interface KeyRef {
  business: string;
  plan_id: number;
  customer: string;
  reg_id: string;
  key_slot: number;
  key_epoch: number;
}

const head = (domain: string, k: KeyRef) =>
  new Enc()
    .str(domain)
    .str(k.business)
    .u32(k.plan_id)
    .str(k.customer)
    .u64(k.reg_id)
    .u8(k.key_slot)
    .u32(k.key_epoch);

/** The contract's `hold_message` preimage (lib.rs `hold_message`). */
export function preimageOfHold(
  k: KeyRef,
  hold: { hold_seq: number; units: number; serve_until_ms: string },
) {
  return head(HOLD_DOMAIN, k).u32(hold.hold_seq).u8(hold.units).u64(hold.serve_until_ms).done();
}

/** The contract's `use_message` preimage (lib.rs `use_message`). */
export function preimageOfUse(
  k: KeyRef,
  use: { hold_seq: number; slot: number; fingerprint: string },
) {
  return head(USE_DOMAIN, k).u32(use.hold_seq).u8(use.slot).bytes32(use.fingerprint).done();
}

/** The app's fingerprint commitment (§4): binds the network, request, release and input. */
export function fingerprintPreimage(
  k: KeyRef & {
    network: string;
    hold_seq: number;
    slot: number;
    request_id: string;
    offer_id: string;
    release_id: string;
    artifact_digest: string;
    input_sha256: string;
    salt: string;
  },
) {
  return new Enc()
    .str(FINGERPRINT_DOMAIN)
    .str(k.network)
    .str(k.business)
    .u32(k.plan_id)
    .str(k.customer)
    .u64(k.reg_id)
    .u8(k.key_slot)
    .u32(k.key_epoch)
    .u32(k.hold_seq)
    .u8(k.slot)
    .str(k.request_id)
    .str(k.offer_id)
    .str(k.release_id)
    .bytes32(k.artifact_digest)
    .bytes32(k.input_sha256)
    .bytes32(k.salt)
    .done();
}

/** `closed_hold_root`'s preimage: a u32 count, then (slot u8, fingerprint [32]) in slot order. */
export function closedRootPreimage(used: readonly (readonly [number, string])[]) {
  const e = new Enc().u32(used.length);
  let last = -1;
  for (const [slot, fp] of used) {
    if (slot <= last) throw new RangeError("used slots must be in increasing order");
    last = slot;
    e.u8(slot).bytes32(fp);
  }
  return e.done();
}

/** The signing envelope, without its digest (§3.1). */
export interface Envelope {
  version: typeof ENVELOPE_VERSION;
  request_id: string;
  offer_id: string;
  release_id: string;
  artifact_digest: string;
  network: string;
  business_account: string;
  plan_id: number;
  customer_account: string;
  reg_id: string;
  key_slot: number;
  key_epoch: number;
  public_key: string;
  hold: {
    hold_seq: number;
    units: number;
    serve_until_ms: string;
    preimage_hex: string;
    message_hex: string;
  };
  use: { slot: number; fingerprint_hex: string; preimage_hex: string; message_hex: string };
  commitment: { input_sha256: string; salt_hex: string; fingerprint_preimage_hex: string };
  consent: {
    unit_price: string;
    asset: string;
    units: number;
    retention_days: number;
    sign_by_ms: string;
    accept_by_ms: string;
  };
}

/** sha256 over every envelope field in order (§3.1); variable bytes as length-prefixed hex text. */
export function envelopeDigest(v: Envelope) {
  const e = new Enc()
    .str(v.version)
    .str(v.request_id)
    .str(v.offer_id)
    .str(v.release_id)
    .bytes32(v.artifact_digest)
    .str(v.network)
    .str(v.business_account)
    .u32(v.plan_id)
    .str(v.customer_account)
    .u64(v.reg_id)
    .u8(v.key_slot)
    .u32(v.key_epoch)
    .bytes32(v.public_key)
    .u32(v.hold.hold_seq)
    .u8(v.hold.units)
    .u64(v.hold.serve_until_ms);
  e.str(v.hold.preimage_hex).bytes32(v.hold.message_hex);
  e.u8(v.use.slot).bytes32(v.use.fingerprint_hex);
  e.str(v.use.preimage_hex).bytes32(v.use.message_hex);
  e.bytes32(v.commitment.input_sha256).bytes32(v.commitment.salt_hex);
  e.str(v.commitment.fingerprint_preimage_hex);
  e.u128(v.consent.unit_price)
    .str(v.consent.asset)
    .u8(v.consent.units)
    .u16(v.consent.retention_days)
    .u64(v.consent.sign_by_ms)
    .u64(v.consent.accept_by_ms);
  return sha256Hex(e.done());
}

/**
 * Whether `sig` (128 hex) is `public_key`'s ed25519 signature over the 32-byte `message` (hex).
 * The contract verifies the digest, never the preimage. Malformed input is simply false.
 */
export function verifiesEd25519(publicKey: string, message: string, sig: unknown): boolean {
  if (!HEX32.test(publicKey) || !HEX32.test(message)) return false;
  if (typeof sig !== "string" || !HEX64.test(sig)) return false;
  try {
    const key = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(publicKey, "hex").toString("base64url") },
      format: "jwk",
    });
    return verify(null, Buffer.from(message, "hex"), key, Buffer.from(sig, "hex"));
  } catch {
    return false;
  }
}
