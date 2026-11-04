// Job 003l1: the customer-signing fixture (produced by the business-v3 contract's own unit test,
// customer_signing_matches_server_fixture) pins the exact bytes a customer's use-key signs and the
// closed-hold root. These checks show node:crypto verifies what the contract verifies. Synthetic
// test key (seed 1), not a wallet signature; no transport or admission is exercised here.

import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// biome-ignore lint/suspicious/noExplicitAny: fixture JSON
type Json = Record<string, any>;

const here = dirname(fileURLToPath(import.meta.url));
const f = JSON.parse(
  readFileSync(join(here, "fixtures", "v3", "customer-signing.json"), "utf8"),
) as Json;

const hex = (s: string) => Buffer.from(s, "hex");
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest();
const key = createPublicKey({
  key: { kty: "OKP", crv: "Ed25519", x: hex(f.public_key_hex).toString("base64url") },
  format: "jwk",
});
const verifies = (message: Buffer, sig: Buffer) => verify(null, message, key, sig);

describe("003l1 customer signing (contract fixture)", () => {
  it("each preimage hashes to the contract's message, and the key signs that digest", () => {
    for (const part of [f.hold, f.use]) {
      expect(sha256(hex(part.preimage_hex)).toString("hex")).toBe(part.message_hex);
      expect(verifies(hex(part.message_hex), hex(part.signature_hex))).toBe(true);
      // Not the preimage: the signed bytes are the 32-byte digest.
      expect(verifies(hex(part.preimage_hex), hex(part.signature_hex))).toBe(false);
    }
    expect(f.hold.open_hold).toBe("opened");
    expect(f.use.settle_hold).toBe("charged");
  });

  it("a flipped bit in the message or signature fails", () => {
    const m = hex(f.use.message_hex);
    m[0] = (m[0] as number) ^ 1;
    expect(verifies(m, hex(f.use.signature_hex))).toBe(false);
    const s = hex(f.use.signature_hex);
    s[5] = (s[5] as number) ^ 1;
    expect(verifies(hex(f.use.message_hex), s)).toBe(false);
  });

  // `used` maps slot → fingerprint for every set bit, in slot order.
  const entries = (used: Record<string, string>) =>
    Object.entries(used)
      .map(([s, fp]) => [Number(s), fp] as const)
      .sort((a, b) => a[0] - b[0]);
  const rootPreimage = (used: readonly (readonly [number, string])[]) => {
    const count = Buffer.alloc(4);
    count.writeUInt32LE(used.length);
    return Buffer.concat([count, ...used.flatMap(([s, fp]) => [Buffer.from([s]), hex(fp)])]);
  };

  it("a closed root is sha256 over the count and every used slot, in slot order", () => {
    for (const r of [f.closed_root_one, f.closed_root_partial]) {
      const pre = rootPreimage(entries(r.used));
      expect(pre.toString("hex")).toBe(r.preimage_hex);
      expect(sha256(pre).toString("hex")).toBe(r.root_hex);
    }
    expect(entries(f.closed_root_partial.used).map(([s]) => s)).toEqual([0, 2]);
    expect(f.closed_root_partial.used_bitmap).toBe(0b101);
    // Missing one used slot (another request's use, say) gives a different root.
    const missing = rootPreimage(entries(f.closed_root_partial.used).slice(1));
    expect(sha256(missing).toString("hex")).not.toBe(f.closed_root_partial.root_hex);
    expect(entries(f.closed_root_empty.used)).toEqual([]);
    expect(f.closed_root_empty.root_hex).toBe(sha256(rootPreimage([])).toString("hex"));
  });
});
