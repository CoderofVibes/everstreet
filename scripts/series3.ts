// Testnet series 3, the parts beyond the three sale examples (scripts/v3-rehearsal.ts): the
// business's two companions with the external asset on a real EVM testnet (Sepolia) and NEAR's
// real MPC signer, and a second sale whose escrow is funded from another token through NEAR's
// intents verifier (deployed here from its reproducible build). Fictional, script-held accounts;
// test tokens; faucet test ETH only. Evidence without keys.
//
//   npx tsx scripts/series3.ts setup-ext       companions, Sepolia registry, gas for the
//                                              signer-derived addresses
//   npx tsx scripts/series3.ts setup-intents   the verifier, tALT, the solver and the next buyer
//   npx tsx scripts/series3.ts run-ext         through the app: role moves, allowance, refusals,
//                                              the intents-funded sale, the second shift
//
// The business is the Direct example's (ledgerline-v3-3b): sold by founder-v3s3 (generation 1)
// to buyer-v3s3 (generation 2), who sells it again here to noor-v3s3 (generation 3).

import { type ChildProcess, execFileSync, fork } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
const SELLER = `founder-v3s3.${ROOT}`; // generation 1
const OWNER = `buyer-v3s3.${ROOT}`; // generation 2 (bought it in the Direct example)
const NEXT = `noor-v3s3.${ROOT}`; // generation 3 (buys it here, funding from tALT)
const CUSTOMER = `cara-v3s3-1.${ROOT}`;
const METER = `meter-direct-v3s3b.${ROOT}`;
const ASSET = `feed-key-v3s3.${ROOT}`;
const ALLOW = `budget-v3s3.${ROOT}`;
const AGENT = `agent-v3s3.${ROOT}`;
const SUPPLIER = `supplier-v3s3.${ROOT}`;
const VERIFIER = `intents-v3s3.${ROOT}`;
const TALT = `talt-v3s3.${ROOT}`;
const SOLVER = `solver-v3s3.${ROOT}`;
const FT_GLOBAL_HASH = "3vaopJ7aRoivvzZLngPQRBEd8VJr2zPLTxQfnRCoFgNX";

const SEPOLIA = {
  name: "Sepolia",
  chain_id: 11155111,
  rpc: process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com",
};
const EVM_EXPLORER = "https://sepolia.etherscan.io/tx/";
// Sepolia now prices new state far above the old schedule (a fresh storage slot alone costs
// over 100k gas), so the per-transaction gas cap is set generously; fees stay at test-ETH cents.
const MAX_GAS_LIMIT = 1_000_000n;
const MAX_FEE = 100_000_000_000n; // 100 gwei: the asset-key's ceiling per gas

const WASM = {
  asset_key: {
    file: "contracts/target/near/asset_key/asset_key.wasm",
    sha256: "0593b0f92d8280e04c97e543d7784ad3c6623964d28c3ef9c071eb9d71a4d693",
  },
  spend_allowance: {
    file: "contracts/target/near/spend_allowance/spend_allowance.wasm",
    sha256: "4b0a422fe93c9dabc55d47b7e119f59e1bb16b1bf7532bd833b063626a72bda2",
  },
  verifier: {
    wsl: "~/vendor/near-intents/target/near/defuse/defuse.wasm",
    sha256: "257b53c5ba0deff95ca870c7de944d92d6617eeae65f008782b6d95a513193c8",
  },
};
const codeHashOf = (sha256Hex: string) => baseEncode(Buffer.from(sha256Hex, "hex"));

const EVIDENCE = "data/evidence";
const SETUP_FILE = join(EVIDENCE, "v3-ext-setup-testnet.json");
const RUN_FILE = join(EVIDENCE, "v3-ext-testnet.json");
const RUN_DIR = resolve("data", "runtime", "rehearsal-direct");
const SPEND_FILE = join("data", "runtime", "rehearsal-spend-s3.json");
const CEILING_NEAR = 45;

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
        format: "everstreet-v3-ext-setup",
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

// ---------- setup: companions and the Sepolia registry ----------

async function setupExt() {
  await spendGuard("ext setup start");
  const control = await view<Json>(BIZ, "get_control");
  if (control.owner !== OWNER || control.generation !== 2)
    throw new StopRun(`expected ${OWNER} at generation 2, saw ${JSON.stringify(control)}`);
  const addresses = Object.fromEntries(
    await Promise.all([1, 2, 3].map(async (g) => [`gen-${g}`, await genAddress(g)])),
  ) as Record<string, string>;
  console.log("signer-derived addresses:", addresses);
  // The registry, first controller = generation 1's address (the seller's, before the sale).
  let registry = readSetup().registry?.address as string | undefined;
  if (!registry) {
    const d = deployerKey();
    const init = initCode(addresses["gen-1"] as string);
    const est = BigInt(
      await evm<string>("eth_estimateGas", [{ from: d.address, data: toHex(init) }]),
    );
    const { hash, nonce } = await deployerSend(null, 0n, init, (est * 5n) / 4n);
    sent("deploy the feed registry (controller: generation 1's address)", hash, "sepolia");
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
  if (ctl !== (addresses["gen-1"] as string).toLowerCase())
    throw new StopRun(`registry controller ${ctl} isn't generation 1's address`);
  console.log(`✓ registry ${registry}: controller ${ctl} (generation 1)`);
  // Test gas for the derived addresses that will send (1 moves the role; 2 publishes and moves).
  for (const g of ["gen-1", "gen-2", "gen-3"]) {
    const a = addresses[g] as string;
    const bal = BigInt(await evm<string>("eth_getBalance", [a, "latest"]));
    if (bal >= 2_000_000_000_000_000n) continue;
    // A transfer that creates an account is priced above the old flat 21,000 gas now: estimate.
    const est = BigInt(
      await evm<string>("eth_estimateGas", [
        { from: deployerKey().address, to: a, value: toHex(beMin(3_000_000_000_000_000n)) },
      ]),
    );
    const { hash } = await deployerSend(
      a,
      3_000_000_000_000_000n,
      Buffer.alloc(0),
      (est * 5n) / 4n,
    );
    sent(`0.003 test ETH to ${g}'s address ${a} (gas for its registry calls)`, hash, "sepolia");
    if ((await evmReceipt(hash)).status !== "0x1") throw new StopRun(`the transfer to ${g} failed`);
  }
  // The companions, both born locked.
  await createLocked(
    ASSET,
    "2.2",
    readWasm(WASM.asset_key),
    {
      business: BIZ,
      signer: SIGNER,
      chain_id: String(SEPOLIA.chain_id),
      registry,
      max_gas_limit: String(MAX_GAS_LIMIT),
      max_fee_per_gas: String(MAX_FEE),
    },
    codeHashOf(WASM.asset_key.sha256),
    "external asset key",
  );
  await createLocked(
    ALLOW,
    "2.6",
    readWasm(WASM.spend_allowance),
    { business: BIZ, token: TOKEN },
    codeHashOf(WASM.spend_allowance.sha256),
    "supplier allowance",
  );
  await createFull(AGENT, "0.3");
  await createFull(SUPPLIER, "0.2");
  for (const id of [ALLOW, AGENT, SUPPLIER]) await registerToken(TOKEN, id);
  await spendGuard("ext setup end");
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
    },
  });
}

// ---------- setup: the intents verifier, tALT, the solver, the next buyer ----------

async function setupIntents() {
  await spendGuard("intents setup start");
  await createLocked(
    VERIFIER,
    "13.6",
    readWasm(WASM.verifier),
    {
      config: { wnear_id: "wrap.testnet", fees: { fee: 0, fee_collector: ROOT }, roles: {} },
    },
    codeHashOf(WASM.verifier.sha256),
    "NEAR's intents verifier, reproducible build",
  );
  if (!(await exists(TALT))) {
    const r = await account(ROOT).signAndSendTransaction({
      receiverId: TALT,
      actions: [
        actions.createAccount(),
        actions.transfer(nearToYocto("0.5")),
        // biome-ignore lint/correctness/useHookAtTopLevel: a NEAR transaction action, not a React hook
        actions.useGlobalContract({
          codeHash: Uint8Array.from(
            (await import("near-api-js")).baseDecode(FT_GLOBAL_HASH) as Uint8Array,
          ),
        }),
        actions.functionCall(
          "new",
          {
            owner_id: ROOT,
            total_supply: (1_000_000n * 10n ** 6n).toString(),
            metadata: {
              spec: "ft-1.0.0",
              name: "Test Alt (testnet, no value)",
              symbol: "tALT",
              decimals: 6,
            },
          },
          teraToGas(50),
          0n,
        ),
      ],
      waitUntil: "FINAL",
    });
    sent(`create ${TALT} (test token, no keys)`, r.transaction.hash);
  } else console.log(`✓ ${TALT} exists`);
  await createFull(SOLVER, "0.6");
  await createFull(NEXT, "0.6");
  for (const [t, id] of [
    [TOKEN, VERIFIER],
    [TALT, VERIFIER],
    [TOKEN, SOLVER],
    [TOKEN, NEXT],
    [TALT, NEXT],
  ] as const)
    await registerToken(t, id);
  await fundToken(TALT, ROOT, NEXT, 400_000_000n); // 400 tALT; the sale is 250 tUSD at 5/4
  // The solver's float of tUSD, held inside the verifier, and its signing key registered there.
  const inside = BigInt(
    await view<string>(VERIFIER, "mt_balance_of", {
      account_id: SOLVER,
      token_id: `nep141:${TOKEN}`,
    }),
  );
  if (inside < 300_000_000n) {
    await fundToken(TOKEN, ROOT, SOLVER, 300_000_000n - inside);
    const r = await sendAs(SOLVER, {
      receiverId: TOKEN,
      methodName: "ft_transfer_call",
      args: { receiver_id: VERIFIER, amount: String(300_000_000n - inside), msg: "" },
      gas: String(100_000_000_000_000n),
      deposit: "1",
    });
    sent("the solver deposits its tUSD float into the verifier", r.hash);
  }
  const solverKey = KeyPair.fromString(secretKeyOf(SOLVER)).getPublicKey().toString();
  if (
    !(await view<boolean>(VERIFIER, "has_public_key", {
      account_id: SOLVER,
      public_key: solverKey,
    }))
  ) {
    const r = await sendAs(SOLVER, {
      receiverId: VERIFIER,
      methodName: "add_public_key",
      args: { public_key: solverKey },
      gas: String(30_000_000_000_000n),
      deposit: "1",
    });
    sent("the solver registers its signing key with the verifier", r.hash);
  }
  await spendGuard("intents setup end");
  writeSetup({
    intents: {
      verifier: {
        account: VERIFIER,
        source:
          "github.com/near/intents @ 32cd1f9788a347908164fbcc56525dc6542f158f, contracts/defuse 0.4.5",
        wasm_sha256: WASM.verifier.sha256,
        code_hash: codeHashOf(WASM.verifier.sha256),
        config: { wnear_id: "wrap.testnet", fee: 0, roles: "none" },
      },
      give_token: { account: TALT, symbol: "tALT", decimals: 6 },
      rate: { num: "5", den: "4", meaning: "5 tALT for 4 tUSD" },
      solver: SOLVER,
      next_buyer: NEXT,
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

async function runExt() {
  const setup = readSetup();
  const registry = setup.registry?.address as string;
  const addresses = setup.addresses as Record<string, string>;
  if (!registry || !addresses || !setup.intents)
    throw new StopRun("run setup-ext and setup-intents first");
  const prior = existsSync(RUN_FILE) ? (JSON.parse(readFileSync(RUN_FILE, "utf8")) as Json) : null;
  if (prior?.outcome?.completed) throw new StopRun("the run is already recorded as complete");
  // resume-ext continues a stopped record; every phase already in it is skipped, never repeated.
  const resuming = process.argv[2] === "resume-ext";
  if (resuming && !prior) throw new StopRun("nothing to resume");
  const recorded = new Set(
    ((resuming ? (prior?.steps ?? []) : []) as Json[]).map((x) => x.step as string),
  );
  const done = (step: string) => recorded.has(step);
  await spendGuard("ext run start");

  // The Direct example's app records (same database), now with companions and intents bound.
  const base = JSON.parse(readFileSync(join(RUN_DIR, "config.json"), "utf8")) as Json;
  const bizId = base.v3.bindings[0].business_id as string;
  const port = 8836;
  const cfgFile = join(RUN_DIR, "config-ext.json");
  writeFileSync(
    cfgFile,
    JSON.stringify({
      ...base,
      listen: { host: "127.0.0.1", port },
      companions: {
        evm: SEPOLIA,
        bindings: [{ business_id: bizId, asset: ASSET, allowance: ALLOW }],
      },
      intents: {
        verifier: VERIFIER,
        solver: {
          account: SOLVER,
          key_file: resolve(".near-credentials", "testnet", `${SOLVER}.json`),
        },
        bindings: [
          {
            business_id: bizId,
            asset: TOKEN,
            offers: [{ token: TALT, symbol: "tALT", decimals: 6, rate_num: "5", rate_den: "4" }],
          },
        ],
      },
    }),
  );
  const app = startApp(cfgFile);
  await app.ready();
  const fresh = new Recorder({
    example: "external",
    network: "testnet",
    label: "NEAR testnet",
    commit: commit(),
    contract: {
      account: BIZ,
      wasm_sha256: "ede1c2f7bed77d1832f5b16e8a873645b387693a486b42a745a06b6d510a29b4",
      code_hash_expected: "H1bHmRMXLKb6BY7UXH4fEzPyQ5vs5FMoXhA9Z3tMTUvw",
    },
    accounts: {
      seller_gen1: SELLER,
      owner_gen2: OWNER,
      buyer_gen3: NEXT,
      asset_key: ASSET,
      allowance: ALLOW,
      agent: AGENT,
      supplier: SUPPLIER,
      verifier: VERIFIER,
      solver: SOLVER,
      give_token: TALT,
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
    customer: CUSTOMER,
    prober: CUSTOMER,
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
  /** One external transaction relayed by hand (not through the app): the raw bytes to Sepolia. */
  const relay = async (
    step: string,
    asked: { action: Json; tx: Json },
    value: string | null,
    want: "final" | "reverted",
  ) => {
    const v = JSON.parse(value ?? "null") as Json;
    if (!v?.signature) throw new StopRun(`${step}: the companion returned no signature: ${value}`);
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
        [SELLER]: "seller_gen1",
        [OWNER]: "owner_gen2",
        [NEXT]: "buyer_gen3",
        [AGENT]: "agent",
      }) as Record<string, string>
    )[id] as Who;
  const walletStep = async (step: string, who: string, call: WalletCall) => {
    const out = await sendAs(who, call);
    const role = roleOf(who);
    rec.tx(step, role, who, call, out, out.value ? { value: out.value.slice(0, 600) } : null);
    return out;
  };
  const askAsset = async (who: string, action: Json, tx: Json) => ({
    asked: { action, tx },
    ...(await walletStep(`asset_request_${action.kind}_by_${who.split(".")[0]}`, who, {
      receiverId: ASSET,
      methodName: "request",
      args: { action, tx },
      gas: "250000000000000",
      deposit: "1",
    })),
  });
  const txParams = async (address: string) => {
    const nonce = BigInt(await evm<string>("eth_getTransactionCount", [address, "pending"]));
    const { tip, maxFee } = await evmFees();
    return {
      nonce: String(nonce),
      gas_limit: "200000",
      max_fee_per_gas: String(maxFee),
      max_priority_fee_per_gas: String(tip),
    };
  };
  /** Through the app: prepare, the owner's wallet sends it, the app checks it by its own hash. */
  const appCompanion = async (who: string, kind: string, input: Json = {}) => {
    const c = client(who);
    const p = okBody(
      await c(`/api/companions/${bizId}/prepare`, "POST", { kind, input }),
      200,
      `prepare ${kind}`,
    );
    const out = await sendAs(who, p.call as WalletCall);
    const done = okBody(
      await c(`/api/companions/actions/${p.id}/sent`, "POST", { tx_hash: out.hash }),
      200,
      `${kind} sent`,
    );
    const role = roleOf(who);
    rec.tx(`app_${kind}_by_${who.split(".")[0]}`, role, who, p.call as WalletCall, out, {
      state: done.state,
      evm_hash: done.evm_hash ?? null,
      review: done.review,
      result: done.result,
    });
    return { prepared: p, out, done };
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
  const refusedValue = (out: { ok: boolean; value: string | null; error?: string }) =>
    !out.ok
      ? (/E_[A-Z_]+/.exec(out.error ?? "")?.[0] ?? "failed")
      : (/E_[A-Z_]+/.exec(out.value ?? "")?.[0] ?? null);

  try {
    for (const id of [OWNER, SELLER, NEXT]) await signIn(client(id), id);
    await rec.checkpoint("start_generation_2", await views());
    const v0 = await companionView(OWNER);
    rec.app("companions_seen_by_owner_gen2", {
      controller_generation: v0.asset?.controller_generation,
      addresses: v0.asset?.addresses,
      allowance_active: v0.allowance?.active ?? null,
    });
    if (!resuming && v0.asset?.controller_generation !== 1)
      throw new StopRun("expected the role at generation 1");

    // ---- 1. Before the move: generation 2 publishing is refused by the registry itself.
    const g2 = addresses["gen-2"] as string;
    if (!done("registry_latest")) {
      const early = await askAsset(
        OWNER,
        { kind: "publish", digest: digestOf("ledgerline-feed-early") },
        await txParams(g2),
      );
      await relay("registry_refuses_gen2_before_move", early.asked, early.value, "reverted");

      // ---- 2. The former owner (generation 1) asks to move the role: refused on NEAR.
      const g1 = addresses["gen-1"] as string;
      const sellerTry = await askAsset(
        SELLER,
        { kind: "set_controller", to: g1.slice(2), from_generation: 1 },
        await txParams(g1),
      );
      const sellerCode = refusedValue(sellerTry);
      rec.app("former_owner_refused_by_asset_key", { code: sellerCode });
      if (sellerCode !== "E_NOT_OWNER")
        throw new StopRun(`expected E_NOT_OWNER, saw ${sellerCode}`);

      // ---- 3. The owner moves the role through the app; final on Sepolia.
      const move = await appCompanion(OWNER, "feed_move");
      if (move.done.state !== "external_pending")
        throw new StopRun(`the move is ${move.done.state}, not pending on Sepolia`);
      const moved = await waitMoveFinal(OWNER, 2);
      rec.external("role_move_final", {
        chain: SEPOLIA.name,
        hash: move.done.evm_hash,
        explorer: `${EVM_EXPLORER}${move.done.evm_hash}`,
        status: "final",
        controller_generation: moved.asset.controller_generation,
      });
      await rec.checkpoint("role_at_generation_2", await views());

      // ---- 4. A replay of the same signed move is refused by Sepolia (its nonce is spent).
      const answer = JSON.parse(move.out.value ?? "null") as Json;
      const { signedTx } = await import("../server/src/evm.ts");
      const replayRaw = signedTx(
        BigInt(SEPOLIA.chain_id),
        registry,
        (move.prepared.call as Json).args.tx,
        (move.prepared.call as Json).args.action,
        answer.signature,
      );
      const replay = await evm("eth_sendRawTransaction", [toHex(replayRaw)]).then(
        () => "accepted",
        (e: Error) => e.message,
      );
      rec.external("replay_of_the_move", {
        chain: SEPOLIA.name,
        hash: toHex(keccak_256(replayRaw)),
        status: /nonce too low|already known/i.test(replay) ? "refused" : replay,
        rpc_answer: replay.slice(0, 200),
      });

      // ---- 5. Generation 2 publishes; the registry accepts it now.
      const digest = digestOf("ledgerline-feed-2026-11-07");
      const pub = await askAsset(OWNER, { kind: "publish", digest }, await txParams(g2));
      await relay("registry_accepts_gen2_publish", pub.asked, pub.value, "final");
      const latest = await evm<string>("eth_call", [
        { to: registry, data: toHex(keccak_256(new TextEncoder().encode("latest()")).slice(0, 4)) },
        "finalized",
      ]);
      rec.external("registry_latest", {
        chain: SEPOLIA.name,
        status: "final",
        latest,
        expected: `0x${digest}`,
      });
      if (latest !== `0x${digest}`)
        throw new StopRun("the registry doesn't hold the published digest");
    }

    // ---- 6. The supplier allowance for generation 2.
    const grant = {
      agent: AGENT,
      suppliers: [SUPPLIER],
      per_payment: "2000000",
      per_period: "10000000",
      period_ms: "86400000",
      review_above: "5000000",
    };
    const pay = async (step: string, amount: string, label: string) => {
      const out = await sendAs(AGENT, {
        receiverId: ALLOW,
        methodName: "pay",
        args: { supplier: SUPPLIER, amount, invoice: digestOf(label) },
        gas: "100000000000000",
        deposit: "0",
      });
      rec.tx(
        step,
        roleOf(AGENT),
        AGENT,
        {
          receiverId: ALLOW,
          methodName: "pay",
          args: { supplier: SUPPLIER, amount, invoice: digestOf(label) },
          gas: "100000000000000",
          deposit: "0",
        },
        out,
        { value: out.value, refused: refusedValue(out) },
      );
      return { out, code: refusedValue(out), invoice: digestOf(label) };
    };
    if (!done("former_owner_grant_refused")) {
      await walletStep("allowance_grant_gen2", OWNER, {
        receiverId: ALLOW,
        methodName: "grant",
        args: grant,
        gas: "100000000000000",
        deposit: "0",
      });
      await walletStep("allowance_funded", OWNER, {
        receiverId: TOKEN,
        methodName: "ft_transfer_call",
        args: { receiver_id: ALLOW, amount: "20000000", msg: "fund" },
        gas: "100000000000000",
        deposit: "1",
      });
      const p1 = await pay(
        "agent_pays_within_cap",
        "1500000",
        "fictional invoice SUP-101 1.50 tUSD",
      );
      if (p1.code) throw new StopRun(`payment within cap refused: ${p1.code}`);
      const p2 = await pay(
        "agent_pays_between_caps",
        "3000000",
        "fictional invoice SUP-102 3.00 tUSD",
      );
      if (p2.code !== "E_CAP") throw new StopRun(`expected E_CAP, saw ${p2.code}`);
      const p3 = await pay(
        "agent_pays_above_review",
        "6000000",
        "fictional invoice SUP-103 6.00 tUSD",
      );
      const awaiting = await companionView(OWNER);
      rec.app("awaiting_owner_approval", {
        awaiting: (awaiting.allowance?.awaiting ?? []).map((x: Json) => x.invoice),
      });
      await appCompanion(OWNER, "allowance_approve", { invoice: p3.invoice });
      const sellerGrant = await sendAs(SELLER, {
        receiverId: ALLOW,
        methodName: "grant",
        args: grant,
        gas: "100000000000000",
        deposit: "0",
      });
      rec.tx(
        "former_owner_grant_refused",
        roleOf(SELLER),
        SELLER,
        {
          receiverId: ALLOW,
          methodName: "grant",
          args: grant,
          gas: "100000000000000",
          deposit: "0",
        },
        sellerGrant,
        { refused: refusedValue(sellerGrant) },
      );
      if (refusedValue(sellerGrant) !== "E_NOT_OWNER")
        throw new StopRun("the former owner's grant wasn't refused");
      await rec.checkpoint("allowance_gen2", await views());
    }

    // ---- 7. The sale to the next buyer, escrow funded from tALT through the intents verifier.
    const s = steps(env as never, rec, 120_000);
    await s.act(
      "founder",
      client(OWNER),
      "propose",
      {
        buyer_account: NEXT,
        price: "250000000",
        expires_in_days: 7,
        available_floor: "0",
        grants: [{ account: METER, caps: 1 }],
        exclusions: ["The ledgerline.example domain and its DNS account"],
        note: "Fictional terms for series 3: escrow funded from another token.",
      },
      "series3-propose-01",
      { satisfiedBy: "deal_live" },
    );
    await s.act("buyer", client(NEXT), "register", {}, "series3-register-01", {
      satisfiedBy: "registered",
    });
    const noor = client(NEXT);
    let f: Json;
    if (done("intents_quoted")) {
      f = ((prior?.steps ?? []) as Json[]).find((x) => x.step === "intents_quoted")?.facts as Json;
    } else {
      const panel = okBody(await noor(`/api/sales/${bizId}/intents`), 200, "intents panel");
      rec.app("intents_offer", { offers: panel.offers, verifier: panel.verifier ?? VERIFIER });
      f = okBody(
        await noor(`/api/sales/${bizId}/intents/quote`, "POST", { token: TALT }),
        200,
        "quote",
      );
      rec.app("intents_quoted", {
        id: f.id,
        give: f.give,
        get: f.get,
        stage: f.stage,
        solver: f.solver ?? null,
      });
    }
    if (!done("intents_swapped")) {
      await walletStep("intents_deposit", NEXT, {
        receiverId: TALT,
        methodName: "ft_transfer_call",
        args: { receiver_id: VERIFIER, amount: f.give.amount, msg: "" },
        gas: "100000000000000",
        deposit: "1",
      });
      const key = KeyPair.fromString(secretKeyOf(NEXT));
      const submit = async () => {
        const digest = nep413Digest({
          message: f.sign.message,
          nonce: Buffer.from(f.sign.nonce, "base64"),
          recipient: f.sign.recipient,
          callbackUrl: null,
        });
        return noor(`/api/intents/${f.id}/sign`, "POST", {
          public_key: key.getPublicKey().toString(),
          signature: Buffer.from(key.sign(digest).signature).toString("base64"),
          callback_url: null,
        });
      };
      let signed = await submit();
      if (signed.status === 409 && signed.body?.code === "key_not_registered") {
        rec.app("intents_key_not_registered", { code: signed.body.code });
        await walletStep("intents_register_key", NEXT, {
          receiverId: VERIFIER,
          methodName: "add_public_key",
          args: { public_key: key.getPublicKey().toString() },
          gas: "30000000000000",
          deposit: "1",
        });
        signed = await submit();
      }
      const sw = okBody(signed, 200, "intents sign");
      rec.app("intents_swapped", { stage: sw.stage, exec_hash: sw.exec_hash ?? null });
      if (sw.stage !== "swapped") throw new StopRun(`expected swapped, saw ${sw.stage}`);
    } else {
      // The solver's answer was lost: the verifier's spent-nonce record decides, read by the app.
      const st = okBody(await noor(`/api/intents/${f.id}`), 200, "intents status");
      rec.app("intents_resolved_by_spent_nonce", {
        stage: st.stage,
        exec_hash: st.exec_hash ?? null,
      });
      if (st.stage !== "swapped")
        throw new StopRun(`expected swapped after the nonce check, saw ${st.stage}`);
    }
    await walletStep("intents_withdraw", NEXT, {
      receiverId: VERIFIER,
      methodName: "ft_withdraw",
      args: { token: TOKEN, receiver_id: NEXT, amount: f.get.amount },
      gas: "100000000000000",
      deposit: "1",
    });
    const delivered = okBody(await noor(`/api/intents/${f.id}`), 200, "intents status");
    rec.app("intents_delivered", { stage: delivered.stage });
    await s.act("buyer", noor, "fund", {}, "series3-fund-01", { satisfiedBy: "funded" });
    const funded = okBody(await noor(`/api/intents/${f.id}`), 200, "intents status");
    rec.app("intents_funded", { stage: funded.stage });
    if (funded.stage !== "funded") throw new StopRun(`expected funded, saw ${funded.stage}`);
    await rec.checkpoint("escrow_funded_from_talt", await views());
    await s.act("buyer", noor, "accept", {}, "series3-accept-01", {
      satisfiedBy: "already_accepted",
    });
    const close = await s.act("founder", client(OWNER), "accept", {}, "series3-close-01");
    if (close?.resolution?.result !== "closed") throw new StopRun("the sale didn't close");
    await rec.checkpoint("closed_generation_3", await views());

    // ---- 8. The second shift: generation 2's grant has ended; the new owner re-grants and moves.
    const p4 = await pay(
      "agent_pays_after_close",
      "1000000",
      "fictional invoice SUP-104 1.00 tUSD",
    );
    if (p4.code !== "E_GRANT_ENDED") throw new StopRun(`expected E_GRANT_ENDED, saw ${p4.code}`);
    const oldGrant = await sendAs(OWNER, {
      receiverId: ALLOW,
      methodName: "grant",
      args: grant,
      gas: "100000000000000",
      deposit: "0",
    });
    rec.tx(
      "previous_owner_grant_refused",
      roleOf(OWNER),
      OWNER,
      {
        receiverId: ALLOW,
        methodName: "grant",
        args: grant,
        gas: "100000000000000",
        deposit: "0",
      },
      oldGrant,
      { refused: refusedValue(oldGrant) },
    );
    if (refusedValue(oldGrant) !== "E_NOT_OWNER")
      throw new StopRun("the previous owner's grant wasn't refused");
    await appCompanion(NEXT, "allowance_grant");
    const p5 = await pay(
      "agent_pays_under_new_grant",
      "1000000",
      "fictional invoice SUP-105 1.00 tUSD",
    );
    if (p5.code) throw new StopRun(`payment under the new grant refused: ${p5.code}`);
    const prevTry = await askAsset(
      OWNER,
      { kind: "set_controller", to: g2.slice(2), from_generation: 2 },
      await txParams(g2),
    );
    rec.app("previous_owner_refused_by_asset_key", { code: refusedValue(prevTry) });
    if (refusedValue(prevTry) !== "E_NOT_OWNER")
      throw new StopRun("the previous owner's move wasn't refused");
    const move3 = await appCompanion(NEXT, "feed_move");
    if (move3.done.state !== "external_pending") throw new StopRun(`move 3 is ${move3.done.state}`);
    const moved3 = await waitMoveFinal(NEXT, 3);
    rec.external("role_move_final_gen3", {
      chain: SEPOLIA.name,
      hash: move3.done.evm_hash,
      explorer: `${EVM_EXPLORER}${move3.done.evm_hash}`,
      status: "final",
      controller_generation: moved3.asset.controller_generation,
    });
    await rec.checkpoint("second_shift_done", await views());
    rec.write(RUN_FILE, { completed: true });
    console.log("✓ series 3 external asset, allowance and intents run complete");
  } catch (e) {
    rec.write(RUN_FILE, { completed: false, reason: (e as Error).message.slice(0, 600) });
    console.log(`app log (last part):\n${app.log().slice(-3000)}`);
    throw e;
  } finally {
    await spendGuard("ext run end").catch(() => {});
    await app.stop();
  }
  console.log(`evidence: ${RUN_FILE}`);
}

const cmd = process.argv[2];
try {
  if (cmd === "setup-ext") await setupExt();
  else if (cmd === "setup-intents") await setupIntents();
  else if (cmd === "run-ext" || cmd === "resume-ext") await runExt();
  else {
    console.error("usage: series3.ts setup-ext | setup-intents | run-ext");
    process.exit(2);
  }
} catch (e) {
  if (setupLog.length) writeSetup({});
  console.error(`STOPPED: ${(e as Error).message}`);
  process.exit(1);
}
