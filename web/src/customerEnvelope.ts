// Job 003q: the customer's browser checks a prepared signing envelope ITSELF before any
// authorization is requested (docs/design/CUSTOMER_USE_RUNTIME.md §3, §4). It recomputes, from the
// envelope's plain fields and the document the customer typed, the input commitment, the
// fingerprint, both contract messages and the envelope digest, with the same canonical encoding
// as the contract (borsh: u32-LE-length strings, little-endian integers, fixed arrays without a
// prefix). It never signs, and it never trusts an opaque hash from the server.

export interface SigningEnvelope {
  version: string;
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
  envelope_digest: string;
}

const HEX32 = /^[0-9a-f]{64}$/;
const DEC = /^(0|[1-9][0-9]{0,38})$/;
const U64_MAX = (1n << 64n) - 1n;

class Enc {
  private parts: number[] = [];
  private push(bytes: Iterable<number>) {
    for (const b of bytes) this.parts.push(b);
  }
  u8(n: number) {
    if (!Number.isInteger(n) || n < 0 || n > 0xff) throw new Error("u8");
    this.parts.push(n);
    return this;
  }
  u16(n: number) {
    if (!Number.isInteger(n) || n < 0 || n > 0xffff) throw new Error("u16");
    this.push([n & 0xff, n >>> 8]);
    return this;
  }
  u32(n: number) {
    if (!Number.isInteger(n) || n < 0 || n > 0xffff_ffff) throw new Error("u32");
    this.push([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, n >>> 24]);
    return this;
  }
  private le(v: bigint, bytes: number) {
    for (let i = 0; i < bytes; i++) this.parts.push(Number((v >> BigInt(8 * i)) & 0xffn));
  }
  u64(s: string) {
    if (!DEC.test(s) || BigInt(s) > U64_MAX) throw new Error("u64");
    this.le(BigInt(s), 8);
    return this;
  }
  u128(s: string) {
    if (!DEC.test(s) || BigInt(s) >= 1n << 128n) throw new Error("u128");
    this.le(BigInt(s), 16);
    return this;
  }
  str(s: string) {
    const b = new TextEncoder().encode(s);
    this.u32(b.length);
    this.push(b);
    return this;
  }
  bytes32(hex: string) {
    if (!HEX32.test(hex)) throw new Error("bytes32");
    this.push(fromHex(hex));
    return this;
  }
  done() {
    return Uint8Array.from(this.parts);
  }
}

export function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export const toHex = (b: Uint8Array) =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)));
}

const head = (domain: string, e: SigningEnvelope) =>
  new Enc()
    .str(domain)
    .str(e.business_account)
    .u32(e.plan_id)
    .str(e.customer_account)
    .u64(e.reg_id)
    .u8(e.key_slot)
    .u32(e.key_epoch);

/** The contract's `hold_message` preimage. */
export const preimageOfHold = (e: SigningEnvelope) =>
  head("business-hold/v1", e)
    .u32(e.hold.hold_seq)
    .u8(e.hold.units)
    .u64(e.hold.serve_until_ms)
    .done();

/** The contract's `use_message` preimage for slot 0 and the given fingerprint. */
export const preimageOfUse = (e: SigningEnvelope, fingerprint: string) =>
  head("business-use/v1", e).u32(e.hold.hold_seq).u8(e.use.slot).bytes32(fingerprint).done();

const fingerprintPreimage = (e: SigningEnvelope, inputSha: string) =>
  new Enc()
    .str("customer-use-fingerprint/v1")
    .str(e.network)
    .str(e.business_account)
    .u32(e.plan_id)
    .str(e.customer_account)
    .u64(e.reg_id)
    .u8(e.key_slot)
    .u32(e.key_epoch)
    .u32(e.hold.hold_seq)
    .u8(e.use.slot)
    .str(e.request_id)
    .str(e.offer_id)
    .str(e.release_id)
    .bytes32(e.artifact_digest)
    .bytes32(inputSha)
    .bytes32(e.commitment.salt_hex)
    .done();

async function envelopeDigest(e: SigningEnvelope) {
  const x = new Enc()
    .str(e.version)
    .str(e.request_id)
    .str(e.offer_id)
    .str(e.release_id)
    .bytes32(e.artifact_digest)
    .str(e.network)
    .str(e.business_account)
    .u32(e.plan_id)
    .str(e.customer_account)
    .u64(e.reg_id)
    .u8(e.key_slot)
    .u32(e.key_epoch)
    .bytes32(e.public_key)
    .u32(e.hold.hold_seq)
    .u8(e.hold.units)
    .u64(e.hold.serve_until_ms)
    .str(e.hold.preimage_hex)
    .bytes32(e.hold.message_hex)
    .u8(e.use.slot)
    .bytes32(e.use.fingerprint_hex)
    .str(e.use.preimage_hex)
    .bytes32(e.use.message_hex)
    .bytes32(e.commitment.input_sha256)
    .bytes32(e.commitment.salt_hex)
    .str(e.commitment.fingerprint_preimage_hex)
    .u128(e.consent.unit_price)
    .str(e.consent.asset)
    .u8(e.consent.units)
    .u16(e.consent.retention_days)
    .u64(e.consent.sign_by_ms)
    .u64(e.consent.accept_by_ms)
    .done();
  return sha256Hex(x);
}

/** What the customer expects this envelope to be for, from their own side of the page. */
export interface Expected {
  /** The exact document the customer typed and is about to authorize. */
  input: string;
  offerId: string;
  network: string;
  contract: string;
  unitPrice: string;
  asset: string;
  retentionDays: number;
  /** The authorizer's own public key (hex), when it can say. */
  publicKey: string | null;
  now: number;
}

export type Check = { ok: true } | { ok: false; problem: string };

/**
 * Recomputes everything the customer is about to authorize. Any difference, any malformed value
 * or an expired signing time: not ok, with a plain reason, and nothing is signed.
 */
export async function verifyEnvelope(e: SigningEnvelope, x: Expected): Promise<Check> {
  const bad = (problem: string): Check => ({ ok: false, problem });
  try {
    if (e.version !== "customer-sign-envelope/v1")
      return bad("This kind of request isn't one we can check.");
    if (e.offer_id !== x.offerId) return bad("This request is for a different product offer.");
    if (e.network !== x.network || e.business_account !== x.contract)
      return bad("This request names a different business account or network.");
    if (e.hold.units !== 1 || e.consent.units !== 1 || e.use.slot !== 0)
      return bad("This request isn't for exactly one use.");
    if (e.consent.unit_price !== x.unitPrice || e.consent.asset !== x.asset)
      return bad("The price in this request differs from the product's.");
    if (e.consent.retention_days !== x.retentionDays)
      return bad("The result retention in this request differs from the product's.");
    if (x.publicKey !== null && e.public_key !== x.publicKey)
      return bad("This request names a key that isn't yours.");
    if (BigInt(e.consent.sign_by_ms) <= BigInt(x.now))
      return bad("The time to authorize this request has passed.");
    const inputSha = await sha256Hex(x.input);
    if (inputSha !== e.commitment.input_sha256)
      return bad("This request isn't for the document in front of you.");
    const fpPre = fingerprintPreimage(e, inputSha);
    if (toHex(fpPre) !== e.commitment.fingerprint_preimage_hex)
      return bad("The use's fingerprint doesn't match its details.");
    const fp = await sha256Hex(fpPre);
    if (fp !== e.use.fingerprint_hex)
      return bad("The use's fingerprint doesn't match its details.");
    const hold = preimageOfHold(e);
    if (toHex(hold) !== e.hold.preimage_hex || (await sha256Hex(hold)) !== e.hold.message_hex)
      return bad("The reservation's signed bytes don't match its details.");
    const use = preimageOfUse(e, fp);
    if (toHex(use) !== e.use.preimage_hex || (await sha256Hex(use)) !== e.use.message_hex)
      return bad("The use's signed bytes don't match its details.");
    if ((await envelopeDigest(e)) !== e.envelope_digest)
      return bad("The request's summary doesn't match its details.");
    return { ok: true };
  } catch {
    return bad("This request isn't in the expected form.");
  }
}
