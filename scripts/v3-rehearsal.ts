// business-v3 on NEAR testnet: the approved rehearsal (docs/design/V3_TESTNET_APPROVAL_PACKET.md;
// Tony approved it in chat on Nov 5 2026). Fictional, script-held testnet accounts; the labelled
// stand-in model (no AI provider); evidence without keys or customer content.
//
//   npx tsx scripts/v3-rehearsal.ts setup-direct   accounts, the locked business, tUSD
//   npx tsx scripts/v3-rehearsal.ts run-direct     example 1 through the app's own routes
//
// Each command refuses to repeat a write it has already made (idempotent setup; the run refuses
// an existing run directory). Stop conditions (packet §4) end the run with a partial record.

import { type ChildProcess, execFileSync, fork } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { baseEncode } from "near-api-js";
import { validateConfig } from "../server/src/appConfig.ts";
import { nep413Digest } from "../server/src/identity.ts";
import {
  account,
  actions,
  EXPLORER,
  exists,
  KeyPair,
  nearToYocto,
  provider,
  ROOT,
  RPC,
  saveKey,
  secretKeyOf,
  teraToGas,
  view,
} from "./lib/near.ts";
import { Recorder } from "./lib/rehearsal/evidence.ts";
import {
  type Call,
  type Env,
  type Json,
  runDirect,
  StopRun,
  type Who,
} from "./lib/rehearsal/journey.ts";

const TOKEN = "tusd.everstreet.testnet";
const WASM_SHA256 = "f2ec5a4bbefc5f01aea349df25ec98b56c3f1c19399b26731620e775997e778f";
const CODE_HASH = "HMGhGxrpnKJfxBSwovHmvd1zoKv5nw4hSGp3s6qhxM7C";
const CEILING_NEAR = 20;
const DIRECT = {
  business: `ledgerline-v3-1.${ROOT}`,
  founder: `founder-v3.${ROOT}`,
  buyer: `buyer-v3.${ROOT}`,
  customer: `cara-v3-1.${ROOT}`,
  meter: `meter-direct-v3.${ROOT}`,
};
const METER_METHODS = ["open_hold", "settle_hold", "release_hold_for"];
const RULES = {
  min_reserve: "750000",
  max_hold_units: 1,
  max_hold_ttl_ms: "600000",
  max_settle_grace_ms: "480000",
};
const EVIDENCE_DIR = "data/evidence";
const SPEND_FILE = join("data", "runtime", "rehearsal-spend.json");

const commit = () => {
  try {
    return readFileSync(".git/HEAD", "utf8").startsWith("ref:")
      ? readFileSync(join(".git", readFileSync(".git/HEAD", "utf8").slice(5).trim()), "utf8").trim()
      : readFileSync(".git/HEAD", "utf8").trim();
  } catch {
    return "unknown";
  }
};
const near = async (a: string) =>
  Number(
    BigInt(
      (await provider.viewAccount({ accountId: a, blockQuery: { finality: "final" } })).amount,
    ) /
      10n ** 21n,
  ) / 1000;

/** Packet §4: the root's NEAR spent since the rehearsal began may not pass the ceiling. */
async function spendGuard(stage: string) {
  mkdirSync(join("data", "runtime"), { recursive: true });
  const now = await near(ROOT);
  const s = existsSync(SPEND_FILE)
    ? (JSON.parse(readFileSync(SPEND_FILE, "utf8")) as { start: number })
    : { start: now };
  if (!existsSync(SPEND_FILE)) writeFileSync(SPEND_FILE, JSON.stringify(s));
  const spent = s.start - now;
  console.log(`  spend check (${stage}): ${spent.toFixed(3)} of ${CEILING_NEAR} testnet NEAR`);
  if (spent > CEILING_NEAR) throw new StopRun(`spend ceiling passed at ${stage}: ${spent} NEAR`);
}

function readV3Wasm(): Buffer {
  const wasm = execFileSync(
    "wsl",
    [
      "-d",
      process.env.WSL_DISTRO ?? "Ubuntu",
      "--",
      "bash",
      "-c",
      "cat ~/everstreet-target/near/business_v3/business_v3.wasm",
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const sha = createHash("sha256").update(wasm).digest();
  if (sha.toString("hex") !== WASM_SHA256 || baseEncode(sha) !== CODE_HASH)
    throw new StopRun(`the local wasm (${sha.toString("hex")}) isn't the reviewed build`);
  return wasm;
}

async function setupDirect() {
  await spendGuard("setup start");
  const root = account(ROOT);
  const setupLog: Json[] = [];
  const sent = (what: string, hash: string) => {
    setupLog.push({ what, hash, explorer: `${EXPLORER}${hash}` });
    console.log(`+ ${what}: ${EXPLORER}${hash}`);
  };
  for (const id of [DIRECT.founder, DIRECT.buyer, DIRECT.customer]) {
    if (await exists(id)) {
      console.log(`✓ ${id} exists`);
      continue;
    }
    const key = KeyPair.fromRandom("ed25519");
    saveKey(id, key);
    const r = await root.signAndSendTransaction({
      receiverId: id,
      actions: [
        actions.createAccount(),
        actions.transfer(nearToYocto("0.5")),
        actions.addFullAccessKey(key.getPublicKey()),
      ],
      waitUntil: "FINAL",
    });
    sent(`create ${id}`, r.transaction.hash);
  }
  if (await exists(DIRECT.meter)) console.log(`✓ ${DIRECT.meter} exists`);
  else {
    // The platform's metering account: ONLY a function-call key, to this business, these methods.
    const key = KeyPair.fromRandom("ed25519");
    saveKey(DIRECT.meter, key);
    const r = await root.signAndSendTransaction({
      receiverId: DIRECT.meter,
      actions: [
        actions.createAccount(),
        actions.transfer(nearToYocto("0.5")),
        actions.addFunctionCallAccessKey(
          key.getPublicKey(),
          DIRECT.business,
          METER_METHODS,
          nearToYocto("0.4"),
        ),
      ],
      waitUntil: "FINAL",
    });
    sent(`create ${DIRECT.meter} (function-call key only)`, r.transaction.hash);
  }
  if (await exists(DIRECT.business)) console.log(`✓ ${DIRECT.business} exists`);
  else {
    const wasm = readV3Wasm();
    await spendGuard("before deploy");
    const r = await root.signAndSendTransaction({
      receiverId: DIRECT.business,
      actions: [
        actions.createAccount(),
        actions.transfer(nearToYocto("4.3")),
        actions.deployContract(wasm),
        actions.functionCall(
          "new",
          { name: "Ledgerline", owner: DIRECT.founder, asset: TOKEN, rules: RULES, closer: null },
          teraToGas(100),
          0n,
        ),
      ],
      waitUntil: "FINAL",
    });
    sent(`deploy and init ${DIRECT.business} (born locked: no key)`, r.transaction.hash);
  }
  // Verify what was deployed, at final finality.
  const acc = await provider.viewAccount({
    accountId: DIRECT.business,
    blockQuery: { finality: "final" },
  });
  if (acc.code_hash !== CODE_HASH)
    throw new StopRun(`deployed code ${acc.code_hash} isn't ${CODE_HASH}`);
  const keys = (await provider.query({
    request_type: "view_access_key_list",
    account_id: DIRECT.business,
    finality: "final",
  } as never)) as unknown as { keys: unknown[] };
  if (keys.keys.length !== 0) throw new StopRun(`${DIRECT.business} has access keys: not locked`);
  const control = await view<Json>(DIRECT.business, "get_control");
  if (control.owner !== DIRECT.founder) throw new StopRun(`owner is ${control.owner}`);
  console.log(
    `✓ code hash ${CODE_HASH}, no keys, owner ${control.owner}, generation ${control.generation}`,
  );
  // tUSD: registrations paid by the root, then test balances.
  for (const id of [DIRECT.business, DIRECT.founder, DIRECT.buyer, DIRECT.customer]) {
    const reg = await view<Json | null>(TOKEN, "storage_balance_of", { account_id: id });
    if (reg) continue;
    const r = await root.signAndSendTransaction({
      receiverId: TOKEN,
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
    sent(`register ${id} with tUSD`, r.transaction.hash);
  }
  for (const [id, want] of [
    [DIRECT.customer, 20_000_000n],
    [DIRECT.buyer, 300_000_000n],
  ] as const) {
    const have = BigInt(await view<string>(TOKEN, "ft_balance_of", { account_id: id }));
    if (have >= want) continue;
    const r = await root.signAndSendTransaction({
      receiverId: TOKEN,
      actions: [
        actions.functionCall(
          "ft_transfer",
          { receiver_id: id, amount: String(want - have) },
          teraToGas(30),
          1n,
        ),
      ],
      waitUntil: "FINAL",
    });
    sent(`fund ${id} with ${(want - have) / 1_000_000n} tUSD`, r.transaction.hash);
  }
  await spendGuard("setup end");
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const prior = existsSync(join(EVIDENCE_DIR, "v3-setup-testnet.json"))
    ? (JSON.parse(readFileSync(join(EVIDENCE_DIR, "v3-setup-testnet.json"), "utf8")) as Json)
        .transactions
    : [];
  writeFileSync(
    join(EVIDENCE_DIR, "v3-setup-testnet.json"),
    JSON.stringify(
      {
        format: "everstreet-v3-rehearsal-setup",
        network: "testnet",
        commit: commit(),
        contract: {
          account: DIRECT.business,
          wasm_sha256: WASM_SHA256,
          code_hash: CODE_HASH,
          access_keys: 0,
        },
        accounts: DIRECT,
        metering_key: {
          receiver: DIRECT.business,
          methods: METER_METHODS,
          allowance_near: "0.4",
          full_access_keys: 0,
        },
        rules: RULES,
        transactions: [...prior, ...setupLog],
      },
      null,
      2,
    ),
  );
}

// ---------- the live run ----------

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

async function runDirectLive() {
  const dir = join("data", "runtime", "rehearsal-direct");
  if (existsSync(join(dir, "everstreet.db")))
    throw new StopRun(
      `${dir} already holds a run: resolve it (writer history) before starting another`,
    );
  mkdirSync(join(dir, "protected"), { recursive: true });
  await spendGuard("run start");
  const port = 8830;
  writeFileSync(
    join(dir, "protected-keys.json"),
    JSON.stringify({ k1: randomBytes(32).toString("base64") }),
  );
  writeFileSync(
    join(dir, "ai.json"),
    JSON.stringify({
      config_version: "rehearsal-standin-1",
      provider: "anthropic",
      model: "claude-haiku-5-5",
      pricing_version: "2026-11-02",
      operator_ceiling_cents: 100,
      runtime_operator_ceiling_cents: 100,
    }),
  );
  const base = (bound: string | null) => ({
    config_version: 1,
    mode: "configured",
    network: "testnet",
    listen: { host: "127.0.0.1", port },
    database: join(dir, "everstreet.db"),
    sign_in: { recipient: "everstreet.local", session_hours: 8 },
    rpc: { endpoint: RPC },
    ...(bound ? { v3: { bindings: [{ business_id: bound, account: DIRECT.business }] } } : {}),
    customer: {
      operator_account: DIRECT.meter,
      writer: { key_file: join(".near-credentials", "testnet", `${DIRECT.meter}.json`) },
    },
    protected_storage: {
      root: join(dir, "protected"),
      active_key_id: "k1",
      keys_file: join(dir, "protected-keys.json"),
    },
    model: { ai_config_file: join(dir, "ai.json"), api_key_env: "EVERSTREET_REHEARSAL_MODEL_KEY" },
    maintenance: {
      enabled: true,
      interval_ms: 3_000,
      batch: 5,
      pass_budget_ms: 10_000,
      op_deadline_ms: 8_000,
      stop_timeout_ms: 15_000,
    },
    operators: { accounts: [DIRECT.founder] },
  });
  const configFile = join(dir, "config.json");
  // Boot 1: no binding yet; the founder creates the business through the Studio route.
  let cfg: Json = base(null);
  try {
    validateConfig(cfg);
  } catch {
    const { customer: _c, ...rest } = cfg;
    cfg = rest; // the customer section needs a binding: the first boot runs without it
    validateConfig(cfg);
  }
  writeFileSync(configFile, JSON.stringify(cfg));
  let app = startApp(configFile);
  await app.ready();
  const founderCall = httpClient(port);
  await signIn(founderCall, DIRECT.founder);
  const made = await founderCall("/api/product-projects", "POST", {
    idea: "Turn invoices into clean, checked JSON for an accounting tool",
    foundation: "ai_api",
    name: "Ledgerline",
  });
  if (made.status !== 201)
    throw new StopRun(`project: ${made.status} ${JSON.stringify(made.body)}`);
  const list = (await founderCall("/api/product-projects")).body.projects as Json[];
  const proj =
    list.find((p) => p.business_name === "Ledgerline" || p.name === "Ledgerline") ?? list[0];
  if (!proj) throw new StopRun("no project after creating it");
  await app.stop();
  // Boot 2: bound to the deployed business.
  writeFileSync(configFile, JSON.stringify(base(proj.business_id as string)));
  validateConfig(JSON.parse(readFileSync(configFile, "utf8")));
  app = startApp(configFile);
  await app.ready();

  const accounts: Record<Who, string> = {
    founder: DIRECT.founder,
    buyer: DIRECT.buyer,
    customer: DIRECT.customer,
  };
  const clients = new Map<Who, Call>();
  const env: Env = {
    label: "NEAR testnet",
    accounts,
    operator: DIRECT.meter,
    business: {
      id: proj.business_id as string,
      project: proj.id as string,
      contract: DIRECT.business,
    },
    client: (who) => {
      if (!clients.has(who)) clients.set(who, httpClient(port));
      return clients.get(who) as Call;
    },
    signIn: (who, call) => signIn(call, accounts[who]),
    wallet: async (who, call) => {
      await spendGuard(`before ${call.methodName}`);
      const r = await account(accounts[who]).signAndSendTransaction({
        receiverId: call.receiverId,
        actions: [
          actions.functionCall(call.methodName, call.args, BigInt(call.gas), BigInt(call.deposit)),
        ],
        waitUntil: "FINAL",
        throwOnFailure: false,
      });
      const failure = (r.status as { Failure?: unknown }).Failure;
      console.log(
        `  ${who} ${call.methodName}: ${EXPLORER}${r.transaction.hash}${failure ? " (FAILED)" : ""}`,
      );
      return {
        hash: r.transaction.hash,
        ok: failure === undefined,
        error: failure === undefined ? undefined : JSON.stringify(failure).slice(0, 400),
        receipts: r.receipts_outcome.map((o) => ({
          executor: o.outcome.executor_id,
          status: Object.keys(o.outcome.status as object)[0],
          logs: o.outcome.logs.filter((l) => l.startsWith("EVENT_JSON")).slice(0, 4),
        })),
      };
    },
    views: async () => {
      const block = await provider.viewBlock({ finality: "final" } as never);
      return {
        block: { height: String((block as Json).header.height), hash: (block as Json).header.hash },
        control: await view<Json>(DIRECT.business, "get_control"),
        treasury: await view<Json>(DIRECT.business, "get_treasury"),
        entitlement: await view<Json | null>(DIRECT.business, "get_entitlement", {
          customer: DIRECT.customer,
          plan_id: 1,
        }).catch(() => null),
        tusd: Object.fromEntries(
          await Promise.all(
            [DIRECT.customer, DIRECT.business, DIRECT.founder, DIRECT.buyer].map(async (a) => [
              a,
              await view<string>(TOKEN, "ft_balance_of", { account_id: a }),
            ]),
          ),
        ),
      };
    },
  };
  const rec = new Recorder({
    example: "direct",
    network: "testnet",
    label: "NEAR testnet",
    commit: commit(),
    contract: { account: DIRECT.business, wasm_sha256: WASM_SHA256, code_hash_expected: CODE_HASH },
    accounts: { ...accounts, operator: DIRECT.meter },
    model: "stand-in (scripted answers; no AI provider called)",
  });
  const out = join(EVIDENCE_DIR, "v3-direct-testnet.json");
  try {
    const r = await runDirect(env, rec);
    console.log(`✓ example 1 complete: ${JSON.stringify(r)}`);
    rec.write(out, { completed: true });
  } catch (e) {
    rec.write(out, { completed: false, reason: (e as Error).message.slice(0, 600) });
    console.log(`app log (last part):\n${app.log().slice(-3000)}`);
    throw e;
  } finally {
    await spendGuard("run end").catch(() => {});
    await app.stop();
  }
  console.log(`evidence: ${out}`);
}

const cmd = process.argv[2];
try {
  if (cmd === "setup-direct") await setupDirect();
  else if (cmd === "run-direct") await runDirectLive();
  else {
    console.error("usage: v3-rehearsal.ts setup-direct | run-direct");
    process.exit(2);
  }
} catch (e) {
  console.error(`STOPPED: ${(e as Error).message}`);
  process.exit(1);
}
