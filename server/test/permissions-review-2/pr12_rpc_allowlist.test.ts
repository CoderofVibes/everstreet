// Promise 10: the RPC allowlist stays an allowlist. Only the fixed views with exact arguments
// reach the endpoint; mainnet is refused.
import { describe, expect, it } from "vitest";
import { V3ReadError } from "../../src/v3read.ts";
import {
  TestnetAccessKeyReader,
  TestnetCustomerRpcTransport,
  TestnetRpcTransport,
  validateRpcConfig,
} from "../../src/v3rpc.ts";

const BLOCK = { height: "1000", hash: "BkhAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB" };

/** A synthetic endpoint: records every request body and answers a fixed, valid envelope. */
function endpoint() {
  const sent: { method: string; params: Record<string, unknown> }[] = [];
  const fetchImpl = async (_url: string, init: { body: string }) => {
    const req = JSON.parse(init.body) as {
      id: string;
      method: string;
      params: Record<string, unknown>;
    };
    sent.push({ method: req.method, params: req.params });
    const result =
      req.method === "block"
        ? { header: { height: 1000, hash: BLOCK.hash, timestamp_nanosec: "1793577600000000000" } }
        : req.method === "query" && req.params.request_type === "view_access_key"
          ? { permission: "FullAccess" }
          : { result: [...Buffer.from('"ok"')], block_height: 1000, block_hash: BLOCK.hash };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { sent, fetchImpl };
}

const config = { network: "testnet", endpoint: "https://synthetic-rpc.example" };

describe("pr12: the RPC allowlist", () => {
  it("refuses a mainnet or credentialed endpoint", () => {
    for (const endpoint of [
      "https://rpc.mainnet.near.org",
      "https://user:pw@rpc.example",
      "http://rpc.example",
      "https://rpc.example/?x=1",
    ])
      expect(() => validateRpcConfig({ network: "testnet", endpoint })).toThrow();
    expect(() =>
      validateRpcConfig({ network: "mainnet", endpoint: "https://rpc.example" }),
    ).toThrow();
  });

  it("the customer transport sends only the fixed views, with exactly their arguments", async () => {
    const { sent, fetchImpl } = endpoint();
    const t = new TestnetCustomerRpcTransport(config, fetchImpl as never);
    const view = (method: string, args: Record<string, unknown>, account = "biz.testnet") =>
      t.view({ network: "testnet", account, method, args, block: BLOCK });
    const refused: [string, Record<string, unknown>][] = [
      ["get_control", { extra: 1 }],
      ["set_owner", {}],
      ["withdraw", {}],
      ["execute_intents", { signed: [] }],
      ["add_public_key", { public_key: "ed25519:11111111111111111111111111111111" }],
      ["ft_transfer", { receiver_id: "x.near", amount: "1" }],
      ["get_party", { account: "not an account" }],
      ["get_party", { account: "a.near", also: 1 }],
      ["get_entitlement", { customer: "a.near", plan_id: -1 }],
      ["get_entitlement", { customer: "a.near", plan_id: 1.5 }],
      ["mt_balance_of", { account_id: "a.near", token_id: "nep245:x.near" }],
      ["mt_balance_of", { account_id: "a.near", token_id: "nep141:" }],
      ["is_nonce_used", { account_id: "a.near", nonce: "short" }],
      ["has_public_key", { account_id: "a.near", public_key: "secp256k1:abc" }],
      ["simulate_intents", { signed: [] }],
      ["simulate_intents", { signed: [{ standard: "erc191" }] }],
      ["simulate_intents", { signed: Array(5).fill({ standard: "nep413" }) }],
      ["simulate_intents", { signed: [{ standard: "nep413", payload: "x".repeat(5000) }] }],
      ["derived_public_key", { path: "gen-0", predecessor: "a.near", domain_id: 0 }],
      ["derived_public_key", { path: "gen-1", predecessor: "a.near", domain_id: 1 }],
      ["derived_public_key", { path: "other", predecessor: "a.near", domain_id: 0 }],
      ["get_payments", { from: 0, limit: 51 }],
      ["get_payments", { from: -1, limit: 1 }],
      ["get_payment", { invoice: "notahash" }],
      ["get_claim", { supplier: "" }],
      ["get_period", { yyyymm: 202613 }],
      ["check_use", { customer: "a.near" }],
      ["view_account", {}],
      ["view_access_key_list", {}],
    ];
    for (const [method, args] of refused) {
      await expect(view(method, args), `${method} ${JSON.stringify(args)}`).rejects.toSatisfy(
        (e: unknown) => e instanceof V3ReadError && e.code === "unsupported",
      );
    }
    expect(sent.filter((s) => s.method !== "block")).toEqual([]);
    // Allowed calls send the normalized arguments only, to the pinned block.
    await view("get_control", {});
    await view("mt_balance_of", { token_id: "nep141:tusd.near", account_id: "a.near" });
    await view("simulate_intents", { signed: [{ standard: "nep413", payload: {} }] });
    const queries = sent.filter((s) => s.method === "query");
    expect(queries).toHaveLength(3);
    for (const q of queries) {
      expect(q.params.request_type).toBe("call_function");
      expect(q.params.block_id).toBe(BLOCK.hash);
      expect(q.params).not.toHaveProperty("finality");
    }
    const args = (i: number) =>
      JSON.parse(Buffer.from(String(queries[i]?.params.args_base64), "base64").toString());
    expect(args(0)).toEqual({});
    expect(args(1)).toEqual({ account_id: "a.near", token_id: "nep141:tusd.near" });
    expect(args(2)).toEqual({ signed: [{ standard: "nep413", payload: {} }] });
    // No other network, and no non-account contract.
    await expect(
      t.view({
        network: "mainnet",
        account: "a.near",
        method: "get_control",
        args: {},
        block: BLOCK,
      }),
    ).rejects.toSatisfy((e: unknown) => e instanceof V3ReadError && e.code === "unsupported");
    await expect(view("get_control", {}, "NOT AN ACCOUNT")).rejects.toSatisfy(
      (e: unknown) => e instanceof V3ReadError && e.code === "unsupported",
    );
  });

  it("the observation transport knows five views and the key reader one query", async () => {
    const { sent, fetchImpl } = endpoint();
    const t = new TestnetRpcTransport(config, fetchImpl as never);
    for (const method of ["get_party", "mt_balance_of", "ft_balance_of", "get_plan"])
      await expect(
        t.view({ network: "testnet", account: "a.near", method, args: {}, block: BLOCK }),
      ).rejects.toSatisfy((e: unknown) => e instanceof V3ReadError && e.code === "unsupported");
    await t.view({
      network: "testnet",
      account: "a.near",
      method: "get_period",
      args: { yyyymm: 202611 },
      block: BLOCK,
    });
    expect(sent.filter((s) => s.method === "query")).toHaveLength(1);
    const r = new TestnetAccessKeyReader(config, fetchImpl as never);
    await expect(r.isFullAccessKey("a.near", "secp256k1:abc")).rejects.toSatisfy(
      (e: unknown) => e instanceof V3ReadError && e.code === "unsupported",
    );
    expect(await r.isFullAccessKey("a.near", "ed25519:11111111111111111111111111111111")).toBe(
      true,
    );
    const q = sent.filter((s) => s.method === "query").at(-1);
    expect(q?.params).toEqual({
      request_type: "view_access_key",
      finality: "final",
      account_id: "a.near",
      public_key: "ed25519:11111111111111111111111111111111",
    });
  });
});
