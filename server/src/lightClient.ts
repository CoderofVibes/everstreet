// Light-client proof of a transaction's outcome (NEAR's EXPERIMENTAL_light_client_proof), checked
// here without trusting the explorer or the RPC's word for the result:
//
// 1. The outcome's hash, from its exact fields (borsh), proves into the shard's outcome root, and
//    that into the block's outcome root, which must equal the block header's `outcome_root`.
// 2. The block header's hash is recomputed from its fields; it must be the block the outcome
//    names.
// 3. That block hash proves into the `block_merkle_root` of a later block (the light-client
//    head). The head's header is taken from an RPC: so the label is exactly "proved against block
//    header H". Verifying H itself from an epoch checkpoint with validator signatures is a further
//    step not done here.

import { sha256 } from "@noble/hashes/sha2.js";

type Json = Record<string, unknown>;

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function b58(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error("not base58");
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const c of s) {
    if (c !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}
const hash32 = (s: string) => {
  const b = b58(s);
  if (b.length !== 32) throw new Error("a hash is 32 bytes");
  return b;
};
export const toB58 = (b: Uint8Array) => {
  let n = BigInt(`0x${Buffer.from(b).toString("hex") || "0"}`);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const x of b) {
    if (x !== 0) break;
    out = `1${out}`;
  }
  return out;
};

const cat = (...p: Uint8Array[]) => Uint8Array.from(Buffer.concat(p.map((x) => Buffer.from(x))));
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const u64 = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};
const u128 = (n: bigint) => {
  const b = Buffer.alloc(16);
  b.writeBigUInt64LE(n & 0xffff_ffff_ffff_ffffn);
  b.writeBigUInt64LE(n >> 64n, 8);
  return b;
};
const str = (s: string) => {
  const b = Buffer.from(s, "utf8");
  return cat(u32(b.length), b);
};
const combine = (a: Uint8Array, b: Uint8Array) => sha256(cat(a, b));

/** A merkle path from a leaf hash up to its root. */
export function rootFromPath(path: { hash: string; direction: string }[], leaf: Uint8Array) {
  let h = leaf;
  for (const item of path) {
    const sib = hash32(item.hash);
    h = item.direction === "Left" ? combine(sib, h) : combine(h, sib);
  }
  return h;
}

/** The outcome's hash as NEAR computes it (ExecutionOutcomeWithId::to_hashes, then borsh). */
export function outcomeHash(proof: Json): Uint8Array {
  const o = proof.outcome as Json;
  const status = o.status as Json | string;
  let st: Uint8Array;
  if (status === "Unknown") st = Uint8Array.of(0);
  else if (typeof status === "object" && "Failure" in status) st = Uint8Array.of(1);
  else if (typeof status === "object" && "SuccessValue" in status) {
    const v = Buffer.from(String(status.SuccessValue), "base64");
    st = cat(Uint8Array.of(2), u32(v.length), v);
  } else if (typeof status === "object" && "SuccessReceiptId" in status)
    st = cat(Uint8Array.of(3), hash32(String(status.SuccessReceiptId)));
  else throw new Error("unknown outcome status");
  const receipts = (o.receipt_ids as string[]).map(hash32);
  const partial = cat(
    u32(receipts.length),
    ...receipts,
    u64(BigInt(o.gas_burnt as number | string)),
    u128(BigInt(o.tokens_burnt as string)),
    str(String(o.executor_id)),
    st,
  );
  const hashes = [
    hash32(String(proof.id)),
    sha256(partial),
    ...(o.logs as string[]).map((l) => sha256(Uint8Array.from(Buffer.from(l, "utf8")))),
  ];
  return sha256(cat(u32(hashes.length), ...hashes));
}

/** A block's hash from its light header (inner_lite, inner_rest_hash, prev_block_hash). */
export function blockHashOf(lite: Json): Uint8Array {
  const i = lite.inner_lite as Json;
  const inner = cat(
    u64(BigInt(i.height as number)),
    hash32(String(i.epoch_id)),
    hash32(String(i.next_epoch_id)),
    hash32(String(i.prev_state_root)),
    hash32(String(i.outcome_root)),
    u64(BigInt(String(i.timestamp_nanosec ?? i.timestamp))),
    hash32(String(i.next_bp_hash)),
    hash32(String(i.block_merkle_root)),
  );
  return combine(
    combine(sha256(inner), hash32(String(lite.inner_rest_hash))),
    hash32(String(lite.prev_block_hash)),
  );
}

export interface LightClientResult {
  ok: boolean;
  problems: string[];
  /** The block the outcome is in, and the header it was proved against. */
  block: { hash: string; height: number };
  head: { hash: string; height: number | null };
  status: unknown;
}

/**
 * Checks a light-client proof response against the head header's `block_merkle_root` (taken from
 * a `block` read of the light-client head).
 */
export function verifyLightClientProof(
  proof: Json,
  head: { hash: string; height?: number; block_merkle_root: string },
): LightClientResult {
  const problems: string[] = [];
  const outcomeProof = proof.outcome_proof as Json;
  const lite = proof.block_header_lite as Json;
  const shardRoot = rootFromPath(
    outcomeProof.proof as { hash: string; direction: string }[],
    outcomeHash(outcomeProof),
  );
  const blockOutcomeRoot = rootFromPath(
    proof.outcome_root_proof as { hash: string; direction: string }[],
    sha256(shardRoot),
  );
  const expectedOutcomeRoot = toB58(hash32(String((lite.inner_lite as Json).outcome_root)));
  if (toB58(blockOutcomeRoot) !== expectedOutcomeRoot)
    problems.push("the outcome doesn't prove into the block's outcome root");
  const blockHash = blockHashOf(lite);
  if (toB58(blockHash) !== String(outcomeProof.block_hash))
    problems.push("the block header isn't the block the outcome names");
  const merkle = rootFromPath(
    proof.block_proof as { hash: string; direction: string }[],
    blockHash,
  );
  if (toB58(merkle) !== head.block_merkle_root)
    problems.push("the block doesn't prove into the head's block merkle root");
  return {
    ok: problems.length === 0,
    problems,
    block: { hash: toB58(blockHash), height: Number((lite.inner_lite as Json).height) },
    head: { hash: head.hash, height: head.height ?? null },
    status: (outcomeProof.outcome as Json).status,
  };
}
