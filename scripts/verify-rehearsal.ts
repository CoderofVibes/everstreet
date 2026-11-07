// Offline check of a business-v3 testnet rehearsal record (data/evidence/v3-*-testnet.json): its
// digests match its contents and it holds no key or token material. No network. What it can't
// establish: who produced the file (it isn't signed). With --live it also reads the contract on
// public NEAR testnet (read-only, no keys): its code hash, that it has no access keys, its owner
// and generation, and the record's customer's units, next to the record's last checkpoint.
//   npx tsx scripts/verify-rehearsal.ts data/evidence/v3-direct-testnet.json [--live]

import { readFileSync } from "node:fs";
import { verifyRehearsal } from "./lib/rehearsal/evidence.ts";

const path = process.argv.slice(2).find((a) => !a.startsWith("--"));
const live = process.argv.includes("--live");
if (!path) {
  console.error("usage: verify-rehearsal.ts <record.json> [--live]");
  process.exit(2);
}
const raw = readFileSync(path, "utf8");
const v = verifyRehearsal(raw);
const r = JSON.parse(raw) as {
  header: {
    example: string;
    label: string;
    commit: string;
    contract: Record<string, string>;
    accounts?: Record<string, string>;
  };
  outcome: { completed: boolean };
  checkpoints: {
    name: string;
    views: {
      block?: { height: string };
      control?: { owner: string; generation: number };
      entitlement?: { free: string; consumed: string };
    };
  }[];
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

if (live) {
  const RPC = process.env.NEAR_RPC ?? "https://rpc.testnet.near.org";
  const rpc = async (params: Record<string, unknown>) => {
    const res = (await (
      await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params }),
      })
    ).json()) as { result?: Record<string, unknown>; error?: unknown };
    if (!res.result) throw new Error(`${RPC}: ${JSON.stringify(res.error).slice(0, 200)}`);
    return res.result;
  };
  const account = r.header.contract.account;
  const call = async (method: string, args: Record<string, unknown>) =>
    JSON.parse(
      Buffer.from(
        (
          await rpc({
            request_type: "call_function",
            finality: "final",
            account_id: account,
            method_name: method,
            args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
          })
        ).result as number[],
      ).toString(),
    );
  const acc = await rpc({ request_type: "view_account", finality: "final", account_id: account });
  const keys = await rpc({
    request_type: "view_access_key_list",
    finality: "final",
    account_id: account,
  });
  const control = await call("get_control", {});
  const customer = r.header.accounts?.customer;
  const ent = customer ? await call("get_entitlement", { customer, plan_id: 1 }) : null;
  const last = [...r.checkpoints].reverse().find((c) => c.views.control)?.views;
  // Judge rehearsal (Nov 7): the exit code says whether the live facts hold. The code hash, the
  // key count and the customer's units must match the record; the owner may legitimately have
  // changed since (a later sale), which is reported as later history, not a mismatch.
  let liveOk = true;
  const same = (a: unknown, b: unknown) => {
    if (String(a) === String(b)) return "matches";
    liveOk = false;
    return "DIFFERS from";
  };
  console.log(`Live on NEAR testnet (${RPC}, final):`);
  console.log(
    `  code hash ${acc.code_hash} (${same(acc.code_hash, r.header.contract.code_hash_expected)} the record)`,
  );
  const n = (keys.keys as unknown[]).length;
  if (n !== 0) liveOk = false;
  console.log(
    `  access keys: ${n} (${n === 0 ? "nobody can redeploy the code or take the account" : "WARNING: someone holds a key to this account"})`,
  );
  const recordedOwner = last?.control?.owner;
  const recordedGen = last?.control?.generation;
  if (String(control.owner) === String(recordedOwner)) {
    console.log(
      `  owner ${control.owner}, generation ${control.generation} (matches the record's last checkpoint)`,
    );
  } else if (Number(control.generation) > Number(recordedGen ?? 0)) {
    console.log(
      `  owner ${control.owner}, generation ${control.generation}: changed since this record (its last checkpoint shows ${recordedOwner} at generation ${recordedGen}); a later sale moved control, so look for a later record of this business`,
    );
  } else {
    liveOk = false;
    console.log(
      `  owner ${control.owner}, generation ${control.generation} (DIFFERS from the record's last checkpoint ${recordedOwner} at generation ${recordedGen}, and not by a later sale)`,
    );
  }
  if (ent)
    console.log(
      `  customer ${customer}: ${ent.free} unused, ${ent.consumed} used (${same(ent.free, last?.entitlement?.free)} the record)`,
    );
  if (!liveOk) {
    console.log("LIVE CHECK FAILED: the contract on testnet does not match this record.");
    process.exit(1);
  }
}
process.exit(v.ok ? 0 : 1);
