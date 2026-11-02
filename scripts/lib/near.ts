// Testnet plumbing for the scripts: accounts from local key files, calls that keep the
// transaction hash whether they succeed or fail, and views at final finality.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  Account,
  actions,
  JsonRpcProvider,
  KeyPair,
  type KeyPairString,
  nearToYocto,
  teraToGas,
} from "near-api-js";

export const RPC = process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com";
export const EXPLORER = "https://testnet.nearblocks.io/txns/";
export const ROOT = process.env.EVERSTREET_ROOT ?? "everstreet.testnet";
export const CONFIG_PATH = "config/testnet.json";
const REPO_KEYS = ".near-credentials/testnet";
const LEGACY_KEYS = join(homedir(), ".near-credentials", "testnet");

export const provider = new JsonRpcProvider({ url: RPC }, { retries: 4, wait: 500, backoff: 1.5 });

export interface TestnetConfig {
  network: "testnet";
  rpc: string;
  root: string;
  business: string;
  issuer: string;
  founder: string;
  buyer: string;
  workerA: string;
  workerB: string;
  wasmSha256Hex: string;
  codeHash: string;
  deployTx: string;
  deployedAt: string;
}

export function readConfig(): TestnetConfig {
  return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as TestnetConfig;
}

/** A key file in the repo's gitignored keychain, else the CLI's legacy keychain. */
export function secretKeyOf(accountId: string): KeyPairString {
  for (const dir of [REPO_KEYS, LEGACY_KEYS]) {
    const path = join(dir, `${accountId}.json`);
    if (existsSync(path)) {
      const file = JSON.parse(readFileSync(path, "utf8")) as {
        private_key?: string;
        secret_key?: string;
      };
      const key = file.private_key ?? file.secret_key;
      if (key) return key as KeyPairString;
    }
  }
  throw new Error(`No key file for ${accountId} in ${REPO_KEYS} or ${LEGACY_KEYS}`);
}

export function saveKey(accountId: string, keyPair: KeyPair) {
  mkdirSync(REPO_KEYS, { recursive: true });
  writeFileSync(
    join(REPO_KEYS, `${accountId}.json`),
    JSON.stringify({
      account_id: accountId,
      public_key: keyPair.getPublicKey().toString(),
      private_key: keyPair.toString(),
    }),
  );
}

export function account(accountId: string) {
  return new Account(accountId, provider, secretKeyOf(accountId));
}

export async function exists(accountId: string) {
  try {
    await provider.viewAccount({ accountId, blockQuery: { finality: "final" } });
    return true;
  } catch (error) {
    if (/does not exist|UNKNOWN_ACCOUNT/i.test(String(error))) return false;
    throw error;
  }
}

export async function view<T>(
  contractId: string,
  method: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return (await provider.callFunction({
    contractId,
    method,
    args,
    blockQuery: { finality: "final" },
  })) as T;
}

export interface TxResult {
  hash: string;
  ok: boolean;
  logs: string[];
  error?: string;
  url: string;
}

/** Sends one function call and returns its hash and outcome, failure included. */
export async function call(
  signer: string,
  contractId: string,
  method: string,
  args: Record<string, unknown>,
  deposit = 1n,
): Promise<TxResult> {
  const response = await account(signer).signAndSendTransaction({
    receiverId: contractId,
    actions: [actions.functionCall(method, args, teraToGas(100), deposit)],
    waitUntil: "FINAL",
    throwOnFailure: false,
  });
  const status = response.status as { Failure?: unknown };
  const logs = response.receipts_outcome.flatMap((r) => r.outcome.logs);
  const hash = response.transaction.hash;
  const result: TxResult = { hash, ok: status.Failure === undefined, logs, url: EXPLORER + hash };
  if (status.Failure !== undefined) result.error = executionError(status.Failure);
  return result;
}

function executionError(failure: unknown): string {
  const text = JSON.stringify(failure);
  const m = text.match(/"ExecutionError":"((?:[^"\\]|\\.)*)"/);
  return m?.[1] ? JSON.parse(`"${m[1]}"`) : text;
}

export async function mustCall(
  signer: string,
  contractId: string,
  method: string,
  args: Record<string, unknown>,
  deposit = 1n,
) {
  const r = await call(signer, contractId, method, args, deposit);
  if (!r.ok) throw new Error(`${method} as ${signer} failed: ${r.error} (${r.url})`);
  return r;
}

export { actions, KeyPair, nearToYocto, teraToGas };

/** Reads the wasm the WSL build left (contracts/business, CARGO_TARGET_DIR=~/everstreet-target). */
export function readWasm(distro = process.env.WSL_DISTRO ?? "Ubuntu"): Buffer {
  return execFileSync(
    "wsl",
    ["-d", distro, "--", "bash", "-c", "cat ~/everstreet-target/near/business/business.wasm"],
    { maxBuffer: 16 * 1024 * 1024 },
  );
}
