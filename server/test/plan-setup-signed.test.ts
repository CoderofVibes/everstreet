// Job 003wf4 M-2 (OWNER_PLAN_SETUP.md §10; Astra 06:21): the founder's guarded plan call as a
// SIGNED transaction through the actual decoder (lifecycleWorld.ts SyntheticRpc send_tx: borsh
// decode, ed25519 verification against the sha256 of the exact bytes, block, nonce and access-key
// rules), encoded by production's own encodeTransaction. A synthetic local key signs: no wallet,
// no network, no real NEAR. Applied by the sale double (anchored to the contract's plan-setup.json).

import { createHash, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encodeTransaction } from "../src/customerWriter.ts";
import { base58Decode } from "../src/identity.ts";
import { BUSINESS, FixtureChain, type Json, TOKEN } from "./customer-world.ts";
import { nearKey, SyntheticRpc } from "./lifecycleWorld.ts";
import { PLAN_BYTES } from "./sale-chain.ts";

const FOUNDER = "founder.near";
const PLAN = {
  unit_price: "150000",
  max_units_per_purchase: 20,
  max_units_outstanding: 100,
  max_hold_units: 1,
  hold_ttl_ms: "600000",
  settle_grace_ms: "360000",
};
const QUOTE = PLAN_BYTES * 10_000_000_000_000_000_000n;
const GAS = 30_000_000_000_000n;

function world() {
  const chain = new FixtureChain();
  const sale = chain.attachSale();
  const rpc = new SyntheticRpc(chain);
  const key = nearKey();
  rpc.keys.set(`${FOUNDER}|${key.id}`, 0n);
  let id = 0;
  const rpcCall = async (method: string, params: Json) =>
    JSON.parse(
      await rpc.answer(JSON.stringify({ jsonrpc: "2.0", id: String(++id), method, params })),
    );
  const block = async () =>
    (await rpcCall("block", { finality: "final" })).result.header.hash as string;
  /** borsh(Transaction) || 0 || ed25519(sha256(bytes)): the format production's writer sends. */
  const signed = async (o: {
    signer?: string;
    k?: ReturnType<typeof nearKey>;
    nonce: bigint;
    receiver?: string;
    method?: string;
    args?: Json;
    deposit?: bigint;
    tamper?: boolean;
  }) => {
    const k = o.k ?? key;
    const tx = encodeTransaction({
      signer: o.signer ?? FOUNDER,
      publicKey: k.pub,
      nonce: o.nonce,
      receiver: o.receiver ?? BUSINESS,
      blockHash: base58Decode(await block()),
      method: o.method ?? "create_plan_guarded",
      args: Buffer.from(
        JSON.stringify(o.args ?? { input: PLAN, expected_control_seq: "2", expected_plan_id: 2 }),
      ),
      gas: GAS,
      deposit: o.deposit ?? QUOTE,
    });
    const sig = sign(null, createHash("sha256").update(tx).digest(), k.privateKey);
    if (o.tamper) sig[0] = (sig[0] as number) ^ 0xff;
    return Buffer.concat([tx, Buffer.from([0]), sig]).toString("base64");
  };
  const send = async (b64: string) =>
    rpcCall("send_tx", { signed_tx_base64: b64, wait_until: "FINAL" });
  return { chain, sale, rpc, key, signed, send, rpcCall };
}

const value = (o: Json) =>
  JSON.parse(Buffer.from(String(o.status.SuccessValue), "base64").toString());

describe("003wf4 M-2 the founder's signed plan call through the actual decoder", () => {
  it("decoded, verified and applied once: the receipt returns the reviewed id; its own hash finds it", async () => {
    const w = await world();
    const b64 = await w.signed({ nonce: 1n });
    const r = await w.send(b64);
    expect(r.error, JSON.stringify(r)).toBeUndefined();
    const o = r.result as Json;
    expect(o.status.Failure).toBeUndefined();
    expect(value(o)).toBe(2);
    expect(w.sale.plans.get(2)).toMatchObject({ ...PLAN, created_generation: 1 });
    // The transaction carries exactly the signed action, and its own hash finds it again.
    const fc = o.transaction.actions[0].FunctionCall as Json;
    expect([fc.method_name, fc.deposit, fc.gas]).toEqual([
      "create_plan_guarded",
      String(QUOTE),
      Number(GAS),
    ]);
    expect(JSON.parse(Buffer.from(fc.args, "base64").toString()).expected_plan_id).toBe(2);
    const again = await w.rpcCall("tx", {
      tx_hash: o.transaction.hash,
      sender_account_id: FOUNDER,
    });
    expect(again.result.transaction.hash).toBe(o.transaction.hash);
    // The identical signed bytes again: the same transaction, never a second plan.
    const dup = await w.send(b64);
    expect(dup.result.transaction.hash).toBe(o.transaction.hash);
    expect(w.sale.planCount).toBe(2);
  });

  it("refused as signed transactions: wrong signer or key, receiver, method, deposit, signature, nonce", async () => {
    const w = await world();
    const terms = () => w.chain.answer("get_plan_terms", {});
    const before = terms();
    const stranger = nearKey();
    w.rpc.keys.set(`stranger.near|${stranger.id}`, 0n);
    // Transaction-level refusals: never applied.
    const invalid = async (b64: string) => (await w.send(b64)).error?.cause?.info?.InvalidTxError;
    expect(await invalid(await w.signed({ nonce: 1n, tamper: true }))).toBe("InvalidSignature");
    expect(await invalid(await w.signed({ nonce: 1n, k: stranger }))).toBe("InvalidSignature");
    // Not an owner call the double models: judged by the writer's stricter envelope (its gas and no
    // deposit), so refused before any key or state is used.
    expect(await invalid(await w.signed({ nonce: 1n, receiver: TOKEN }))).toBe(
      "UnsupportedByThisDouble",
    );
    expect(await invalid(await w.signed({ nonce: 1n, method: "create_plan" }))).toBe(
      "UnsupportedByThisDouble",
    );
    // A function-call access key can't attach a deposit (NEAR's own rule).
    const fcKey = nearKey();
    w.rpc.keys.set(`${FOUNDER}|${fcKey.id}`, 0n);
    w.rpc.permissions.set(`${FOUNDER}|${fcKey.id}`, {
      FunctionCall: {
        receiver_id: BUSINESS,
        method_names: ["create_plan_guarded"],
        allowance: null,
      },
    });
    expect(await invalid(await w.signed({ nonce: 1n, k: fcKey }))).toEqual({
      InvalidAccessKeyError: "DepositWithFunctionCall",
    });
    expect(terms()).toBe(before);
    // Contract-level refusals of a valid signed transaction: a failed receipt, nothing changed.
    const failure = async (b64: string) =>
      JSON.stringify((await w.send(b64)).result.status.Failure);
    expect(
      await failure(await w.signed({ signer: "stranger.near", k: stranger, nonce: 1n })),
    ).toContain("E_NOT_OWNER");
    expect(await failure(await w.signed({ nonce: 1n, deposit: QUOTE - 1n }))).toContain(
      "E_STORAGE",
    );
    expect(terms()).toBe(before);
    // The nonce rises only with an applied transaction's own: an old nonce is refused.
    expect((await w.send(await w.signed({ nonce: 2n }))).result.status.Failure).toBeUndefined();
    expect(
      await invalid(
        await w.signed({
          nonce: 2n,
          args: {
            input: { ...PLAN, unit_price: "1" },
            expected_control_seq: "3",
            expected_plan_id: 3,
          },
        }),
      ),
    ).toEqual({
      InvalidNonce: {},
    });
    expect(w.sale.planCount).toBe(2);
  });
});
