// Offline check of a business-v3 testnet rehearsal record (data/evidence/v3-*-testnet.json): its
// digests match its contents and it holds no key or token material. No network. What it can't
// establish: that the chain still shows this (open the explorer links, or read the contract), or
// who produced the file (it isn't signed).
//   npx tsx scripts/verify-rehearsal.ts data/evidence/v3-direct-testnet.json

import { readFileSync } from "node:fs";
import { verifyRehearsal } from "./lib/rehearsal/evidence.ts";

const path = process.argv[2];
if (!path) {
  console.error("usage: verify-rehearsal.ts <record.json>");
  process.exit(2);
}
const raw = readFileSync(path, "utf8");
const v = verifyRehearsal(raw);
const r = JSON.parse(raw) as {
  header: { example: string; label: string; commit: string; contract: Record<string, string> };
  outcome: { completed: boolean };
  checkpoints: { name: string; views: { block?: { height: string } } }[];
  steps: { kind: string; chain?: { explorer: string | null } }[];
};
console.log(`${v.ok ? "OK" : "FAILED"}: ${path}`);
for (const p of v.problems) console.log(`  problem: ${p}`);
console.log(
  `  example ${r.header.example} · ${r.header.label} · commit ${r.header.commit.slice(0, 12)}`,
);
console.log(
  `  contract ${r.header.contract.account} · expected code hash ${r.header.contract.code_hash_expected}`,
);
console.log(`  completed: ${r.outcome.completed}`);
console.log(
  `  ${r.checkpoints.length} checkpoints at final blocks; ${r.steps.filter((s) => s.kind === "transaction").length} signed transactions`,
);
for (const s of r.steps) if (s.chain?.explorer) console.log(`    ${s.chain.explorer}`);
process.exit(v.ok ? 0 : 1);
