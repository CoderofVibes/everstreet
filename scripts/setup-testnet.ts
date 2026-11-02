// Creates the demo's testnet accounts under the platform root and deploys the business
// contract born locked: one transaction creates the account, funds it, deploys the wasm and
// calls `new`, and never adds a key. Nobody, including the root, can ever sign for it.
//
//   npm run setup:testnet   (idempotent; needs the root's key in ~/.near-credentials)
//
// Each later contract change needs a new business account (BUSINESS=openseat-v2 …), which is
// the point: the code people agreed to cannot change under them.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { baseEncode } from "near-api-js";
import {
  account,
  actions,
  CONFIG_PATH,
  EXPLORER,
  exists,
  KeyPair,
  nearToYocto,
  provider,
  ROOT,
  RPC,
  readConfig,
  readWasm,
  saveKey,
  type TestnetConfig,
  teraToGas,
} from "./lib/near.ts";

const BUSINESS = `${process.env.BUSINESS ?? "openseat"}.${ROOT}`;
const people = {
  issuer: `issuer.${ROOT}`,
  founder: `founder.${ROOT}`,
  buyer: `northline.${ROOT}`,
  workerA: `worker-a.${ROOT}`,
  workerB: `worker-b.${ROOT}`,
};

const root = account(ROOT);
for (const id of Object.values(people)) {
  if (await exists(id)) {
    console.log(`✓ ${id} exists`);
    continue;
  }
  const key = KeyPair.fromRandom("ed25519");
  saveKey(id, key);
  await root.createSubAccount({
    accountOrPrefix: id,
    publicKey: key.getPublicKey(),
    nearToTransfer: nearToYocto("0.3"),
  });
  console.log(`+ ${id} created`);
}

const wasm = readWasm();
const sha = createHash("sha256").update(wasm).digest();
const codeHash = baseEncode(sha);
let deployTx = existsSync(CONFIG_PATH) ? readConfig().deployTx : "";
if (await exists(BUSINESS)) {
  console.log(`✓ ${BUSINESS} exists`);
} else {
  const response = await root.signAndSendTransaction({
    receiverId: BUSINESS,
    actions: [
      actions.createAccount(),
      actions.transfer(nearToYocto("2.6")),
      actions.deployContract(wasm),
      actions.functionCall(
        "new",
        { name: "openseat", owner: people.founder, issuer: people.issuer },
        teraToGas(30),
        0n,
      ),
    ],
    waitUntil: "FINAL",
  });
  deployTx = response.transaction.hash;
  console.log(`+ ${BUSINESS} deployed locked: ${EXPLORER}${deployTx}`);
}

const onChain = await provider.viewAccount({
  accountId: BUSINESS,
  blockQuery: { finality: "final" },
});
if (onChain.code_hash !== codeHash) {
  console.log(`! on-chain code ${onChain.code_hash} differs from the local build ${codeHash}`);
}

const config: TestnetConfig = {
  network: "testnet",
  rpc: RPC,
  root: ROOT,
  business: BUSINESS,
  ...people,
  wasmSha256Hex: sha.toString("hex"),
  codeHash: onChain.code_hash,
  deployTx,
  deployedAt: new Date().toISOString(),
};
mkdirSync("config", { recursive: true });
writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Wrote ${CONFIG_PATH}`);
