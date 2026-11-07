// Checks a light-client proof of a sale's close (data/evidence/light-client-close.json): the closing
// transaction's outcome and the business contract's closing receipt (it returned "closed" and
// logged sale_finalized) each prove into their block's outcome root, the block's header hashes to
// that block, and the block proves into a later head's block merkle root. Read-only, no keys.
// What it can't establish: that the head header itself is canonical (its validators' signatures
// aren't checked here); the result is "proved against block header <head>".
//   npx tsx scripts/verify-light-client.ts data/evidence/light-client-close.json [--live]
// --live fetches fresh proofs from public NEAR testnet against the current final block.

import { readFileSync } from "node:fs";
import { verifyLightClientProof } from "../server/src/lightClient.ts";

type Json = Record<string, unknown>;
const path = process.argv.slice(2).find((a) => !a.startsWith("--"));
const live = process.argv.includes("--live");
if (!path) {
  console.error("usage: verify-light-client.ts <evidence.json> [--live]");
  process.exit(2);
}
const ev = JSON.parse(readFileSync(path, "utf8")) as {
  rpc: string;
  contract: string;
  transaction: { hash: string; sender: string; proof: Json };
  receipt: { id: string; receiver: string; proof: Json };
  head: { hash: string; height: number; block_merkle_root: string };
};

const RPC = process.env.NEAR_RPC ?? ev.rpc;
const rpc = async (method: string, params: unknown) => {
  const res = (await (
    await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    })
  ).json()) as { result?: Json; error?: unknown };
  if (!res.result) throw new Error(`${RPC}: ${JSON.stringify(res.error).slice(0, 200)}`);
  return res.result;
};

let tx = ev.transaction.proof;
let receipt = ev.receipt.proof;
let head = ev.head;
if (live) {
  const final = (await rpc("block", { finality: "final" })).header as Json;
  head = {
    hash: String(final.hash),
    height: Number(final.height),
    block_merkle_root: String(final.block_merkle_root),
  };
  tx = await rpc("EXPERIMENTAL_light_client_proof", {
    type: "transaction",
    transaction_hash: ev.transaction.hash,
    sender_id: ev.transaction.sender,
    light_client_head: head.hash,
  });
  receipt = await rpc("EXPERIMENTAL_light_client_proof", {
    type: "receipt",
    receipt_id: ev.receipt.id,
    receiver_id: ev.receipt.receiver,
    light_client_head: head.hash,
  });
}

const a = verifyLightClientProof(tx, head);
const b = verifyLightClientProof(receipt, head);
const outcome = (receipt.outcome_proof as Json).outcome as Json;
const closed =
  outcome.executor_id === ev.contract &&
  JSON.stringify(outcome.status) ===
    JSON.stringify({ SuccessValue: Buffer.from('"closed"').toString("base64") }) &&
  (outcome.logs as string[]).some((l) => l.includes('"event":"sale_finalized"'));
const ok = a.ok && b.ok && closed;
console.log(`${ok ? "OK" : "FAILED"}: ${path}${live ? " (fresh proofs from testnet)" : ""}`);
console.log(`  transaction ${ev.transaction.hash}: ${a.ok ? "proved" : a.problems.join("; ")}`);
console.log(`  closing receipt ${ev.receipt.id}: ${b.ok ? "proved" : b.problems.join("; ")}`);
console.log(
  `  ${closed ? 'the business contract returned "closed" and logged sale_finalized' : "the receipt isn't the close"}`,
);
console.log(`  in block ${b.block.height} (${b.block.hash})`);
console.log(`  proved against block header ${head.hash} at height ${head.height}`);
process.exit(ok ? 0 : 1);
