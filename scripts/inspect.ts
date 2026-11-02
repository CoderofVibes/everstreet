// Who can still change the business contract's rules? Lists the contract account's access
// keys (expected: none), compares its code hash with the local build, and prints control and
// the treasury. Reads only. Exit 1 if any key remains (docs/AUTHORITY.md).
//
//   npm run inspect            human-readable
//   npm run inspect -- --json

import { createHash } from "node:crypto";
import { baseEncode } from "near-api-js";
import { provider, readConfig, readWasm, view } from "./lib/near.ts";

const config = readConfig();
const keys = await provider.viewAccessKeyList({
  accountId: config.business,
  finalityQuery: { finality: "final" },
});
const onChain = await provider.viewAccount({
  accountId: config.business,
  blockQuery: { finality: "final" },
});
let localCodeHash: string | null = null;
try {
  localCodeHash = baseEncode(createHash("sha256").update(readWasm()).digest());
} catch {
  // No WSL build on this machine; compare with the recorded hash only.
}
const control = await view<Record<string, unknown>>(config.business, "get_control");
const settings = await view<Record<string, unknown>>(config.business, "get_config");
const treasury = await view<Record<string, string>>(config.business, "get_treasury");

const report = {
  business: config.business,
  network: "testnet",
  access_keys: keys.keys.map((k) => ({
    public_key: k.public_key,
    permission: k.access_key.permission,
  })),
  code_hash: onChain.code_hash,
  recorded_code_hash: config.codeHash,
  local_build_code_hash: localCodeHash,
  upgradable: settings.upgradable,
  issuer: settings.issuer,
  control,
  treasury,
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report));
} else {
  const mark = (ok: boolean) => (ok ? "✓" : "✗");
  console.log(`Business contract ${config.business} (testnet)`);
  console.log(
    `${mark(report.access_keys.length === 0)} access keys on the contract account: ${report.access_keys.length}` +
      (report.access_keys.length ? "  ← someone can still redeploy or rotate keys" : ""),
  );
  console.log(
    `${mark(onChain.code_hash === config.codeHash)} code hash ${onChain.code_hash} (recorded at deploy)` +
      (localCodeHash
        ? `; local build ${localCodeHash === onChain.code_hash ? "matches" : `differs: ${localCodeHash}`}`
        : ""),
  );
  console.log(`  no upgrade method: upgradable = ${report.upgradable}`);
  console.log(`  issuer ${report.issuer} may mint demo credits, never into the business treasury`);
  console.log(`  owner ${control.owner}, generation ${control.generation}`);
  console.log(
    `  treasury ${treasury.treasury}, reserved ${treasury.reserved}, available ${treasury.available} demo credits`,
  );
}
process.exit(report.access_keys.length === 0 ? 0 : 1);
