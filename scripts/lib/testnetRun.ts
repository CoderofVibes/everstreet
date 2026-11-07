// Shared plumbing for the later testnet runs (the series-3 and series-4 scripts keep their own
// copies, as recorded): sign and send as a script-held account without ever re-signing, create
// fictional accounts, register and fund them with the test token, and drive the app through its
// normal entry with the labelled stand-in model. Keys stay in .near-credentials/ and are never
// printed or recorded.

import { type ChildProcess, fork } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { baseEncode } from "near-api-js";
import { nep413Digest } from "../../server/src/identity.ts";
import {
  account,
  actions,
  EXPLORER,
  exists,
  KeyPair,
  nearToYocto,
  provider,
  ROOT,
  saveKey,
  secretKeyOf,
  teraToGas,
  view,
} from "./near.ts";
import { type Call, type Json, StopRun, type WalletCall } from "./rehearsal/journey.ts";

export const log: Json[] = [];
const sent = (what: string, hash: string) => {
  log.push({ what, hash, explorer: `${EXPLORER}${hash}` });
  console.log(`+ ${what}: ${EXPLORER}${hash}`);
};

/** The root account's NEAR, and a guard on what a run has spent from it. */
export async function rootNear() {
  const v = await provider.viewAccount({ accountId: ROOT, blockQuery: { finality: "final" } });
  return Number(BigInt(v.amount) / 10n ** 21n) / 1000;
}
export function spendGuard(file: string, ceiling: number) {
  return async (stage: string) => {
    const now = await rootNear();
    const s = JSON.parse(readFileSync(file, "utf8")) as { start: number };
    const spent = s.start - now;
    console.log(`  spend check (${stage}): ${spent.toFixed(3)} of ${ceiling} testnet NEAR`);
    if (spent > ceiling) throw new StopRun(`spend ceiling passed at ${stage}: ${spent} NEAR`);
  };
}
export async function startSpend(file: string) {
  try {
    readFileSync(file, "utf8");
  } catch {
    writeFileSync(file, JSON.stringify({ start: await rootNear() }));
  }
}

/** Signs first (hash known), sends, polls FINAL, re-sends the same bytes; never re-signs. */
export async function sendAs(accountId: string, call: WalletCall) {
  const a = account(accountId);
  const signer = a.getSigner();
  if (!signer) throw new StopRun(`no signer for ${accountId}`);
  const tx = await a.createTransaction({
    receiverId: call.receiverId,
    actions: [
      actions.functionCall(call.methodName, call.args, BigInt(call.gas), BigInt(call.deposit)),
    ],
    publicKey: await signer.getPublicKey(),
  });
  const { txHash, signedTransaction } = await signer.signTransaction(tx);
  const hash = baseEncode(txHash);
  console.log(`  ${accountId.split(".")[0]} ${call.methodName}: ${EXPLORER}${hash}`);
  const broadcast = () => provider.sendTransactionAsync(signedTransaction).catch(() => undefined);
  await broadcast();
  const deadline = Date.now() + 240_000;
  let again = Date.now() + 30_000;
  // biome-ignore lint/suspicious/noExplicitAny: the RPC's status shape, read field by field
  let r: any = null;
  while (Date.now() < deadline) {
    r = await provider
      .viewTransactionStatusWithReceipts({ txHash: hash, accountId, waitUntil: "FINAL" } as never)
      .catch(() => null);
    if (r?.status && ("SuccessValue" in r.status || "Failure" in r.status)) break;
    r = null;
    if (Date.now() > again) {
      await broadcast();
      again = Date.now() + 60_000;
    }
    await new Promise((x) => setTimeout(x, 3000));
  }
  if (!r) throw new StopRun(`${call.methodName} by ${accountId}: outcome unknown; ${hash}`);
  const failure = (r.status as { Failure?: unknown }).Failure;
  // biome-ignore lint/suspicious/noExplicitAny: receipts as returned
  const outcomes = (r.receipts_outcome ?? []) as any[];
  const value =
    "SuccessValue" in r.status && r.status.SuccessValue
      ? Buffer.from(r.status.SuccessValue, "base64").toString("utf8")
      : null;
  return {
    hash,
    ok: failure === undefined,
    error: failure === undefined ? undefined : JSON.stringify(failure).slice(0, 400),
    value,
    receipts: outcomes.map((o) => ({
      executor: o.outcome.executor_id,
      status: Object.keys(o.outcome.status as object)[0],
      logs: (o.outcome.logs as string[]).filter((l) => l.startsWith("EVENT_JSON")).slice(0, 4),
    })),
  };
}

/** A fictional account with a full-access key held in .near-credentials/. */
export async function createFull(id: string, near: string) {
  if (await exists(id)) return console.log(`✓ ${id} exists`);
  const key = KeyPair.fromRandom("ed25519");
  saveKey(id, key);
  const r = await account(ROOT).signAndSendTransaction({
    receiverId: id,
    actions: [
      actions.createAccount(),
      actions.transfer(nearToYocto(near as `${number}`)),
      actions.addFullAccessKey(key.getPublicKey()),
    ],
    waitUntil: "FINAL",
  });
  sent(`create ${id}`, r.transaction.hash);
}

export async function registerToken(token: string, id: string) {
  if (await view<Json | null>(token, "storage_balance_of", { account_id: id })) return;
  const r = await account(ROOT).signAndSendTransaction({
    receiverId: token,
    actions: [
      actions.functionCall(
        "storage_deposit",
        { account_id: id, registration_only: true },
        teraToGas(30),
        1_250_000_000_000_000_000_000n,
      ),
    ],
    waitUntil: "FINAL",
  });
  sent(`register ${id} with ${token.split(".")[0]}`, r.transaction.hash);
}

export async function fundToken(token: string, from: string, to: string, want: bigint) {
  const have = BigInt(await view<string>(token, "ft_balance_of", { account_id: to }));
  if (have >= want) return;
  const r = await account(from).signAndSendTransaction({
    receiverId: token,
    actions: [
      actions.functionCall(
        "ft_transfer",
        { receiver_id: to, amount: String(want - have) },
        teraToGas(30),
        1n,
      ),
    ],
    waitUntil: "FINAL",
  });
  sent(`fund ${to} with ${Number(want - have) / 1e6} ${token.split(".")[0]}`, r.transaction.hash);
}

/** The app through its normal entry (scripts/rehearsal-child.ts), stand-in model only. */
export function startApp(configFile: string) {
  const proc: ChildProcess = fork(join("scripts", "rehearsal-child.ts"), [configFile], {
    execArgv: ["--import", "tsx"],
    env: { ...process.env, EVERSTREET_REHEARSAL_MODEL_KEY: "stand-in-not-a-credential" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let out = "";
  proc.stdout?.on("data", (d) => (out = (out + d).slice(-64_000)));
  proc.stderr?.on("data", (d) => (out = (out + d).slice(-64_000)));
  const exited = new Promise<number | null>((r) => proc.once("exit", (c) => r(c)));
  return {
    log: () => out,
    ready: async () => {
      const end = Date.now() + 60_000;
      while (!out.includes("listening on")) {
        if (Date.now() > end || proc.exitCode !== null)
          throw new StopRun(`app didn't start: ${out.slice(-1500)}`);
        await new Promise((r) => setTimeout(r, 100));
      }
    },
    stop: async () => {
      if (proc.connected) proc.send({ type: "shutdown" });
      return exited;
    },
  };
}

/** A cookie-keeping HTTP client against the app on this port. */
export function httpClient(port: number): Call {
  const jar = new Map<string, string>();
  return async (path, method = "GET", body) => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const set of res.headers.getSetCookie()) {
      const [pair, ...attrs] = set.split(";");
      const [name, ...rest] = (pair as string).split("=");
      const value = rest.join("=");
      if (!value || attrs.some((x) => /^max-age=0$/i.test(x.trim()))) jar.delete(name as string);
      else jar.set(name as string, value);
    }
    return { status: res.status, body: (await res.json().catch(() => null)) as Json };
  };
}

/** Wallet sign-in (NEP-413) with the account's own key. */
export async function signIn(call: Call, accountId: string) {
  const ch = (await call("/api/session/challenge", "POST")).body.challenge as Json;
  const digest = nep413Digest({
    message: ch.message,
    nonce: Buffer.from(ch.nonce, "base64"),
    recipient: ch.recipient,
  });
  const key = KeyPair.fromString(secretKeyOf(accountId));
  const r = await call("/api/session/verify", "POST", {
    account_id: accountId,
    public_key: key.getPublicKey().toString(),
    signature: Buffer.from(key.sign(digest).signature).toString("base64"),
    nonce: ch.nonce,
  });
  if (r.status !== 200 && r.status !== 201)
    throw new StopRun(`sign-in ${accountId}: ${r.status} ${JSON.stringify(r.body)}`);
}

export const okBody = (
  r: { status: number; body: Json },
  want: number[] | number,
  what: string,
) => {
  const w = Array.isArray(want) ? want : [want];
  if (!w.includes(r.status)) throw new StopRun(`${what}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
