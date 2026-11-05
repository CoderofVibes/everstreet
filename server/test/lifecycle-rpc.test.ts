// Job 003wf1 (Astra's LifecycleRpcEvidenceReview): what the configured-process tests' synthetic RPC
// can and can't establish. Transactions are encoded with the production writer's own
// encodeTransaction and signed with an ephemeral key; only a well-formed FunctionCall to the one
// modelled business, at a block this endpoint issued, with the writer's gas and no deposit, signed
// by a key it vouches for at a fresh nonce, is applied, and then only by the contract's rules.

import { createHash, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { base58Encode, encodeTransaction } from "../src/customerWriter.ts";
import { CUSTOMER, FixtureChain, type Json } from "./customer-world.ts";
import { BIZ, nearKey, OP, SyntheticRpc } from "./lifecycleWorld.ts";

const call = async (rpc: SyntheticRpc, method: string, params: Json) =>
  JSON.parse(await rpc.answer(JSON.stringify({ jsonrpc: "2.0", id: "t", method, params }))) as Json;

async function world() {
  const chain = new FixtureChain();
  chain.business = BIZ;
  chain.control = { ...chain.control, operators: [[OP, 1, chain.control.generation]] };
  const rpc = new SyntheticRpc(chain);
  const op = nearKey();
  rpc.keys.set(`${OP}|${op.id}`, 0n);
  const block = (await call(rpc, "block", { finality: "final" })).result.header;
  let nonce = 0n;
  /** One signed transaction; `over` changes any envelope field, `signer` another key. */
  const tx = (
    over: Partial<Parameters<typeof encodeTransaction>[0]> = {},
    key = op,
    trailing = false,
  ) => {
    const bytes = encodeTransaction({
      signer: OP,
      publicKey: key.pub,
      nonce: ++nonce,
      receiver: BIZ,
      blockHash: Buffer.from(bs58(block.hash)),
      method: "release_hold_for",
      args: Buffer.from(
        JSON.stringify({ customer: CUSTOMER, plan_id: 1, reg_id: "1", hold_seq: 9 }),
      ),
      gas: 100_000_000_000_000n,
      deposit: 0n,
      ...over,
    });
    const sig = sign(null, createHash("sha256").update(bytes).digest(), key.privateKey);
    const signed = Buffer.concat([
      bytes,
      Buffer.from([0]),
      sig,
      trailing ? Buffer.from([7]) : Buffer.alloc(0),
    ]);
    return {
      b64: signed.toString("base64"),
      hash: base58Encode(createHash("sha256").update(bytes).digest()),
    };
  };
  const send = (b64: string) =>
    call(rpc, "send_tx", { signed_tx_base64: b64, wait_until: "FINAL" });
  return { chain, rpc, op, tx, send, block };
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function bs58(s: string) {
  let n = 0n;
  for (const ch of s) n = n * 58n + BigInt(B58.indexOf(ch));
  const hex = n.toString(16).padStart(64, "0");
  return Buffer.from(hex, "hex");
}

describe("003wf1 the synthetic RPC applies only what it can establish", () => {
  it("a well-formed call is applied by the contract's rules (here: refused, E_HOLD_CLOSED, FINAL)", async () => {
    const { rpc, tx, send } = await world();
    const t = tx();
    const r = await send(t.b64);
    expect(r.result.final_execution_status).toBe("FINAL");
    expect(r.result.transaction.hash).toBe(t.hash);
    expect(JSON.stringify(r.result.status)).toContain("E_HOLD_CLOSED");
    // The same signed transaction again is the same transaction, not a second one.
    expect(await send(t.b64)).toEqual(r);
    expect(
      (await call(rpc, "tx", { tx_hash: t.hash, sender_account_id: OP, wait_until: "FINAL" }))
        .result,
    ).toEqual(r.result);
  });

  it("refuses, and never applies: another receiver, an unknown method, a deposit, other gas, an unknown block, another key, trailing or truncated bytes, a reused nonce", async () => {
    const { rpc, tx, send, op } = await world();
    const stranger = nearKey();
    const cases: [string, string][] = [
      ["receiver", tx({ receiver: "unrelated-synthetic.testnet" }).b64],
      ["method", tx({ method: "withdraw_profit" }).b64],
      ["deposit", tx({ deposit: 1n }).b64],
      ["gas", tx({ gas: 30_000_000_000_000n }).b64],
      ["block", tx({ blockHash: Buffer.alloc(32, 9) }).b64],
      ["key", tx({}, stranger).b64],
      ["trailing", tx({}, op, true).b64],
      ["truncated", Buffer.from(tx().b64, "base64").subarray(0, 40).toString("base64")],
    ];
    for (const [what, b64] of cases) {
      const r = await send(b64);
      expect(r.error?.cause?.name, what).toBe("INVALID_TRANSACTION");
    }
    expect(rpc.applied).toEqual([]);
    // A fresh nonce is accepted once; the same nonce in another transaction is refused.
    const first = tx();
    await send(first.b64);
    const again = tx({ nonce: 1n, args: Buffer.from(JSON.stringify({ other: true })) });
    expect((await send(again.b64)).error?.cause?.name).toBe("INVALID_TRANSACTION");
  });

  it("views: only the modelled business, at a block this endpoint issued and still holds", async () => {
    const { rpc, block, chain } = await world();
    const q = (account: string, hash: string) =>
      call(rpc, "query", {
        request_type: "call_function",
        account_id: account,
        block_id: hash,
        method_name: "get_control",
        args_base64: Buffer.from("{}").toString("base64"),
      });
    expect((await q(BIZ, block.hash)).result.result).toBeInstanceOf(Array);
    expect((await q("unrelated-synthetic.testnet", block.hash)).error?.cause?.name).toBe(
      "UNKNOWN_ACCOUNT",
    );
    expect((await q(BIZ, "1".repeat(43))).error?.cause?.name).toBe("UNKNOWN_BLOCK");
    // A block older than the 64 it keeps is refused, not answered with today's state.
    for (let i = 0; i < 70; i++) {
      chain.tick(1n); // a later block
      await call(rpc, "block", { finality: "final" });
    }
    expect((await q(BIZ, block.hash)).error?.cause?.name).toBe("UNKNOWN_BLOCK");
  });
});
