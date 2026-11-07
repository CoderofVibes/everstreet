// Everstreet's solver on NEAR testnet: signs its own side of a matched swap (NEP-413, with its
// own key, named by a file in the configuration) and submits both signed sides to the intents
// verifier in one `execute_intents` call, as itself. It never signs for the buyer, and the
// verifier executes both sides or neither.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { base58Encode, encodeTransaction, OperatorKey, type TxRpc } from "./customerWriter.ts";
import { base58Decode } from "./identity.ts";
import { IntentsRefused, type SolverPort } from "./intentsFunding.ts";

const GAS = 300_000_000_000_000n; // 300 Tgas: the verifier runs both sides and their transfers

/** Reads a NEAR key file (account_id, public_key, private_key/secret_key). Never echoed. */
export function solverKeyFrom(file: string, account: string) {
  const k = JSON.parse(readFileSync(file, "utf8")) as {
    account_id?: unknown;
    public_key?: unknown;
    private_key?: unknown;
    secret_key?: unknown;
  };
  if (k.account_id !== undefined && k.account_id !== account)
    throw new Error("solver: the key file is for another account");
  const secret = k.private_key ?? k.secret_key;
  if (typeof k.public_key !== "string" || typeof secret !== "string")
    throw new Error("solver: the key file is incomplete");
  return new OperatorKey(secret, k.public_key);
}

export class TestnetSolver implements SolverPort {
  readonly source = "testnet" as const;
  readonly publicKey: string;
  private nextNonce: bigint | null = null;
  constructor(
    readonly account: string,
    private readonly key: OperatorKey,
    private readonly rpc: TxRpc,
    private readonly statusPolls = 12,
    private readonly pollMs = 5_000,
  ) {
    this.publicKey = key.publicKey;
  }

  sign(digest: Buffer): Buffer {
    return this.key.sign(digest);
  }

  async execute(verifier: string, signed: unknown[]): Promise<{ hash: string }> {
    const access = await this.rpc.accessKey(this.account, this.key.publicKey);
    if (!access) throw new Error("solver: its key isn't on its account");
    const chain = access.nonce + 1n;
    const nonce = this.nextNonce !== null && this.nextNonce > chain ? this.nextNonce : chain;
    this.nextNonce = nonce + 1n;
    const block = await this.rpc.latestBlock();
    const tx = encodeTransaction({
      signer: this.account,
      publicKey: this.key.publicBytes,
      nonce,
      receiver: verifier,
      blockHash: Buffer.from(base58Decode(block.hash)),
      method: "execute_intents",
      args: Buffer.from(JSON.stringify({ signed }), "utf8"),
      gas: GAS,
      deposit: 0n,
    });
    const hash = createHash("sha256").update(tx).digest();
    const raw = Buffer.concat([tx, Buffer.from([0]), this.key.sign(hash)]);
    const txHash = base58Encode(hash);
    let out = await this.rpc.sendTx(raw.toString("base64"), txHash);
    // Waiting for FINAL can outlast one RPC answer: ask for this transaction's own status a few
    // times before calling the outcome unknown (the verifier's nonce record still decides then).
    for (
      let i = 0;
      i < this.statusPolls && (out.kind === "unknown" || out.kind === "not_found");
      i++
    ) {
      await new Promise((r) => setTimeout(r, this.pollMs));
      out = await this.rpc.txStatus(txHash, this.account);
    }
    if (out.kind === "success") return { hash: txHash };
    if (out.kind === "failure") throw new IntentsRefused(`the verifier refused (${out.code})`);
    if (out.kind === "invalid") throw new IntentsRefused(`not accepted (${out.reason})`);
    // Sent, answer lost or not final yet: the verifier's spent-nonce record decides.
    throw new Error(`execute_intents ${txHash}: outcome not known yet`);
  }
}
