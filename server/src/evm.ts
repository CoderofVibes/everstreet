// The external asset's EVM side: the exact transactions the asset-key companion signs
// (contracts/asset-key, built there and here identically), assembling a signed transaction from
// the MPC signer's answer, and recovering who signed one. No keys live here.

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

export type AssetAction =
  | { kind: "publish"; digest: string }
  | { kind: "set_controller"; to: string; from_generation: number };

export interface TxParams {
  nonce: string;
  gas_limit: string;
  max_fee_per_gas: string;
  max_priority_fee_per_gas: string;
}

/** The signer's answer (NEAR MPC `sign` response shape). */
export interface MpcSignature {
  scheme?: string;
  big_r: { affine_point: string };
  s: { scalar: string };
  recovery_id: number;
}

const hexToBytes = (h: string) => {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  if (!/^([0-9a-fA-F]{2})*$/.test(s)) throw new Error("not hex");
  return Uint8Array.from(Buffer.from(s, "hex"));
};
export const toHex = (b: Uint8Array) => `0x${Buffer.from(b).toString("hex")}`;

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
};

const beMin = (v: bigint) => {
  if (v === 0n) return new Uint8Array();
  let h = v.toString(16);
  if (h.length % 2) h = `0${h}`;
  return hexToBytes(h);
};

const rlpBytes = (b: Uint8Array) => {
  if (b.length === 1 && (b[0] as number) < 0x80) return b;
  if (b.length < 56) return concat(Uint8Array.of(0x80 + b.length), b);
  const len = beMin(BigInt(b.length));
  return concat(Uint8Array.of(0xb7 + len.length), len, b);
};
const rlpList = (body: Uint8Array) => {
  if (body.length < 56) return concat(Uint8Array.of(0xc0 + body.length), body);
  const len = beMin(BigInt(body.length));
  return concat(Uint8Array.of(0xf7 + len.length), len, body);
};
const rlpUint = (v: bigint) => rlpBytes(beMin(v));

const selector = (sig: string) => keccak_256(new TextEncoder().encode(sig)).slice(0, 4);

export function callData(a: AssetAction): Uint8Array {
  if (a.kind === "publish") {
    const d = hexToBytes(a.digest);
    if (d.length !== 32) throw new Error("the digest is 32 bytes");
    return concat(selector("publish(bytes32)"), d);
  }
  const to = hexToBytes(a.to);
  if (to.length !== 20) throw new Error("an address is 20 bytes");
  return concat(selector("setController(address)"), new Uint8Array(12), to);
}

function fields(chainId: bigint, registry: string, tx: TxParams, data: Uint8Array) {
  const to = hexToBytes(registry);
  if (to.length !== 20) throw new Error("the registry is a 20-byte address");
  return [
    rlpUint(chainId),
    rlpUint(BigInt(tx.nonce)),
    rlpUint(BigInt(tx.max_priority_fee_per_gas)),
    rlpUint(BigInt(tx.max_fee_per_gas)),
    rlpUint(BigInt(tx.gas_limit)),
    rlpBytes(to),
    rlpUint(0n),
    rlpBytes(data),
    rlpList(new Uint8Array()),
  ];
}

/** 0x02 || rlp([...]) without the signature: what the contract hashes for the signer. */
export function unsignedTx(chainId: bigint, registry: string, tx: TxParams, a: AssetAction) {
  return concat(
    Uint8Array.of(0x02),
    rlpList(concat(...fields(chainId, registry, tx, callData(a)))),
  );
}

export const payloadOf = (unsigned: Uint8Array) => keccak_256(unsigned);

/** The broadcastable transaction: the same fields plus y_parity, r and s. */
export function signedTx(
  chainId: bigint,
  registry: string,
  tx: TxParams,
  a: AssetAction,
  sig: MpcSignature,
) {
  const r = hexToBytes(sig.big_r.affine_point).slice(1); // drop the 02/03 prefix: r is R's x
  const s = hexToBytes(sig.s.scalar);
  const body = concat(
    ...fields(chainId, registry, tx, callData(a)),
    rlpUint(BigInt(sig.recovery_id)),
    rlpBytes(beMin(BigInt(toHex(r)))),
    rlpBytes(beMin(BigInt(toHex(s)))),
  );
  return concat(Uint8Array.of(0x02), rlpList(body));
}

/** The EVM address of an uncompressed or compressed secp256k1 public key. */
export function addressOf(publicKey: Uint8Array): string {
  const point = secp256k1.Point.fromBytes(publicKey).toBytes(false);
  return toHex(keccak_256(point.slice(1)).slice(12));
}

/** Who signed `payload` with this MPC signature (what the registry would see as msg.sender). */
export function signerOf(payload: Uint8Array, sig: MpcSignature): string {
  const r = hexToBytes(sig.big_r.affine_point).slice(1);
  const s = hexToBytes(sig.s.scalar);
  const recovered = concat(Uint8Array.of(sig.recovery_id), r, s);
  const pub = secp256k1.recoverPublicKey(recovered, payload, { prehash: false });
  return addressOf(pub);
}

/** The transaction hash of a signed transaction (keccak of its bytes). */
export const txHashOf = (signed: Uint8Array) => toHex(keccak_256(signed));

/**
 * A derived public key as the signer reports it: the real MPC contract answers
 * "secp256k1:<base58 of 64 bytes>"; the local stand-in answers uncompressed hex.
 */
export function publicKeyFromSigner(answer: string): Uint8Array {
  if (answer.startsWith("secp256k1:")) {
    const raw = base58Decode(answer.slice("secp256k1:".length));
    return concat(Uint8Array.of(0x04), raw);
  }
  return hexToBytes(answer);
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Decode(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error("not base58");
    n = n * 58n + BigInt(i);
  }
  const body = beMin(n);
  const zeros = s.length - s.replace(/^1+/, "").length;
  return concat(new Uint8Array(zeros), body);
}
