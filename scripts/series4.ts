// Testnet series 4: the companion contracts as fixed after the Nov 7 attack review, deployed new
// (a locked contract can't change: new accounts) beside the same business, ledgerline-v3-3b. The
// business contract is unchanged. Recorded: the fixes that the run can show on chain, then a sale
// and the role moving to the buyer.
//
//   npx tsx scripts/series4.ts setup    the two fixed companions, a new Sepolia registry (the
//                                       signer derives new addresses for a new account), gas for
//                                       those addresses, the agent, the supplier and the buyer
//   npx tsx scripts/series4.ts run      through the app where the app has the step: what the
//                                       fixes refuse, a sale from noor-v3s3 (generation 3) to
//                                       ines-v3s4 (generation 4), the buyer's re-grant and move
//
// Fictional, script-held accounts; test tokens; faucet test ETH only. Evidence without keys.

import { type ChildProcess, execFileSync, fork } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { baseEncode } from "near-api-js";
import { addressOf, publicKeyFromSigner, toHex } from "../server/src/evm.ts";
import { nep413Digest } from "../server/src/identity.ts";
import { initCode } from "./lib/feedRegistry.ts";
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
} from "./lib/near.ts";
import { Recorder } from "./lib/rehearsal/evidence.ts";
import {
  type Call,
  type Json,
  StopRun,
  steps,
  type WalletCall,
  type Who,
} from "./lib/rehearsal/journey.ts";

// ---------- the cast ----------

const TOKEN = "tusd.everstreet.testnet";
const SIGNER = "v1.signer-prod.testnet";
const BIZ = `ledgerline-v3-3b.${ROOT}`;
const OWNER = `noor-v3s3.${ROOT}`; // generation 3 (bought it in series 3); sells it here
const NEXT = `ines-v3s4.${ROOT}`; // generation 4 (buys it here)
const METER = `meter-direct-v3s3b.${ROOT}`; // the operator the sale keeps
const ASSET = `feed-key-v3s4.${ROOT}`;
const ALLOW = `budget-v3s4.${ROOT}`;
const AGENT = `agent-v3s4.${ROOT}`;
const SUPPLIER = `supplier-v3s4.${ROOT}`;

const SEPOLIA = {
  name: "Sepolia",
  chain_id: 11155111,
  rpc: process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com",
};
const EVM_EXPLORER = "https://sepolia.etherscan.io/tx/";
const MAX_GAS_LIMIT = 1_000_000n;
const MAX_FEE = 100_000_000_000n; // 100 gwei: the asset-key's ceiling per gas

// Reproducible builds of commit 24ac5fb (docs/BUILDS.md).
const WASM = {
  asset_key: {
    file: "contracts/target/near/asset_key/asset_key.wasm",
    sha256: "e123359c2fd50beaf74df0d5ec0be802c046ab481602bbcd5530c496de225106",
  },
  spend_allowance: {
    file: "contracts/target/near/spend_allowance/spend_allowance.wasm",
    sha256: "3bb096761fb5c49ce0d120fffbdbfdfea00d22fce321e3f10a1833c899e6b4cb",
  },
};
const codeHashOf = (sha256Hex: string) => baseEncode(Buffer.from(sha256Hex, "hex"));

const EVIDENCE = "data/evidence";
const SETUP_FILE = join(EVIDENCE, "v3-s4-setup-testnet.json");
const RUN_FILE = join(EVIDENCE, "v3-s4-testnet.json");
const RUN_DIR = resolve("data", "runtime", "rehearsal-s4");
const SPEND_FILE = join("data", "runtime", "rehearsal-spend-s4.json");
const CEILING_NEAR = 8; // Tony's approved budget (Nov 7): about 8 testnet NEAR

const commit = () => execFileSync("git", ["rev-parse", "HEAD"]).toString().trim();

// ---------- NEAR plumbing ----------

async function spendGuard(stage: string) {
  const v = await provider.viewAccount({ accountId: ROOT, blockQuery: { finality: "final" } });
  const now = Number(BigInt(v.amount) / 10n ** 21n) / 1000;
  const s = JSON.parse(readFileSync(SPEND_FILE, "utf8")) as { start: number };
  const spent = s.start - now;
  console.log(`  spend check (${stage}): ${spent.toFixed(3)} of ${CEILING_NEAR} testnet NEAR`);
  if (spent > CEILING_NEAR) throw new StopRun(`spend ceiling passed at ${stage}: ${spent} NEAR`);
}

function readWasm(w: { file?: string; wsl?: string; sha256: string }): Buffer {
  const bytes = w.file
    ? readFileSync(w.file)
    : execFileSync("wsl", ["-d", "Ubuntu", "--", "bash", "-c", `cat ${w.wsl}`], {
        maxBuffer: 16 * 1024 * 1024,
      });
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== w.sha256) throw new StopRun(`${w.file ?? w.wsl} is ${sha}, not the recorded build`);
  return bytes;
}

const setupLog: Json[] = [];
const sent = (what: string, hash: string, chain: "near" | "sepolia" = "near") => {
  setupLog.push({
    what,
    chain,
    hash,
    explorer: `${chain === "near" ? EXPLORER : EVM_EXPLORER}${hash}`,
  });
  console.log(`+ ${what}: ${chain === "near" ? EXPLORER : EVM_EXPLORER}${hash}`);
};

/** Signs first (hash known), sends, polls FINAL, re-sends the same bytes; never re-signs. */
async function sendAs(accountId: string, call: WalletCall) {
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

async function createFull(id: string, near: string) {
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

/** A contract account with no keys: created, funded, deployed and initialized in one transaction. */
async function createLocked(
  id: string,
  near: string,
  wasm: Buffer,
  init: Json,
  codeHash: string,
  what: string,
) {
  if (!(await exists(id))) {
    await spendGuard(`before ${id}`);
    const r = await account(ROOT).signAndSendTransaction({
      receiverId: id,
      actions: [
        actions.createAccount(),
        actions.transfer(nearToYocto(near as `${number}`)),
        actions.deployContract(wasm),
        actions.functionCall("new", init, teraToGas(100), 0n),
      ],
      waitUntil: "FINAL",
    });
    sent(`deploy and init ${id} (${what}; born locked: no key)`, r.transaction.hash);
  } else console.log(`✓ ${id} exists`);
  const acc = await provider.viewAccount({ accountId: id, blockQuery: { finality: "final" } });
  if (acc.code_hash !== codeHash)
    throw new StopRun(`${id} code ${acc.code_hash} isn't ${codeHash}`);
  const keys = (await provider.query({
    request_type: "view_access_key_list",
    account_id: id,
    finality: "final",
  } as never)) as unknown as { keys: unknown[] };
  if (keys.keys.length !== 0) throw new StopRun(`${id} has access keys: not locked`);
  console.log(`✓ ${id}: code ${codeHash}, no keys`);
}

async function registerToken(token: string, id: string) {
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

async function fundToken(token: string, from: string, to: string, want: bigint) {
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

// ---------- Sepolia plumbing (test ETH only) ----------

let rpcId = 0;
async function evm<T = unknown>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(SEPOLIA.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const body = (await res.json()) as { result?: T; error?: { message?: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result as T;
}

const beMin = (v: bigint) => {
  if (v === 0n) return Buffer.alloc(0);
  let h = v.toString(16);
  if (h.length % 2) h = `0${h}`;
  return Buffer.from(h, "hex");
};
const rlp = (x: Buffer | Buffer[]): Buffer => {
  if (Array.isArray(x)) {
    const body = Buffer.concat(x.map(rlp));
    if (body.length < 56) return Buffer.concat([Buffer.of(0xc0 + body.length), body]);
    const len = beMin(BigInt(body.length));
    return Buffer.concat([Buffer.of(0xf7 + len.length), len, body]);
  }
  if (x.length === 1 && (x[0] as number) < 0x80) return x;
  if (x.length < 56) return Buffer.concat([Buffer.of(0x80 + x.length), x]);
  const len = beMin(BigInt(x.length));
  return Buffer.concat([Buffer.of(0xb7 + len.length), len, x]);
};

function deployerKey() {
  const k = JSON.parse(readFileSync(".evm-credentials/sepolia-deployer.json", "utf8")) as {
    address: string;
    secret_key: string;
  };
  return { address: k.address, sk: Uint8Array.from(Buffer.from(k.secret_key, "hex")) };
}

async function evmFees() {
  const block = await evm<{ baseFeePerGas: string }>("eth_getBlockByNumber", ["latest", false]);
  const tip = 1_000_000_000n; // 1 gwei: comfortably included on Sepolia
  return { tip, maxFee: BigInt(block.baseFeePerGas) * 2n + tip };
}

/** The deployer's own EIP-1559 transaction (a transfer or a contract creation). */
async function deployerSend(to: string | null, value: bigint, data: Buffer, gas: bigint) {
  const d = deployerKey();
  const nonce = BigInt(await evm<string>("eth_getTransactionCount", [d.address, "pending"]));
  const { tip, maxFee } = await evmFees();
  const fields = [
    beMin(BigInt(SEPOLIA.chain_id)),
    beMin(nonce),
    beMin(tip),
    beMin(maxFee),
    beMin(gas),
    to ? Buffer.from(to.slice(2), "hex") : Buffer.alloc(0),
    beMin(value),
    data,
    [] as Buffer[],
  ];
  const unsigned = Buffer.concat([Buffer.of(2), rlp(fields as never)]);
  const sig = secp256k1.sign(keccak_256(unsigned), d.sk, { prehash: false, format: "recovered" });
  const signed = Buffer.concat([
    Buffer.of(2),
    rlp([
      ...(fields as never as Buffer[]),
      beMin(BigInt(sig[0] as number)),
      beMin(BigInt(`0x${Buffer.from(sig.subarray(1, 33)).toString("hex")}`)),
      beMin(BigInt(`0x${Buffer.from(sig.subarray(33, 65)).toString("hex")}`)),
    ] as never),
  ]);
  const hash = toHex(keccak_256(signed));
  await evm("eth_sendRawTransaction", [toHex(signed)]);
  return { hash, nonce };
}

async function evmReceipt(hash: string, ms = 180_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await evm<{
      status: string;
      blockNumber: string;
      contractAddress: string | null;
    } | null>("eth_getTransactionReceipt", [hash]).catch(() => null);
    if (r?.blockNumber) return r;
    await new Promise((x) => setTimeout(x, 4000));
  }
  throw new StopRun(`Sepolia transaction ${hash} not mined in time`);
}

async function evmFinal(hash: string, ms = 1_800_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await evmReceipt(hash);
    const fin = await evm<{ number: string }>("eth_getBlockByNumber", ["finalized", false]);
    if (BigInt(r.blockNumber) <= BigInt(fin.number)) return r;
    await new Promise((x) => setTimeout(x, 20_000));
  }
  throw new StopRun(`Sepolia transaction ${hash} not finalized in time`);
}

/** The EVM address the MPC signer derives for (the asset-key account, gen-N). */
async function genAddress(n: number) {
  const pk = await view<string>(SIGNER, "derived_public_key", {
    path: `gen-${n}`,
    predecessor: ASSET,
    domain_id: 0,
  });
  return addressOf(publicKeyFromSigner(pk));
}

const controllerOf = async (registry: string, tag: "latest" | "finalized" = "finalized") => {
  const out = await evm<string>("eth_call", [
    { to: registry, data: toHex(keccak_256(new TextEncoder().encode("controller()")).slice(0, 4)) },
    tag,
  ]);
  return `0x${out.slice(26).toLowerCase()}`;
};

function readSetup(): Json {
  return existsSync(SETUP_FILE) ? (JSON.parse(readFileSync(SETUP_FILE, "utf8")) as Json) : {};
}
function writeSetup(extra: Json) {
  const prior = readSetup();
  writeFileSync(
    SETUP_FILE,
    `${JSON.stringify(
      {
        format: "everstreet-v3-s4-setup",
        network: "testnet",
        other_chain: { name: SEPOLIA.name, chain_id: SEPOLIA.chain_id },
        commit: commit(),
        ...prior,
        ...extra,
        transactions: [...((prior.transactions as Json[]) ?? []), ...setupLog.splice(0)],
      },
      null,
      2,
    )}\n`,
  );
}

// ---------- setup: the fixed companions and a new Sepolia registry ----------

/** The series-3 app's records (the same business and people), copied once so they stay as recorded. */
function prepareAppDir() {
  if (existsSync(join(RUN_DIR, "config.json"))) return;
  const from = resolve("data", "runtime", "rehearsal-direct");
  cpSync(from, RUN_DIR, {
    recursive: true,
    filter: (p) => !/config-ext\.json$/.test(p),
  });
  const cfg = readFileSync(join(RUN_DIR, "config.json"), "utf8");
  const esc = (s: string) => JSON.stringify(s).slice(1, -1);
  writeFileSync(join(RUN_DIR, "config.json"), cfg.split(esc(from)).join(esc(RUN_DIR)));
  console.log(`✓ app records copied to ${RUN_DIR}`);
}

async function rootNear() {
  const v = await provider.viewAccount({ accountId: ROOT, blockQuery: { finality: "final" } });
  return Number(BigInt(v.amount) / 10n ** 21n) / 1000;
}

async function topUpNear(id: string, near: string) {
  const v = await provider.viewAccount({ accountId: id, blockQuery: { finality: "final" } });
  if (BigInt(v.amount) >= nearToYocto(near as `${number}`)) return;
  const r = await account(ROOT).signAndSendTransaction({
    receiverId: id,
    actions: [actions.transfer(nearToYocto(near as `${number}`))],
    waitUntil: "FINAL",
  });
  sent(`${near} NEAR to ${id} (gas)`, r.transaction.hash);
}

async function setup() {
  if (!existsSync(SPEND_FILE))
    writeFileSync(SPEND_FILE, JSON.stringify({ start: await rootNear() }));
  await spendGuard("setup start");
  const control = await view<Json>(BIZ, "get_control");
  if (control.owner !== OWNER || control.generation !== 3)
    throw new StopRun(`expected ${OWNER} at generation 3, saw ${JSON.stringify(control)}`);
  // The signer derives these for the new companion's account; it needn't exist yet.
  const addresses = Object.fromEntries(
    await Promise.all([3, 4].map(async (g) => [`gen-${g}`, await genAddress(g)])),
  ) as Record<string, string>;
  console.log("signer-derived addresses:", addresses);
  let registry = readSetup().registry?.address as string | undefined;
  if (!registry) {
    const d = deployerKey();
    const init = initCode(addresses["gen-3"] as string);
    const est = BigInt(
      await evm<string>("eth_estimateGas", [{ from: d.address, data: toHex(init) }]),
    );
    const { hash, nonce } = await deployerSend(null, 0n, init, (est * 5n) / 4n);
    sent("deploy the feed registry (controller: generation 3's address)", hash, "sepolia");
    const r = await evmReceipt(hash);
    if (r.status !== "0x1") throw new StopRun("the registry deployment failed");
    const expected = toHex(
      keccak_256(rlp([Buffer.from(d.address.slice(2), "hex"), beMin(nonce)])).slice(12),
    );
    registry = (r.contractAddress ?? expected).toLowerCase();
    if (registry !== expected.toLowerCase()) throw new StopRun("unexpected registry address");
    writeSetup({ registry: { address: registry, deploy_tx: hash, deployer: d.address } });
  }
  const ctl = await controllerOf(registry, "latest");
  if (ctl !== (addresses["gen-3"] as string).toLowerCase())
    throw new StopRun(`registry controller ${ctl} isn't generation 3's address`);
  console.log(`✓ registry ${registry}: controller ${ctl} (generation 3)`);
  // Test gas for the derived addresses that send: 3 publishes and moves the role; 4 publishes.
  for (const g of ["gen-3", "gen-4"]) {
    const a = addresses[g] as string;
    const bal = BigInt(await evm<string>("eth_getBalance", [a, "latest"]));
    if (bal >= 1_000_000_000_000_000n) continue;
    const value = 2_000_000_000_000_000n;
    const est = BigInt(
      await evm<string>("eth_estimateGas", [
        { from: deployerKey().address, to: a, value: `0x${value.toString(16)}` },
      ]),
    );
    const { hash } = await deployerSend(a, value, Buffer.alloc(0), (est * 5n) / 4n);
    sent(`0.002 test ETH to ${g}'s address ${a} (gas for its registry calls)`, hash, "sepolia");
    if ((await evmReceipt(hash)).status !== "0x1") throw new StopRun(`the transfer to ${g} failed`);
  }
  // The companions, both born locked; storage for the code plus room for state.
  const assetWasm = readWasm(WASM.asset_key);
  const allowWasm = readWasm(WASM.spend_allowance);
  const near = (bytes: number, extra: number) => (bytes / 100_000 + extra).toFixed(2);
  await createLocked(
    ASSET,
    near(assetWasm.length, 0.4),
    assetWasm,
    {
      business: BIZ,
      signer: SIGNER,
      chain_id: String(SEPOLIA.chain_id),
      registry,
      max_gas_limit: String(MAX_GAS_LIMIT),
      max_fee_per_gas: String(MAX_FEE),
    },
    codeHashOf(WASM.asset_key.sha256),
    "external asset key, fixed",
  );
  await createLocked(
    ALLOW,
    near(allowWasm.length, 0.4),
    allowWasm,
    { business: BIZ, token: TOKEN },
    codeHashOf(WASM.spend_allowance.sha256),
    "supplier allowance, fixed",
  );
  await createFull(AGENT, "0.3");
  await createFull(SUPPLIER, "0.2");
  await createFull(NEXT, "0.6");
  await topUpNear(OWNER, "0.5");
  for (const id of [ALLOW, AGENT, SUPPLIER, NEXT, OWNER]) await registerToken(TOKEN, id);
  await fundToken(TOKEN, ROOT, OWNER, 30_000_000n); // the allowance's budget
  await fundToken(TOKEN, ROOT, NEXT, 180_000_000n); // the price
  prepareAppDir();
  await spendGuard("setup end");
  writeSetup({
    business: BIZ,
    addresses,
    companions: {
      asset_key: {
        account: ASSET,
        wasm_sha256: WASM.asset_key.sha256,
        code_hash: codeHashOf(WASM.asset_key.sha256),
        signer: SIGNER,
        max_gas_limit: String(MAX_GAS_LIMIT),
        max_fee_per_gas: String(MAX_FEE),
      },
      spend_allowance: {
        account: ALLOW,
        wasm_sha256: WASM.spend_allowance.sha256,
        code_hash: codeHashOf(WASM.spend_allowance.sha256),
        token: TOKEN,
      },
      agent: AGENT,
      supplier: SUPPLIER,
      buyer: NEXT,
    },
  });
}

// ---------- the run, through the app ----------

function startApp(configFile: string) {
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

function httpClient(port: number): Call {
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

async function signIn(call: Call, accountId: string) {
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

const okBody = (r: { status: number; body: Json }, want: number[] | number, what: string) => {
  const w = Array.isArray(want) ? want : [want];
  if (!w.includes(r.status)) throw new StopRun(`${what}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

const digestOf = (text: string) => createHash("sha256").update(text).digest("hex");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run() {
  const setupRec = readSetup();
  const registry = setupRec.registry?.address as string;
  const addresses = setupRec.addresses as Record<string, string>;
  if (!registry || !addresses || !setupRec.companions) throw new StopRun("run setup first");
  const prior = existsSync(RUN_FILE) ? (JSON.parse(readFileSync(RUN_FILE, "utf8")) as Json) : null;
  if (prior?.outcome?.completed) throw new StopRun("the run is already recorded as complete");
  if (prior && process.argv[2] !== "resume")
    throw new StopRun("a stopped record exists: read it, then `resume` (recorded phases skip)");
  const resuming = process.argv[2] === "resume";
  const recorded = new Set(
    ((resuming ? (prior?.steps ?? []) : []) as Json[]).map((x) => x.step as string),
  );
  const done = (step: string) => recorded.has(step);
  await spendGuard("run start");
  prepareAppDir();

  const base = JSON.parse(readFileSync(join(RUN_DIR, "config.json"), "utf8")) as Json;
  const bizId = base.v3.bindings[0].business_id as string;
  const port = 8837;
  const cfgFile = join(RUN_DIR, "config-s4.json");
  writeFileSync(
    cfgFile,
    JSON.stringify({
      ...base,
      listen: { host: "127.0.0.1", port },
      companions: {
        evm: SEPOLIA,
        bindings: [{ business_id: bizId, asset: ASSET, allowance: ALLOW }],
      },
    }),
  );
  const app = startApp(cfgFile);
  await app.ready();
  const fresh = new Recorder({
    example: "companions-fixed",
    network: "testnet",
    label: "NEAR testnet",
    commit: commit(),
    contract: {
      account: BIZ,
      wasm_sha256: "ede1c2f7bed77d1832f5b16e8a873645b387693a486b42a745a06b6d510a29b4",
      code_hash_expected: "H1bHmRMXLKb6BY7UXH4fEzPyQ5vs5FMoXhA9Z3tMTUvw",
    },
    accounts: {
      owner_gen3: OWNER,
      buyer_gen4: NEXT,
      asset_key: ASSET,
      allowance: ALLOW,
      agent: AGENT,
      supplier: SUPPLIER,
      registry_sepolia: registry,
    },
    model: "stand-in (no model is used in this run)",
  });
  const rec = resuming
    ? Recorder.resume(prior as Json, { at: new Date().toISOString(), commit: commit() })
    : fresh;
  const accounts: Record<Who, string> = {
    founder: OWNER, // the seller in this run's sale
    buyer: NEXT,
    customer: SUPPLIER, // unused here
    prober: SUPPLIER, // unused here
  };
  const clients = new Map<string, Call>();
  const client = (id: string) => {
    if (!clients.has(id)) clients.set(id, httpClient(port));
    return clients.get(id) as Call;
  };
  const env = {
    label: "NEAR testnet" as const,
    accounts,
    operator: METER,
    business: { id: bizId, project: "", contract: BIZ },
    client: (who: Who) => client(accounts[who]),
    signIn: (who: Who, call: Call) => signIn(call, accounts[who]),
    wallet: (who: Who, call: WalletCall) => sendAs(accounts[who], call),
    views: async () => views(),
  };
  const tusd = (a: string) => view<string>(TOKEN, "ft_balance_of", { account_id: a });
  const views = async () => {
    const block = (await provider.viewBlock({ finality: "final" } as never)) as Json;
    return {
      block: { height: String(block.header.height), hash: block.header.hash },
      control: await view<Json>(BIZ, "get_control"),
      asset_key: await view<Json>(ASSET, "get_config"),
      signed_nonce: {
        "gen-3": await view<Json>(ASSET, "get_signed_nonce", { generation: 3 }),
        "gen-4": await view<Json>(ASSET, "get_signed_nonce", { generation: 4 }),
      },
      allowance: await view<Json>(ALLOW, "get_allowance"),
      registry: {
        source: "evm_rpc",
        controller_latest: await controllerOf(registry, "latest"),
        controller_finalized: await controllerOf(registry, "finalized"),
      },
      tusd: Object.fromEntries(
        await Promise.all([OWNER, NEXT, ALLOW, SUPPLIER].map(async (a) => [a, await tusd(a)])),
      ),
    };
  };
  const companionView = async (id: string) =>
    okBody(await client(id)(`/api/companions/${bizId}`), 200, "companions view");
  const signedOf = (value: string | null, step: string) => {
    const v = JSON.parse(value ?? "null") as Json;
    if (!v?.signature) throw new StopRun(`${step}: the companion returned no signature: ${value}`);
    return v;
  };
  /** One signed publish relayed by hand (the app relays only role moves). */
  const relay = async (
    step: string,
    asked: { action: Json; tx: Json },
    value: string | null,
    want: "final" | "reverted",
  ) => {
    const v = signedOf(value, step);
    const { signedTx } = await import("../server/src/evm.ts");
    const raw = signedTx(
      BigInt(SEPOLIA.chain_id),
      registry,
      asked.tx as never,
      asked.action as never,
      v.signature,
    );
    const hash = toHex(keccak_256(raw));
    await evm("eth_sendRawTransaction", [toHex(raw)]);
    const r = want === "final" ? await evmFinal(hash) : await evmReceipt(hash);
    rec.external(step, {
      chain: SEPOLIA.name,
      hash,
      explorer: `${EVM_EXPLORER}${hash}`,
      status: r.status === "0x1" ? (want === "final" ? "final" : "succeeded") : "reverted",
      block: String(BigInt(r.blockNumber)),
    });
    const expected = want === "final" ? "0x1" : "0x0";
    if (r.status !== expected)
      throw new StopRun(`${step}: Sepolia status ${r.status}, expected ${expected}`);
    return { raw, hash };
  };
  const roleOf = (id: string) =>
    (
      ({
        [OWNER]: "owner_gen3",
        [NEXT]: "buyer_gen4",
        [AGENT]: "agent",
        [SUPPLIER]: "supplier",
      }) as Record<string, string>
    )[id] as Who;
  const walletStep = async (step: string, who: string, call: WalletCall, facts: Json = {}) => {
    const out = await sendAs(who, call);
    rec.tx(step, roleOf(who), who, call, out, {
      ...(out.value ? { value: out.value.slice(0, 600) } : {}),
      refused: refusedValue(out),
      ...facts,
    });
    return out;
  };
  const askAsset = async (step: string, who: string, action: Json, tx: Json) => ({
    asked: { action, tx },
    ...(await walletStep(step, who, {
      receiverId: ASSET,
      methodName: "request",
      args: { action, tx },
      gas: "250000000000000",
      deposit: "1",
    })),
  });
  const txParams = async (address: string, nonce?: bigint) => {
    const n = nonce ?? BigInt(await evm<string>("eth_getTransactionCount", [address, "pending"]));
    const { tip, maxFee } = await evmFees();
    return {
      nonce: String(n),
      gas_limit: "200000",
      max_fee_per_gas: String(maxFee),
      max_priority_fee_per_gas: String(tip),
    };
  };
  /** Through the app: prepare, the wallet sends it, the app checks it by its own hash. */
  const appCompanion = async (who: string, kind: string, input: Json = {}) => {
    const c = client(who);
    const p = okBody(
      await c(`/api/companions/${bizId}/prepare`, "POST", { kind, input }),
      200,
      `prepare ${kind}`,
    );
    const out = await sendAs(who, p.call as WalletCall);
    const fin = okBody(
      await c(`/api/companions/actions/${p.id}/sent`, "POST", { tx_hash: out.hash }),
      200,
      `${kind} sent`,
    );
    rec.tx(`app_${kind}_by_${who.split(".")[0]}`, roleOf(who), who, p.call as WalletCall, out, {
      state: fin.state,
      evm_hash: fin.evm_hash ?? null,
      review: fin.review,
      result: fin.result,
    });
    return { prepared: p, out, done: fin };
  };
  const waitMoveFinal = async (who: string, generation: number) => {
    const end = Date.now() + 2_400_000;
    while (Date.now() < end) {
      const v = await companionView(who);
      if (v.asset?.move?.state === "external_final" && v.asset.controller_generation === generation)
        return v;
      if (v.asset?.move?.state === "external_failed")
        throw new StopRun("the role move failed on Sepolia");
      await sleep(30_000);
    }
    throw new StopRun("the role move didn't finalize on Sepolia in time");
  };
  const expectCode = (
    what: string,
    out: { ok: boolean; value: string | null; error?: string },
    code: string,
  ) => {
    const got = refusedValue(out);
    if (got !== code) throw new StopRun(`${what}: expected ${code}, saw ${got}`);
  };
  const g3 = addresses["gen-3"] as string;
  const g4 = addresses["gen-4"] as string;
  const grant = {
    agent: AGENT,
    suppliers: [SUPPLIER],
    per_payment: "2000000",
    per_period: "20000000",
    period_ms: "86400000",
    review_above: "5000000",
  };
  const payDeposit = async () =>
    String((await view<Json>(ALLOW, "get_allowance")).pay_deposit as string);
  const pay = async (step: string, amount: string, label: string, deposit?: string) => {
    const call = {
      receiverId: ALLOW,
      methodName: "pay",
      args: { supplier: SUPPLIER, amount, invoice: digestOf(label) },
      gas: "100000000000000",
      deposit: deposit ?? (await payDeposit()),
    };
    const out = await walletStep(step, AGENT, call, { invoice_label: label });
    return { out, code: refusedValue(out), invoice: digestOf(label) };
  };
  const heldFile = join(RUN_DIR, "held-publish.json");
  const awaiting = digestOf("fictional invoice SUP-406 7.00 tUSD");

  try {
    for (const id of [OWNER, NEXT]) await signIn(client(id), id);
    if (!resuming) await rec.checkpoint("start_generation_3", await views());
    const v0 = await companionView(OWNER);
    rec.app("companions_seen_by_owner_gen3", {
      controller_generation: v0.asset?.controller_generation,
      addresses: v0.asset?.addresses,
      allowance_active: v0.allowance?.active ?? null,
    });

    // ---- 1. Generation 3 publishes (nonce 0, the path's first signature); final on Sepolia.
    if (!done("registry_accepts_gen3_publish")) {
      const first = await askAsset(
        "asset_publish_gen3",
        OWNER,
        { kind: "publish", digest: digestOf("ledgerline-feed-s4-1") },
        await txParams(g3),
      );
      await relay("registry_accepts_gen3_publish", first.asked, first.value, "final");
    }

    // ---- 2. The fixes before any sale (attack review finding 1 and the nonce discipline).
    if (!done("owner_cannot_move_from_current_generation")) {
      // The owner signs ONE more publish (the next nonce) and keeps it unsent: the most an owner
      // about to sell can hold. Kept in the run folder (not evidence) until step 7.
      const held = await askAsset(
        "owner_holds_one_signed_publish",
        OWNER,
        { kind: "publish", digest: digestOf("ledgerline-feed-s4-held") },
        await txParams(g3),
      );
      signedOf(held.value, "held publish");
      writeFileSync(heldFile, JSON.stringify({ asked: held.asked, value: held.value }));
      const highest = BigInt(
        (await view<string>(ASSET, "get_signed_nonce", { generation: 3 })) as string,
      );
      // A stockpile of future nonces is refused: two past the highest signed.
      const ahead = await askAsset(
        "owner_cannot_sign_far_ahead",
        OWNER,
        { kind: "publish", digest: digestOf("ledgerline-feed-s4-ahead") },
        await txParams(g3, highest + 2n),
      );
      expectCode("a nonce two ahead", ahead, "E_NONCE");
      // A hand-over pre-signed before the close (from the current generation) is refused: there
      // is nothing to move, and the destination is never the caller's to name.
      const pre = await askAsset(
        "owner_cannot_move_from_current_generation",
        OWNER,
        { kind: "set_controller", from_generation: 3 },
        await txParams(g3),
      );
      expectCode("a move from the current generation", pre, "E_GENERATION");
      await rec.checkpoint("feed_fixes_shown", await views());
    }

    // ---- 3. The supplier allowance for generation 3 (attack review findings 4 to 6).
    if (!done("stranger_cannot_expire_early")) {
      await walletStep("allowance_grant_gen3", OWNER, {
        receiverId: ALLOW,
        methodName: "grant",
        args: grant,
        gas: "100000000000000",
        deposit: "0",
      });
      await walletStep("allowance_funded", OWNER, {
        receiverId: TOKEN,
        methodName: "ft_transfer_call",
        args: { receiver_id: ALLOW, amount: "30000000", msg: "fund" },
        gas: "100000000000000",
        deposit: "1",
      });
      const p1 = await pay(
        "agent_pays_within_cap",
        "1500000",
        "fictional invoice SUP-401 1.50 tUSD",
      );
      if (p1.code) throw new StopRun(`payment within cap refused: ${p1.code}`);
      const again = await pay(
        "agent_pays_same_invoice_again",
        "1500000",
        "fictional invoice SUP-401 1.50 tUSD",
      );
      if (again.code !== "E_REPLAY") throw new StopRun(`expected E_REPLAY, saw ${again.code}`);
      const nodep = await pay(
        "agent_pays_without_storage_deposit",
        "1000000",
        "fictional invoice SUP-402 1.00 tUSD",
        "0",
      );
      if (!nodep.code) throw new StopRun("a payment without its storage deposit went through");
      const p2 = await pay(
        "agent_pays_between_caps",
        "3000000",
        "fictional invoice SUP-403 3.00 tUSD",
      );
      if (p2.code !== "E_CAP") throw new StopRun(`expected E_CAP, saw ${p2.code}`);
      const p3 = await pay(
        "agent_pays_above_review",
        "6000000",
        "fictional invoice SUP-404 6.00 tUSD",
      );
      if (p3.code) throw new StopRun(`expected awaiting, saw ${p3.code}`);
      const stranger = await walletStep("stranger_cannot_approve", SUPPLIER, {
        receiverId: ALLOW,
        methodName: "approve",
        args: { invoice: p3.invoice },
        gas: "100000000000000",
        deposit: "0",
      });
      expectCode("a stranger's approval", stranger, "E_NOT_OWNER");
      const ok3 = await appCompanion(OWNER, "allowance_approve", { invoice: p3.invoice });
      rec.app("approved_invoice_paid", { result: ok3.done.result ?? null });
      const p4 = await pay(
        "agent_pays_above_review_2",
        "6500000",
        "fictional invoice SUP-405 6.50 tUSD",
      );
      if (p4.code) throw new StopRun(`expected awaiting, saw ${p4.code}`);
      const rej = await appCompanion(OWNER, "allowance_reject", { invoice: p4.invoice });
      rec.app("rejected_invoice", { result: rej.done.result ?? null });
      const p5 = await pay(
        "agent_pays_above_review_3",
        "7000000",
        "fictional invoice SUP-406 7.00 tUSD",
      );
      if (p5.code) throw new StopRun(`expected awaiting, saw ${p5.code}`);
      const early = await walletStep("stranger_cannot_expire_early", SUPPLIER, {
        receiverId: ALLOW,
        methodName: "expire_invoice",
        args: { invoice: p5.invoice },
        gas: "30000000000000",
        deposit: "0",
      });
      expectCode("an early expiry", early, "E_NOT_EXPIRED");
      await rec.checkpoint("allowance_gen3", await views());
    }

    // ---- 4. The sale: noor-v3s3 (generation 3) to ines-v3s4 (generation 4), tUSD escrow.
    const s = steps(env as never, rec, 120_000);
    const nowControl = await view<Json>(BIZ, "get_control");
    if (nowControl.owner === OWNER) {
      await s.act(
        "founder",
        client(OWNER),
        "propose",
        {
          buyer_account: NEXT,
          price: "180000000",
          expires_in_days: 7,
          available_floor: "0",
          grants: [{ account: METER, caps: 1 }],
          exclusions: ["The ledgerline.example domain and its DNS account"],
          note: "Fictional terms for series 4: the fixed companions follow the sale.",
        },
        "series4-propose-01",
        { satisfiedBy: "deal_live" },
      );
      const ines = client(NEXT);
      await s.act("buyer", ines, "register", {}, "series4-register-01", {
        satisfiedBy: "registered",
      });
      await s.act("buyer", ines, "fund", {}, "series4-fund-01", { satisfiedBy: "funded" });
      await s.act("buyer", ines, "accept", {}, "series4-accept-01", {
        satisfiedBy: "already_accepted",
      });
      await rec.checkpoint("before_close", await views());
      const close = await s.act("founder", client(OWNER), "accept", {}, "series4-close-01");
      if (close?.resolution?.result !== "closed") throw new StopRun("the sale didn't close");
    } else
      rec.app("sale_already_closed", {
        owner: nowControl.owner,
        generation: nowControl.generation,
      });
    await rec.checkpoint("closed_generation_4", await views());

    // ---- 5. The seller after the close: everything refused.
    if (!done("former_owner_cannot_move")) {
      const after = await pay(
        "agent_pays_after_close",
        "1000000",
        "fictional invoice SUP-407 1.00 tUSD",
      );
      if (after.code !== "E_GRANT_ENDED")
        throw new StopRun(`expected E_GRANT_ENDED, saw ${after.code}`);
      const lateApprove = await walletStep("former_owner_approve_after_close", OWNER, {
        receiverId: ALLOW,
        methodName: "approve",
        args: { invoice: awaiting },
        gas: "100000000000000",
        deposit: "0",
      });
      expectCode("the former owner's approval", lateApprove, "E_NOT_OWNER");
      const lateGrant = await walletStep("former_owner_grant_refused", OWNER, {
        receiverId: ALLOW,
        methodName: "grant",
        args: grant,
        gas: "100000000000000",
        deposit: "0",
      });
      expectCode("the former owner's grant", lateGrant, "E_NOT_OWNER");
      const latePub = await askAsset(
        "former_owner_cannot_publish",
        OWNER,
        { kind: "publish", digest: digestOf("ledgerline-feed-s4-late") },
        await txParams(g3),
      );
      expectCode("the former owner's publish", latePub, "E_NOT_OWNER");
      const lateMove = await askAsset(
        "former_owner_cannot_move",
        OWNER,
        { kind: "set_controller", from_generation: 3 },
        await txParams(g3),
      );
      expectCode("the former owner's move", lateMove, "E_NOT_OWNER");
    }

    // ---- 6. The buyer: the role moves to generation 4's own address (through the app).
    if (!done("role_move_final_gen4")) {
      const move = await appCompanion(NEXT, "feed_move");
      if (move.done.state !== "external_pending")
        throw new StopRun(`the move is ${move.done.state}, not pending on Sepolia`);
      rec.app("move_destination_derived", {
        reviewed_to: (move.prepared.review as Json)?.to_address ?? null,
        gen4_address: g4,
        named_by_caller: (move.prepared.call as Json).args.action.to ?? null,
      });
      const moved = await waitMoveFinal(NEXT, 4);
      rec.external("role_move_final_gen4", {
        chain: SEPOLIA.name,
        hash: move.done.evm_hash,
        explorer: `${EVM_EXPLORER}${move.done.evm_hash}`,
        status: "final",
        controller_generation: moved.asset.controller_generation,
      });
      const ctl = await controllerOf(registry, "finalized");
      if (ctl !== g4.toLowerCase())
        throw new StopRun(`controller ${ctl} isn't generation 4's address`);
      await rec.checkpoint("role_at_generation_4", await views());
    }

    // ---- 7. The publish the seller held from before the close: refused now.
    if (!done("held_publish_after_move")) {
      const held = JSON.parse(readFileSync(heldFile, "utf8")) as Json;
      const v = signedOf(held.value, "held publish");
      const { signedTx } = await import("../server/src/evm.ts");
      const raw = signedTx(
        BigInt(SEPOLIA.chain_id),
        registry,
        held.asked.tx,
        held.asked.action,
        v.signature,
      );
      const hash = toHex(keccak_256(raw));
      const answer = await evm("eth_sendRawTransaction", [toHex(raw)]).then(
        () => "accepted",
        (e: Error) => e.message,
      );
      let status = /nonce too low|already known/i.test(answer) ? "refused" : answer;
      if (answer === "accepted") {
        const r = await evmReceipt(hash);
        status = r.status === "0x1" ? "succeeded" : "reverted";
      }
      rec.external("held_publish_after_move", {
        chain: SEPOLIA.name,
        hash,
        status,
        rpc_answer: answer.slice(0, 200),
        nonce: held.asked.tx.nonce,
      });
      if (status === "succeeded")
        throw new StopRun("the seller's held publish landed after the move");
    }

    // ---- 8. The buyer publishes from generation 4's address; the registry accepts it.
    if (!done("registry_latest_gen4")) {
      const digest = digestOf("ledgerline-feed-s4-gen4");
      const pub = await askAsset(
        "asset_publish_gen4",
        NEXT,
        { kind: "publish", digest },
        await txParams(g4),
      );
      await relay("registry_accepts_gen4_publish", pub.asked, pub.value, "final");
      const latest = await evm<string>("eth_call", [
        { to: registry, data: toHex(keccak_256(new TextEncoder().encode("latest()")).slice(0, 4)) },
        "finalized",
      ]);
      rec.external("registry_latest_gen4", {
        chain: SEPOLIA.name,
        status: "final",
        latest,
        expected: `0x${digest}`,
      });
      if (latest !== `0x${digest}`)
        throw new StopRun("the registry doesn't hold the published digest");
    }

    // ---- 9. The buyer's allowance: re-granted through the app; the old grant's invoice can't
    // be paid under it.
    if (!done("agent_pays_under_new_grant")) {
      const regrant = await appCompanion(NEXT, "allowance_grant");
      rec.app("buyer_regranted", { result: regrant.done.result ?? null });
      const old = await walletStep("old_grant_invoice_refused", NEXT, {
        receiverId: ALLOW,
        methodName: "approve",
        args: { invoice: awaiting },
        gas: "100000000000000",
        deposit: "0",
      });
      expectCode("an invoice from the old grant", old, "E_GRANT_ENDED");
      const p6 = await pay(
        "agent_pays_under_new_grant",
        "1000000",
        "fictional invoice SUP-408 1.00 tUSD",
      );
      if (p6.code) throw new StopRun(`payment under the new grant refused: ${p6.code}`);
    }
    await rec.checkpoint("series4_done", await views());
    rec.write(RUN_FILE, { completed: true });
    console.log("✓ series 4 complete");
  } catch (e) {
    rec.write(RUN_FILE, { completed: false, reason: (e as Error).message.slice(0, 600) });
    console.log(`app log (last part):\n${app.log().slice(-3000)}`);
    throw e;
  } finally {
    await spendGuard("run end").catch(() => {});
    await app.stop();
  }
  console.log(`evidence: ${RUN_FILE}`);
}

function refusedValue(out: { ok: boolean; value: string | null; error?: string }) {
  return !out.ok
    ? (/E_[A-Z_]+/.exec(out.error ?? "")?.[0] ?? "failed")
    : (/E_[A-Z_]+/.exec(out.value ?? "")?.[0] ?? null);
}

const cmd = process.argv[2];
try {
  if (cmd === "setup") await setup();
  else if (cmd === "run" || cmd === "resume") await run();
  else {
    console.error("usage: series4.ts setup | run | resume");
    process.exit(2);
  }
} catch (e) {
  if (setupLog.length) writeSetup({});
  console.error(`STOPPED: ${(e as Error).message}`);
  process.exit(1);
}
