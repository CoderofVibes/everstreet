// Creates a TEST-ONLY Sepolia key for deploying the synthetic feed registry in a testnet run, in
// .evm-credentials/ (git-ignored), and prints only its address. Never overwrites a key. Holds
// faucet test ETH only; it is never a real-funds key.
//   npx tsx scripts/evm-test-key.ts [name]     # default name: sepolia-deployer

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

const name = process.argv[2] ?? "sepolia-deployer";
if (!/^[a-z0-9-]{1,40}$/.test(name)) throw new Error("name: lowercase letters, digits, dashes");
const dir = ".evm-credentials";
const path = `${dir}/${name}.json`;

/** EIP-55 checksummed address of an uncompressed public key. */
function addressOf(pub: Uint8Array) {
  const raw = Buffer.from(keccak_256(pub.slice(1)))
    .subarray(-20)
    .toString("hex");
  const h = Buffer.from(keccak_256(Buffer.from(raw))).toString("hex");
  return `0x${[...raw].map((c, i) => (Number.parseInt(h[i] as string, 16) >= 8 ? c.toUpperCase() : c)).join("")}`;
}

if (existsSync(path)) {
  console.log((JSON.parse(readFileSync(path, "utf8")) as { address: string }).address);
} else {
  mkdirSync(dir, { recursive: true });
  const sk = secp256k1.utils.randomSecretKey();
  const address = addressOf(secp256k1.getPublicKey(sk, false));
  writeFileSync(
    path,
    JSON.stringify(
      {
        network: "sepolia",
        purpose: "test-only deployer for the synthetic feed registry",
        address,
        secret_key: Buffer.from(sk).toString("hex"),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(address);
}
