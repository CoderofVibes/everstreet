// Publishes the v2 business contract as shared (global) code, by hash, so every business
// account runs exactly that code and nobody can change it; creates the test-dollar token from
// NEAR's standard shared token code (also by hash, born with no keys). Idempotent.
//
//   npm run setup:v2   (needs everstreet.testnet's key; build the wasm first, see README)
//
// Cost: shared code burns 10 NEAR per 100 KB once; each business that uses it then needs only
// a few bytes. On testnet these are test tokens with no value.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { baseDecode, baseEncode } from "near-api-js";
import {
  account,
  actions,
  CONFIG_PATH,
  EXPLORER,
  exists,
  nearToYocto,
  provider,
  ROOT,
  teraToGas,
} from "./lib/near.ts";

const FT_GLOBAL_HASH = "3vaopJ7aRoivvzZLngPQRBEd8VJr2zPLTxQfnRCoFgNX"; // NEAR's standard FT, testnet
const TOKEN = `tusd.${ROOT}`;
const DECIMALS = 6;

function readV2Wasm() {
  return execFileSync(
    "wsl",
    [
      "-d",
      process.env.WSL_DISTRO ?? "Ubuntu",
      "--",
      "bash",
      "-c",
      "cat ~/everstreet-target/near/business_v2/business_v2.wasm",
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
}

async function globalCodeExists(codeHash: string) {
  try {
    await provider.query({
      request_type: "view_global_contract_code",
      finality: "final",
      code_hash: codeHash,
    } as never);
    return true;
  } catch {
    return false;
  }
}

const root = account(ROOT);
const wasm = readV2Wasm();
const codeHash = baseEncode(createHash("sha256").update(wasm).digest());
if (await globalCodeExists(codeHash)) {
  console.log(`✓ v2 code ${codeHash} already published`);
} else {
  console.log(
    `Publishing v2 code ${codeHash} (${(wasm.length / 1024).toFixed(0)} KB) as shared code…`,
  );
  const r = await root.signAndSendTransaction({
    receiverId: ROOT,
    actions: [actions.deployGlobalContract(new Uint8Array(wasm), "codeHash")],
    waitUntil: "FINAL",
  });
  console.log(`+ published: ${EXPLORER}${r.transaction.hash}`);
}

if (await exists(TOKEN)) {
  console.log(`✓ ${TOKEN} exists`);
} else {
  const r = await root.signAndSendTransaction({
    receiverId: TOKEN,
    actions: [
      actions.createAccount(),
      actions.transfer(nearToYocto("0.5")),
      // biome-ignore lint/correctness/useHookAtTopLevel: a NEAR transaction action, not a React hook
      actions.useGlobalContract({ codeHash: baseDecode(FT_GLOBAL_HASH) }),
      actions.functionCall(
        "new",
        {
          owner_id: ROOT,
          total_supply: (10_000_000n * 10n ** BigInt(DECIMALS)).toString(),
          metadata: {
            spec: "ft-1.0.0",
            name: "Test Dollar (testnet, no value)",
            symbol: "tUSD",
            decimals: DECIMALS,
          },
        },
        teraToGas(50),
        0n,
      ),
    ],
    waitUntil: "FINAL",
  });
  console.log(`+ ${TOKEN} created, no keys: ${EXPLORER}${r.transaction.hash}`);
}

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
Object.assign(config, {
  v2CodeHash: codeHash,
  token: TOKEN,
  tokenDecimals: DECIMALS,
  ftGlobalHash: FT_GLOBAL_HASH,
});
writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Wrote ${CONFIG_PATH}`);
