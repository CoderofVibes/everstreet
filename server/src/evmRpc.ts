// The external asset's other chain reached over a standard EVM JSON-RPC endpoint (Sepolia in the
// testnet series). Reads the registry's controller and an address's nonce, relays a transaction
// the MPC signer already signed, and reports its status. Holds no key and signs nothing.
//
// "final" means the receipt's block is at or below the chain's finalized block; until then a
// mined transaction is "pending". The controller is read at the finalized block too, so the app
// never shows a role move the other chain could still undo.

import { keccak_256 } from "@noble/hashes/sha3.js";
import type { EvmPort } from "./companions.ts";
import { toHex } from "./evm.ts";

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const QTY = /^0x(0|[1-9a-fA-F][0-9a-fA-F]*)$/;

/** `controller()` selector. */
const CONTROLLER = toHex(keccak_256(new TextEncoder().encode("controller()")).slice(0, 4));

export interface EvmRpcConfig {
  name: string;
  chain_id: number;
  rpc: string;
  /**
   * Gas limit for a registry call (default 200,000: Sepolia now prices a fresh storage slot at
   * about 130,000 gas for a first publish; a role move is about 30,000).
   */
  gas_limit?: number;
  timeoutMs?: number;
}

export class EvmRpcPort implements EvmPort {
  readonly chainName: string;
  readonly source = "testnet" as const;
  private id = 0;
  constructor(
    private readonly cfg: EvmRpcConfig,
    private readonly fetchImpl: FetchLike = fetch as FetchLike,
  ) {
    this.chainName = cfg.name;
  }

  private async rpc(method: string, params: unknown[]): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs ?? 10_000);
    try {
      const res = await this.fetchImpl(this.cfg.rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
      const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
      if (body.error) throw new Error(`${method}: ${body.error.message ?? "error"}`);
      return body.result ?? null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** The chain answers with the id this port was configured for, or nothing is trusted. */
  async checkChain() {
    const id = await this.rpc("eth_chainId", []);
    if (typeof id !== "string" || !QTY.test(id) || Number(BigInt(id)) !== this.cfg.chain_id)
      throw new Error(`the endpoint isn't chain ${this.cfg.chain_id}`);
  }

  async controller(registry: string) {
    if (!ADDRESS.test(registry)) throw new Error("registry isn't an address");
    const out = await this.rpc("eth_call", [{ to: registry, data: CONTROLLER }, "finalized"]);
    if (out === "0x") throw new Error("the registry isn't there at the finalized block (yet)");
    if (typeof out !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(out))
      throw new Error("controller() answered something else");
    if (!/^0x0{24}/.test(out)) throw new Error("controller() isn't an address");
    return `0x${out.slice(26).toLowerCase()}`;
  }

  async nonce(address: string) {
    if (!ADDRESS.test(address)) throw new Error("not an address");
    const n = await this.rpc("eth_getTransactionCount", [address, "pending"]);
    if (typeof n !== "string" || !QTY.test(n)) throw new Error("nonce answered something else");
    return Number(BigInt(n));
  }

  async broadcast(raw: Uint8Array) {
    const expected = toHex(keccak_256(raw));
    try {
      const h = await this.rpc("eth_sendRawTransaction", [toHex(raw)]);
      if (typeof h === "string" && h.toLowerCase() !== expected)
        throw new Error("the chain named another transaction hash");
    } catch (e) {
      // Already known (an earlier send of the same bytes arrived): the hash is still the record.
      if (!/already known|known transaction|nonce too low/i.test((e as Error).message)) throw e;
    }
    return expected;
  }

  async status(hash: string): Promise<"unknown" | "pending" | "final" | "failed"> {
    if (!HASH.test(hash)) return "unknown";
    const receipt = (await this.rpc("eth_getTransactionReceipt", [hash])) as {
      status?: string;
      blockNumber?: string;
    } | null;
    if (!receipt?.blockNumber) {
      const tx = await this.rpc("eth_getTransactionByHash", [hash]);
      return tx ? "pending" : "unknown";
    }
    const fin = (await this.rpc("eth_getBlockByNumber", ["finalized", false])) as {
      number?: string;
    } | null;
    if (!fin?.number || BigInt(receipt.blockNumber) > BigInt(fin.number)) return "pending";
    return receipt.status === "0x1" ? "final" : "failed";
  }

  async fees() {
    const block = (await this.rpc("eth_getBlockByNumber", ["latest", false])) as {
      baseFeePerGas?: string;
    } | null;
    const tip = await this.rpc("eth_maxPriorityFeePerGas", []);
    if (!block?.baseFeePerGas || typeof tip !== "string" || !QTY.test(tip))
      throw new Error("fees answered something else");
    const base = BigInt(block.baseFeePerGas);
    // A floor of 1 gwei: the network's own suggestion can be a few wei, too low to be picked up.
    const priority = BigInt(tip) > 1_000_000_000n ? BigInt(tip) : 1_000_000_000n;
    return {
      max_fee_per_gas: String(base * 2n + priority),
      max_priority_fee_per_gas: String(priority),
      gas_limit: String(this.cfg.gas_limit ?? 200_000),
    };
  }
}
