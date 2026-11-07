// Checks a handoff receipt (the Download handoff receipt button on a sale's proof page).
// Offline: its format and that its digest matches its contents (it isn't signed, so this shows the
// file wasn't changed after export, not who exported it). With --live, for a testnet receipt it
// reads public NEAR testnet (read-only, no keys): the close is in the contract's outcomes with
// the same terms digest, generation, seller and buyer; the close transaction's final outcome; the
// code hash and that the account has no access keys; and who owns it now.
//   npx tsx scripts/verify-receipt.ts handoff-receipt-deal-1.json [--live]

import { readFileSync } from "node:fs";
import { receiptDigestOk } from "../server/src/handoffProof.ts";

const path = process.argv.slice(2).find((a) => !a.startsWith("--"));
const live = process.argv.includes("--live");
if (!path) {
  console.error("usage: verify-receipt.ts <receipt.json> [--live]");
  process.exit(2);
}
const r = JSON.parse(readFileSync(path, "utf8")) as {
  format: string;
  version: number;
  network: string;
  contract: string;
  source: string;
  read_at: { height: string; hash: string };
  deal: { seq: string; digest: string; seller: string; buyer: string; generation_after: number };
  control: { owner: string | null; generation: number | null };
  account: { code_hash: string | null; access_keys: number | null };
  close_tx: string | null;
  close_signer: string | null;
  agreement: { status: string };
  digest: string;
};
const problems: string[] = [];
if (r.format !== "everstreet.handoff-receipt" || r.version !== 1)
  problems.push("not an Everstreet handoff receipt, version 1");
if (!receiptDigestOk(r as unknown as Record<string, unknown>))
  problems.push("the digest doesn't match the contents (changed after export)");
console.log(`${problems.length === 0 ? "OK" : "FAILED"}: ${path}`);
for (const p of problems) console.log(`  problem: ${p}`);
console.log(
  `  ${r.network} · ${r.contract} · deal ${r.deal.seq} · ${r.deal.seller} → ${r.deal.buyer} · generation ${r.deal.generation_after}`,
);
console.log(
  `  read at block ${r.read_at.height} · source ${r.source} · providers ${r.agreement.status}`,
);
if (r.source === "synthetic")
  console.log("  This receipt is from the synthetic demo chain: there is nothing on NEAR to read.");

let liveOk = true;
if (live && r.network === "testnet" && r.source !== "synthetic") {
  const RPC = process.env.NEAR_RPC ?? "https://rpc.testnet.near.org";
  const rpc = async (method: string, params: unknown) => {
    const res = (await (
      await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      })
    ).json()) as { result?: Record<string, unknown>; error?: unknown };
    if (!res.result) throw new Error(`${RPC}: ${JSON.stringify(res.error).slice(0, 200)}`);
    return res.result;
  };
  const call = async (m: string) =>
    JSON.parse(
      Buffer.from(
        (
          await rpc("query", {
            request_type: "call_function",
            finality: "final",
            account_id: r.contract,
            method_name: m,
            args_base64: Buffer.from("{}").toString("base64"),
          })
        ).result as number[],
      ).toString(),
    );
  const check = (ok: boolean, what: string) => {
    if (!ok) liveOk = false;
    console.log(`  ${ok ? "matches" : "DIFFERS"}: ${what}`);
  };
  console.log(`Live on NEAR testnet (${RPC}, final):`);
  const outcomes = (await call("get_outcomes")) as {
    seq: string;
    status: string;
    digest: string;
    seller: string;
    buyer: string;
    generation_after: number;
  }[];
  const o = outcomes.find((x) => String(x.seq) === r.deal.seq);
  check(
    !!o &&
      o.status === "closed" &&
      o.digest === r.deal.digest &&
      o.seller === r.deal.seller &&
      o.buyer === r.deal.buyer &&
      o.generation_after === r.deal.generation_after,
    `deal ${r.deal.seq} closed on these terms (digest, seller, buyer, generation)`,
  );
  if (r.close_tx) {
    const tx = await rpc("tx", {
      tx_hash: r.close_tx,
      sender_account_id: r.close_signer ?? r.deal.buyer,
      wait_until: "FINAL",
    }).catch(() => null);
    const status = (tx?.status ?? {}) as Record<string, unknown>;
    check(tx !== null && "SuccessValue" in status, `close transaction ${r.close_tx} succeeded`);
  }
  const acc = await rpc("query", {
    request_type: "view_account",
    finality: "final",
    account_id: r.contract,
  });
  check(acc.code_hash === r.account.code_hash, `code hash ${acc.code_hash}`);
  const keys = (
    (await rpc("query", {
      request_type: "view_access_key_list",
      finality: "final",
      account_id: r.contract,
    })) as { keys: unknown[] }
  ).keys.length;
  check(keys === 0, `${keys} access keys (nobody can redeploy the code or take the account)`);
  const control = (await call("get_control")) as { owner: string; generation: number };
  console.log(
    `  now: ${control.owner} owns it at generation ${control.generation}${control.owner === r.control.owner ? " (as the receipt shows)" : " (changed since the receipt)"}`,
  );
}
process.exit(problems.length === 0 && liveOk ? 0 : 1);
