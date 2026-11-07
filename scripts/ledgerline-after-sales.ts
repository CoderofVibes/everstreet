// A read-only snapshot of the Ledgerline example on NEAR testnet after all of its recorded sales:
// who owns it now and the first customer's units, at one final block. No transaction, no key, no
// spend. The runs that sold it on (series 3's intents-funded sale, series 4) didn't read that
// customer, so this is the record that shows the customer's units after them.
//
//   npx tsx scripts/ledgerline-after-sales.ts
//   npx tsx scripts/verify-rehearsal.ts data/evidence/ledgerline-after-sales-testnet.json --live

import { execFileSync } from "node:child_process";
import { provider, ROOT, view } from "./lib/near.ts";
import { Recorder } from "./lib/rehearsal/evidence.ts";
import type { Json } from "./lib/rehearsal/journey.ts";

const BIZ = `ledgerline-v3-3b.${ROOT}`;
const CUSTOMER = `cara-v3s3-1.${ROOT}`;
const OUT = "data/evidence/ledgerline-after-sales-testnet.json";

const control = await view<Json>(BIZ, "get_control");
const rec = new Recorder({
  example: "ledgerline-after-sales",
  network: "testnet",
  label: "NEAR testnet",
  commit: execFileSync("git", ["rev-parse", "HEAD"]).toString().trim(),
  contract: {
    account: BIZ,
    wasm_sha256: "ede1c2f7bed77d1832f5b16e8a873645b387693a486b42a745a06b6d510a29b4",
    code_hash_expected: "H1bHmRMXLKb6BY7UXH4fEzPyQ5vs5FMoXhA9Z3tMTUvw",
  },
  accounts: { customer: CUSTOMER, owner_now: String(control.owner) },
  model: "none (a read-only snapshot)",
});
// One final block for every view: the block is read first and each view asks for that height.
const block = (await provider.viewBlock({ finality: "final" } as never)) as Json;
const height = Number(block.header.height);
const at = async (method: string, args: Json) => {
  const r = (await provider.query({
    request_type: "call_function",
    account_id: BIZ,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    block_id: height,
  } as never)) as unknown as { result: number[] };
  return JSON.parse(Buffer.from(r.result).toString("utf8")) as Json;
};
await rec.checkpoint("after_third_sale", {
  block: { height: String(height), hash: block.header.hash },
  control: await at("get_control", {}),
  entitlement: await at("get_entitlement", { customer: CUSTOMER, plan_id: 1 }),
});
rec.write(OUT, { completed: true });
console.log(`snapshot at block ${height}: ${OUT}`);
