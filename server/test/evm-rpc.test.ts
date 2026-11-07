// The external asset's EVM testnet port (server/src/evmRpc.ts) over a scripted JSON-RPC: the
// controller is read at the finalized block; a mined transaction is pending until its block is
// finalized; a reverted one is failed only then; a relay whose hash the chain names differently
// is refused; an earlier send of the same bytes is fine; fees have a 1 gwei tip floor.

import { keccak_256 } from "@noble/hashes/sha3.js";
import { describe, expect, it } from "vitest";
import { toHex } from "../src/evm.ts";
import { EvmRpcPort } from "../src/evmRpc.ts";

type Handler = (params: unknown[]) => unknown;
function port(h: Record<string, Handler>) {
  const calls: { method: string; params: unknown[] }[] = [];
  const fetchImpl = async (_url: string, init: RequestInit) => {
    const { method, params, id } = JSON.parse(String(init.body)) as {
      method: string;
      params: unknown[];
      id: number;
    };
    calls.push({ method, params });
    const f = h[method];
    if (!f) return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { message: "nope" } }));
    try {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: f(params) }));
    } catch (e) {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id, error: { message: (e as Error).message } }),
      );
    }
  };
  const p = new EvmRpcPort(
    { name: "Sepolia", chain_id: 11155111, rpc: "https://sepolia.synthetic.example" },
    fetchImpl as never,
  );
  return { p, calls };
}
const REG = "0x888188bc8e06c2f05d29092c1745fa5337736cfd";
const HASH = `0x${"ab".repeat(32)}`;

describe("EVM testnet port", () => {
  it("reads the controller at the finalized block, and says so when the registry isn't there yet", async () => {
    const { p, calls } = port({
      eth_call: () => `0x${"0".repeat(24)}${"219B8d58164642d585e6857dc9943c59b4421f16"}`,
    });
    expect(await p.controller(REG)).toBe("0x219b8d58164642d585e6857dc9943c59b4421f16");
    expect(calls[0]?.params[1]).toBe("finalized");
    const empty = port({ eth_call: () => "0x" }).p;
    await expect(empty.controller(REG)).rejects.toThrow(/finalized block/);
    const dirty = port({ eth_call: () => `0x${"1".repeat(64)}` }).p;
    await expect(dirty.controller(REG)).rejects.toThrow(/isn't an address/);
  });

  it("pending until finalized; failed only once a reverted receipt is finalized", async () => {
    let finalized = "0x10";
    let status = "0x1";
    const { p } = port({
      eth_getTransactionReceipt: () => ({ status, blockNumber: "0x12" }),
      eth_getBlockByNumber: () => ({ number: finalized }),
      eth_getTransactionByHash: () => null,
    });
    expect(await p.status(HASH)).toBe("pending");
    finalized = "0x12";
    expect(await p.status(HASH)).toBe("final");
    status = "0x0";
    expect(await p.status(HASH)).toBe("failed");
    const none = port({
      eth_getTransactionReceipt: () => null,
      eth_getTransactionByHash: () => null,
    }).p;
    expect(await none.status(HASH)).toBe("unknown");
    expect(await none.status("not-a-hash")).toBe("unknown");
  });

  it("relays exactly these bytes: the hash is keccak of them; another hash is refused; a resend is fine", async () => {
    const raw = Uint8Array.from([2, 1, 2, 3]);
    const mine = toHex(keccak_256(raw));
    expect(await port({ eth_sendRawTransaction: () => mine }).p.broadcast(raw)).toBe(mine);
    await expect(port({ eth_sendRawTransaction: () => HASH }).p.broadcast(raw)).rejects.toThrow(
      /another transaction hash/,
    );
    const again = port({
      eth_sendRawTransaction: () => {
        throw new Error("already known");
      },
    }).p;
    expect(await again.broadcast(raw)).toBe(mine);
    const broke = port({
      eth_sendRawTransaction: () => {
        throw new Error("insufficient funds for gas * price + value");
      },
    }).p;
    await expect(broke.broadcast(raw)).rejects.toThrow(/insufficient funds/);
  });

  it("fees: twice the base fee plus a tip of at least 1 gwei; gas 200,000", async () => {
    const { p } = port({
      eth_getBlockByNumber: () => ({ baseFeePerGas: "0xe" }),
      eth_maxPriorityFeePerGas: () => "0x2",
    });
    expect(await p.fees()).toEqual({
      max_fee_per_gas: String(28n + 1_000_000_000n),
      max_priority_fee_per_gas: "1000000000",
      gas_limit: "200000",
    });
  });
});
