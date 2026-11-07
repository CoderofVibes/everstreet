// The app builds exactly the EVM transaction the asset-key contract signs (the same vector as
// contracts/asset-key known_vector), assembles the broadcastable transaction from the signer's
// answer, and recovers who signed it.

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { describe, expect, it } from "vitest";
import {
  addressOf,
  type MpcSignature,
  payloadOf,
  publicKeyFromSigner,
  signedTx,
  signerOf,
  toHex,
  unsignedTx,
} from "../src/evm.ts";

const tx = {
  nonce: "7",
  gas_limit: "80000",
  max_fee_per_gas: "3000000000",
  max_priority_fee_per_gas: "1000000000",
};
const action = { kind: "set_controller" as const, to: `0x${"ab".repeat(20)}`, from_generation: 1 };
const REGISTRY = `0x${"22".repeat(20)}`;

describe("EVM transactions for the external asset", () => {
  it("matches the contract's bytes exactly", () => {
    const u = unsignedTx(11155111n, REGISTRY, tx, action);
    expect(toHex(u)).toBe(
      "0x02f84f83aa36a707843b9aca0084b2d05e008301388094222222222222222222222222222222222222222280a492eefe9b000000000000000000000000ababababababababababababababababababababc0",
    );
    expect(toHex(payloadOf(u))).toBe(
      "0x8ec7b980e5067dac44c20b0d2d7bae57c353c9bfa673cfb86e144581ef86e98e",
    );
  });

  it("assembles the signed transaction and recovers its signer", () => {
    // The local stand-in signer's key derivation (contracts/test-signer), public by design.
    const sk = sha256(new TextEncoder().encode("everstreet-test-signer:asset,gen-1"));
    const expected = addressOf(secp256k1.getPublicKey(sk, false));
    const payload = payloadOf(unsignedTx(11155111n, REGISTRY, tx, action));
    const raw = secp256k1.sign(payload, sk, { prehash: false, format: "recovered" });
    const rec = raw[0] as number;
    const r = raw.slice(1, 33);
    const s = raw.slice(33);
    // What a signer answers: R as a compressed point (prefix by parity), s, recovery id.
    const sig: MpcSignature = {
      big_r: { affine_point: `${rec & 1 ? "03" : "02"}${Buffer.from(r).toString("hex")}` },
      s: { scalar: Buffer.from(s).toString("hex") },
      recovery_id: rec,
    };
    expect(signerOf(payload, sig)).toBe(expected);
    const signed = signedTx(11155111n, REGISTRY, tx, action, sig);
    expect(signed[0]).toBe(0x02);
    expect(signed.length).toBeGreaterThan(80 + 64);
    // The stand-in's uncompressed hex and the real signer's "secp256k1:<base58>" both parse.
    const hexKey = Buffer.from(secp256k1.getPublicKey(sk, false)).toString("hex");
    expect(addressOf(publicKeyFromSigner(hexKey))).toBe(expected);
  });
});
