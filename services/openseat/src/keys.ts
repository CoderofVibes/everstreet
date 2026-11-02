// NEAR ed25519 keys ("ed25519:<base58>") with node:crypto, so OpenSeat can verify operator
// signatures without a NEAR SDK. A secret key is 64 bytes (seed then public key).

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

export function base58Decode(text: string): Uint8Array {
  let n = 0n;
  for (const ch of text) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error(`not base58: ${ch}`);
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const ch of text) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

function stripCurve(key: string): Uint8Array {
  if (!key.startsWith("ed25519:")) throw new Error("only ed25519 keys are supported");
  return base58Decode(key.slice("ed25519:".length));
}

export function publicKeyOf(secretKey: string): string {
  const raw = stripCurve(secretKey);
  if (raw.length !== 64) throw new Error("an ed25519 secret key is 64 bytes");
  return `ed25519:${base58Encode(raw.subarray(32))}`;
}

export function signBytes(secretKey: string, message: Uint8Array): string {
  const raw = stripCurve(secretKey);
  const key = createPrivateKey({
    key: {
      kty: "OKP",
      crv: "Ed25519",
      d: b64url(raw.subarray(0, 32)),
      x: b64url(raw.subarray(32)),
    },
    format: "jwk",
  });
  return sign(null, message, key).toString("base64");
}

export function verifyBytes(publicKey: string, message: Uint8Array, signature: string): boolean {
  const raw = stripCurve(publicKey);
  if (raw.length !== 32) return false;
  const key = createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: b64url(raw) },
    format: "jwk",
  });
  try {
    return verify(null, message, key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

/** A fresh key pair in NEAR's string format (tests and local identities). */
export function generateKey(): { secretKey: string; publicKey: string } {
  const { privateKey } = generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" });
  const seed = Buffer.from(jwk.d ?? "", "base64url");
  const pub = Buffer.from(jwk.x ?? "", "base64url");
  const secretKey = `ed25519:${base58Encode(Buffer.concat([seed, pub]))}`;
  return { secretKey, publicKey: `ed25519:${base58Encode(pub)}` };
}
