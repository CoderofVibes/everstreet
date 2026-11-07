// Writes the light-client proof of a recorded sale's close (data/evidence/light-client-close.json):
// the closing transaction (the seller's accept that closed the sale) and the business contract's
// closing receipt, each with NEAR's EXPERIMENTAL_light_client_proof against the current final
// head. Checked before it is written; scripts/verify-light-client.ts checks it again (offline, or
// with --live against fresh proofs). Read-only, no keys.
//   npx tsx scripts/light-client-close.ts data/evidence/v3-direct-testnet.json

import { readFileSync, writeFileSync } from "node:fs";
import { verifyLightClientProof } from "../server/src/lightClient.ts";

// biome-ignore lint/suspicious/noExplicitAny: RPC JSON, read field by field
type Json = Record<string, any>;
const recordPath = process.argv[2];
if (!recordPath) {
  console.error("usage: light-client-close.ts <rehearsal record.json>");
  process.exit(2);
}
const RPC = process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com";
const OUT = "data/evidence/light-client-close.json";
const rpc = async (method: string, params: unknown) => {
  const res = (await (
    await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    })
  ).json()) as { result?: Json; error?: unknown };
  if (!res.result) throw new Error(`${method}: ${JSON.stringify(res.error).slice(0, 300)}`);
  return res.result;
};

const record = JSON.parse(readFileSync(recordPath, "utf8")) as Json;
const contract = record.header.contract.account as string;
const close = (record.steps as Json[]).find(
  (s) =>
    s.kind === "transaction" &&
    s.call?.method === "accept_sale" &&
    s.app?.resolution?.result === "closed" &&
    s.chain?.succeeded === true,
);
if (!close) throw new Error("the record has no closing accept_sale");
const hash = close.chain.hash as string;
const sender = close.signer.account as string;

const status = await rpc("EXPERIMENTAL_tx_status", {
  tx_hash: hash,
  sender_account_id: sender,
  wait_until: "FINAL",
});
const closed = Buffer.from('"closed"').toString("base64");
const receiptOutcome = (status.receipts_outcome as Json[]).find(
  (o) =>
    o.outcome.executor_id === contract &&
    o.outcome.status?.SuccessValue === closed &&
    (o.outcome.logs as string[]).some((l) => l.includes('"event":"sale_finalized"')),
);
if (!receiptOutcome) throw new Error('no receipt of this contract returned "closed"');

const final = (await rpc("block", { finality: "final" })).header as Json;
const head = {
  hash: String(final.hash),
  height: Number(final.height),
  block_merkle_root: String(final.block_merkle_root),
};
const txProof = await rpc("EXPERIMENTAL_light_client_proof", {
  type: "transaction",
  transaction_hash: hash,
  sender_id: sender,
  light_client_head: head.hash,
});
const receiptProof = await rpc("EXPERIMENTAL_light_client_proof", {
  type: "receipt",
  receipt_id: receiptOutcome.id,
  receiver_id: contract,
  light_client_head: head.hash,
});
const a = verifyLightClientProof(txProof, head);
const b = verifyLightClientProof(receiptProof, head);
if (!a.ok || !b.ok)
  throw new Error(`the proofs don't check: ${[...a.problems, ...b.problems].join("; ")}`);

writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      format: "everstreet.light-client-close",
      version: 1,
      network: "testnet",
      rpc: RPC,
      fetched_on: new Date().toISOString().slice(0, 10),
      record: recordPath.replaceAll("\\", "/"),
      contract,
      transaction: { hash, sender, proof: txProof },
      receipt: { id: receiptOutcome.id, receiver: contract, proof: receiptProof },
      head,
    },
    null,
    2,
  )}\n`,
);
console.log(`OK: ${OUT}`);
console.log(`  transaction ${hash} and closing receipt ${receiptOutcome.id}`);
console.log(`  in block ${b.block.height}, proved against head ${head.hash} at ${head.height}`);
