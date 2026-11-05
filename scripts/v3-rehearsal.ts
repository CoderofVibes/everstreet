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
import { join, resolve } from "node:path";
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
import { type RecoveryEnv, runGated, runRecovery } from "./lib/rehearsal/examples.ts";
import {
  type Call,
  type DeviceKey,
  type Env,
  type Json,
  loadDeviceKey,
  newDeviceKey,
  runDirect,
  runDirectSale,
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
    send: (m: Json) => {
      if (proc.connected) proc.send(m);
    },
    onMessage: (fn: (m: Json) => void) => proc.on("message", fn),
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

function liveEnv(port: number, business: { id: string; project: string }) {
  const accounts: Record<Who, string> = {
    founder: DIRECT.founder,
    buyer: DIRECT.buyer,
    customer: DIRECT.customer,
    prober: DIRECT.customer,
  };
  const clients = new Map<Who, Call>();
  const env: Env = {
    label: "NEAR testnet",
    accounts,
    operator: DIRECT.meter,
    business: {
      id: business.id,
      project: business.project,
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
  return { env, rec, accounts };
}

async function runDirectLive() {
  const dir = resolve("data", "runtime", "rehearsal-direct");
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
      writer: { key_file: resolve(".near-credentials", "testnet", `${DIRECT.meter}.json`) },
    },
    protected_storage: {
      root: join(dir, "protected"),
      active_key_id: "k1",
      keys_file: join(dir, "protected-keys.json"),
    },
    model: { ai_config_file: join(dir, "ai.json"), api_key_env: "EVERSTREET_REHEARSAL_MODEL_KEY" },
    maintenance: {
      enabled: true,
      interval_ms: 20_000,
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

  const { env, rec } = liveEnv(port, {
    id: proj.business_id as string,
    project: proj.id as string,
  });
  const out = join(EVIDENCE_DIR, "v3-direct-testnet.json");
  try {
    const r = await runDirect(env, rec, {
      keepDeviceKey: (k) => writeFileSync(join(dir, "device-key.pem"), k.pem, { mode: 0o600 }),
    });
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

/**
 * Resumes a stopped example 1 from its sale phase, on the same database and evidence record.
 * The customer's device key from the first process is gone: as a real customer would, the lost key
 * is revoked (guarded: only this exact key at this epoch) and a new one installed in slot 1; both
 * transactions are in the record.
 */
async function resumeDirectLive() {
  const dir = resolve("data", "runtime", "rehearsal-direct");
  const configFile = join(dir, "config.json");
  const out = join(EVIDENCE_DIR, "v3-direct-testnet.json");
  if (!existsSync(join(dir, "everstreet.db")) || !existsSync(out))
    throw new StopRun("nothing to resume");
  const prior = JSON.parse(readFileSync(out, "utf8")) as Json;
  if (prior.outcome?.completed) throw new StopRun("example 1 already completed");
  await spendGuard("resume start");
  const cfg = JSON.parse(readFileSync(configFile, "utf8")) as Json;
  const port = cfg.listen.port as number;
  const app = startApp(configFile);
  await app.ready();
  const bizId = cfg.v3.bindings[0].business_id as string;
  // The project id, from the CURRENT owner's own list (the founder before the close, the buyer after).
  const ownerNow = (await view<Json>(DIRECT.business, "get_control")).owner as string;
  const ownerCall = httpClient(port);
  await signIn(ownerCall, ownerNow);
  const proj = ((await ownerCall("/api/product-projects")).body.projects as Json[]).find(
    (x) => x.business_id === bizId,
  );
  if (!proj) throw new StopRun("the project isn't listed");
  const { env } = liveEnv(port, { id: bizId, project: proj.id as string });
  const rec = Recorder.resume(prior, { at: new Date().toISOString(), commit: commit() });
  try {
    for (const w of ["founder", "customer", "buyer"] as const) await env.signIn(w, env.client(w));
    const owner = env.client(ownerNow === DIRECT.buyer ? "buyer" : "founder");
    const cara = env.client("customer");
    // Context, from the app's own routes and the earlier record.
    const offers = (await owner(`/api/businesses/${bizId}/customer-offers`)).body.offers as Json[];
    const offer = offers.find((o) => o.state === "active");
    if (!offer) throw new StopRun("no active offer");
    const firstReq = (await cara("/api/customer/requests/by-key/rehearsal-use-00001")).body as Json;
    const firstUse = (firstReq.use?.id ?? firstReq.request?.id ?? firstReq.id) as
      | string
      | undefined;
    if (!firstUse)
      throw new StopRun(`the first use isn't found: ${JSON.stringify(firstReq).slice(0, 300)}`);
    const release1 = (prior.steps as Json[]).find((x) => x.step === "release_1")?.facts;
    const evals = (await owner(`/api/product-projects/${proj.id}/evaluations`)).body as Json;
    const runs = (evals.runs ?? evals.evaluations ?? []) as Json[];
    const evalRun = runs.find((r) => r.artifact_job === release1?.artifact_job);
    if (!release1 || !evalRun) throw new StopRun("the first release's evaluation isn't found");
    const before = await env.views();
    if (!before.control?.live_deal && before.control?.owner !== DIRECT.buyer)
      throw new StopRun("neither a live proposal nor a closed sale on the contract");
    // The lost device key: revoke exactly it (guarded), then install a replacement in slot 1.
    let key: DeviceKey;
    let slot = 0;
    const pemFile = join(dir, "device-key.pem");
    if (existsSync(pemFile)) {
      key = loadDeviceKey(readFileSync(pemFile, "utf8"));
      // Its slot, from the contract: the active key with exactly this public key.
      const k = ((before.entitlement as Json).keys as Json[]).find(
        (x) => x.state === "active" && x.public_key === key.pk,
      );
      if (!k) throw new StopRun("the kept device key isn't active on the contract");
      slot = k.slot as number;
      rec.app("device_key_kept", { slot, note: "the key kept privately by the earlier attempt" });
    } else {
      const e = before.entitlement as Json;
      const k0 = (e.keys as Json[])[0] as Json;
      const revoke = {
        receiverId: DIRECT.business,
        methodName: "revoke_key_guarded",
        args: { plan_id: 1, slot: 0, reg_id: String(e.reg_id), epoch: k0.epoch, pk: k0.public_key },
        gas: "30000000000000",
        deposit: "1",
      };
      const rv = await env.wallet("customer", revoke);
      rec.tx("device_key_lost_revoked", "customer", DIRECT.customer, revoke, rv, null);
      if (!rv.ok) throw new StopRun(`revoking the lost key failed: ${rv.error}`);
      key = newDeviceKey();
      writeFileSync(pemFile, key.pem, { mode: 0o600 });
      slot = 1;
      const install = {
        receiverId: DIRECT.business,
        methodName: "install_key",
        args: { plan_id: 1, slot, pk: key.pk, max_hold_units: 1, max_units_per_day: 100 },
        gas: "30000000000000",
        deposit: "1",
      };
      const ins = await env.wallet("customer", install);
      rec.tx("device_key_replacement_installed", "customer", DIRECT.customer, install, ins, null);
      if (!ins.ok) throw new StopRun(`installing the new key failed: ${ins.error}`);
      await rec.checkpoint("device_key_replaced", await env.views());
    }
    const r = await runDirectSale(
      env,
      rec,
      {
        offer: offer.id as string,
        firstUse,
        usesBefore: 20,
        jobId: release1.artifact_job as string,
        evalRunId: evalRun.id as string,
        key,
        slot,
      },
      { signedIn: true, proposed: true },
    );
    console.log(`✓ example 1 complete: ${JSON.stringify(r)}`);
    rec.write(out, { completed: true });
  } catch (e) {
    rec.write(out, { completed: false, reason: (e as Error).message.slice(0, 600) });
    console.log(`app log (last part):
${app.log().slice(-3000)}`);
    throw e;
  } finally {
    await spendGuard("resume end").catch(() => {});
    await app.stop();
  }
  console.log(`evidence: ${out}`);
}

// ---------- examples 2-4 (live) ----------

interface Example {
  name: "gated" | "recovery";
  business: string;
  founder: string;
  buyer: string;
  customer: string;
  prober?: string;
  meter: string;
  closer?: string;
  /** Accounts the setup registers with tUSD (the recovery seller is left for the app to register). */
  register: string[];
  fund: [string, bigint][];
}
const GATED: Example = {
  name: "gated",
  business: `ledgerline-gated-v3-1.${ROOT}`,
  founder: `founder-v3.${ROOT}`,
  buyer: `buyer-v3.${ROOT}`,
  customer: `cara-v3-2.${ROOT}`,
  prober: `cara-v3-2b.${ROOT}`,
  meter: `meter-gated-v3.${ROOT}`,
  closer: `closer-gated-v3.${ROOT}`,
  register: [`ledgerline-gated-v3-1.${ROOT}`, `cara-v3-2.${ROOT}`, `cara-v3-2b.${ROOT}`],
  fund: [
    [`cara-v3-2.${ROOT}`, 20_000_000n],
    [`cara-v3-2b.${ROOT}`, 1_000_000n],
    [`buyer-v3.${ROOT}`, 100_000_000n],
  ],
};
const RECOVERY: Example = {
  name: "recovery",
  business: `ledgerline-payout-v3-1.${ROOT}`,
  founder: `founder-p-v3.${ROOT}`,
  buyer: `buyer-v3.${ROOT}`,
  customer: `cara-v3-3.${ROOT}`,
  meter: `meter-payout-v3.${ROOT}`,
  register: [`ledgerline-payout-v3-1.${ROOT}`, `cara-v3-3.${ROOT}`],
  fund: [
    [`cara-v3-3.${ROOT}`, 5_000_000n],
    [`buyer-v3.${ROOT}`, 100_000_000n],
  ],
};

async function setupExample(ex: Example) {
  await spendGuard(`${ex.name} setup start`);
  const root = account(ROOT);
  const log: Json[] = [];
  const sent = (what: string, hash: string) => {
    log.push({ what, hash, explorer: `${EXPLORER}${hash}` });
    console.log(`+ ${what}: ${EXPLORER}${hash}`);
  };
  for (const id of [ex.founder, ex.customer, ...(ex.prober ? [ex.prober] : [])]) {
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
        actions.transfer(nearToYocto("0.2")),
        actions.addFullAccessKey(key.getPublicKey()),
      ],
      waitUntil: "FINAL",
    });
    sent(`create ${id}`, r.transaction.hash);
  }
  // Function-call-only accounts: the metering account and (Gated) the closer.
  const fcOnly: [string, string[]][] = [[ex.meter, METER_METHODS]];
  if (ex.closer) fcOnly.push([ex.closer, ["close_sale"]]);
  for (const [id, methods] of fcOnly) {
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
        actions.transfer(nearToYocto("0.3")),
        actions.addFunctionCallAccessKey(
          key.getPublicKey(),
          ex.business,
          methods,
          nearToYocto("0.25"),
        ),
      ],
      waitUntil: "FINAL",
    });
    sent(`create ${id} (function-call key only: ${methods.join(", ")})`, r.transaction.hash);
  }
  if (await exists(ex.business)) console.log(`✓ ${ex.business} exists`);
  else {
    const wasm = readV3Wasm();
    await spendGuard(`${ex.name} before deploy`);
    const r = await root.signAndSendTransaction({
      receiverId: ex.business,
      actions: [
        actions.createAccount(),
        actions.transfer(nearToYocto("4.3")),
        actions.deployContract(wasm),
        actions.functionCall(
          "new",
          {
            name: "Ledgerline",
            owner: ex.founder,
            asset: TOKEN,
            rules: RULES,
            closer: ex.closer ?? null,
          },
          teraToGas(100),
          0n,
        ),
      ],
      waitUntil: "FINAL",
    });
    sent(
      `deploy and init ${ex.business} (born locked${ex.closer ? `; closer ${ex.closer}` : ""})`,
      r.transaction.hash,
    );
  }
  const acc = await provider.viewAccount({
    accountId: ex.business,
    blockQuery: { finality: "final" },
  });
  if (acc.code_hash !== CODE_HASH)
    throw new StopRun(`deployed code ${acc.code_hash} isn't ${CODE_HASH}`);
  const keys = (await provider.query({
    request_type: "view_access_key_list",
    account_id: ex.business,
    finality: "final",
  } as never)) as unknown as { keys: unknown[] };
  if (keys.keys.length !== 0) throw new StopRun(`${ex.business} has access keys: not locked`);
  const control = await view<Json>(ex.business, "get_control");
  if (control.owner !== ex.founder) throw new StopRun(`owner is ${control.owner}`);
  if (ex.closer && control.close_mode !== "gated")
    throw new StopRun(`close mode ${control.close_mode}`);
  console.log(
    `✓ code hash ${CODE_HASH}, no keys, owner ${control.owner}, close mode ${control.close_mode}`,
  );
  for (const id of ex.register) {
    if (await view<Json | null>(TOKEN, "storage_balance_of", { account_id: id })) continue;
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
  for (const [id, want] of ex.fund) {
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
    sent(`fund ${id} with ${Number(want - have) / 1e6} tUSD`, r.transaction.hash);
  }
  await spendGuard(`${ex.name} setup end`);
  const file = join(EVIDENCE_DIR, `v3-${ex.name}-setup-testnet.json`);
  const prior = existsSync(file)
    ? ((JSON.parse(readFileSync(file, "utf8")) as Json).transactions as Json[])
    : [];
  writeFileSync(
    file,
    JSON.stringify(
      {
        format: "everstreet-v3-rehearsal-setup",
        network: "testnet",
        commit: commit(),
        contract: {
          account: ex.business,
          wasm_sha256: WASM_SHA256,
          code_hash: CODE_HASH,
          access_keys: 0,
          close_mode: ex.closer ? "gated" : "direct",
        },
        accounts: ex,
        metering_key: {
          receiver: ex.business,
          methods: METER_METHODS,
          allowance_near: "0.25",
          full_access_keys: 0,
        },
        ...(ex.closer
          ? {
              closer_key: {
                receiver: ex.business,
                methods: ["close_sale"],
                allowance_near: "0.25",
                full_access_keys: 0,
              },
            }
          : {}),
        rules: RULES,
        transactions: [...prior, ...log],
      },
      (_k, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    ),
  );
}

/** Boots the app for an example: founder creates the business, then the bound configuration. */
async function bootExample(ex: Example, port: number) {
  const dir = resolve("data", "runtime", `rehearsal-${ex.name}`);
  if (existsSync(join(dir, "everstreet.db")))
    throw new StopRun(`${dir} already holds a run: resolve it before starting another`);
  mkdirSync(join(dir, "protected"), { recursive: true });
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
  const base = (bound: string | null): Json => ({
    config_version: 1,
    mode: "configured",
    network: "testnet",
    listen: { host: "127.0.0.1", port },
    database: join(dir, "everstreet.db"),
    sign_in: { recipient: "everstreet.local", session_hours: 8 },
    rpc: { endpoint: RPC },
    ...(bound
      ? {
          v3: { bindings: [{ business_id: bound, account: ex.business }] },
          customer: {
            operator_account: ex.meter,
            writer: { key_file: resolve(".near-credentials", "testnet", `${ex.meter}.json`) },
          },
          ...(ex.closer
            ? {
                handover: {
                  enabled: true,
                  closer: {
                    account: ex.closer,
                    keys: [
                      {
                        business_id: bound,
                        key_file: resolve(".near-credentials", "testnet", `${ex.closer}.json`),
                      },
                    ],
                  },
                  interval_ms: 15_000,
                  batch: 5,
                  pass_budget_ms: 12_000,
                  op_deadline_ms: 10_000,
                  dispatch_margin_ms: 60_000,
                  max_orders: 8,
                  stop_timeout_ms: 15_000,
                  min_allowance_yocto: "1000",
                },
              }
            : {}),
        }
      : {}),
    protected_storage: {
      root: join(dir, "protected"),
      active_key_id: "k1",
      keys_file: join(dir, "protected-keys.json"),
    },
    model: { ai_config_file: join(dir, "ai.json"), api_key_env: "EVERSTREET_REHEARSAL_MODEL_KEY" },
    maintenance: {
      enabled: true,
      interval_ms: 20_000,
      batch: 5,
      pass_budget_ms: 10_000,
      op_deadline_ms: 8_000,
      stop_timeout_ms: 15_000,
    },
    operators: { accounts: [ex.founder] },
  });
  const configFile = join(dir, "config.json");
  const boot1 = base(null);
  validateConfig(boot1);
  writeFileSync(configFile, JSON.stringify(boot1));
  let app = startApp(configFile);
  await app.ready();
  const f = httpClient(port);
  await signIn(f, ex.founder);
  const made = await f("/api/product-projects", "POST", {
    idea: "Turn invoices into clean, checked JSON for an accounting tool",
    foundation: "ai_api",
    name: "Ledgerline",
  });
  if (made.status !== 201)
    throw new StopRun(`project: ${made.status} ${JSON.stringify(made.body)}`);
  const list = (await f("/api/product-projects")).body.projects as Json[];
  const proj = list[0];
  if (!proj) throw new StopRun("no project after creating it");
  await app.stop();
  const boot2 = base(proj.business_id as string);
  validateConfig(boot2);
  writeFileSync(configFile, JSON.stringify(boot2));
  app = startApp(configFile);
  await app.ready();
  return {
    app,
    dir,
    business: { id: proj.business_id as string, project: proj.id as string, contract: ex.business },
  };
}

function exampleEnv(ex: Example, port: number, business: Env["business"]): Env {
  const accounts: Record<Who, string> = {
    founder: ex.founder,
    buyer: ex.buyer,
    customer: ex.customer,
    prober: ex.prober ?? ex.customer,
  };
  const clients = new Map<Who, Call>();
  return {
    label: "NEAR testnet",
    accounts,
    operator: ex.meter,
    business,
    client: (who) => {
      if (!clients.has(who)) clients.set(who, httpClient(port));
      return clients.get(who) as Call;
    },
    signIn: (who, call) => signIn(call, accounts[who]),
    wallet: (who, call) => sendAs(accounts[who], call),
    views: async () => {
      const block = (await provider.viewBlock({ finality: "final" } as never)) as Json;
      const people = [
        ex.customer,
        ex.business,
        ex.founder,
        ex.buyer,
        ...(ex.prober ? [ex.prober] : []),
      ];
      return {
        block: { height: String(block.header.height), hash: block.header.hash },
        control: await view<Json>(ex.business, "get_control"),
        treasury: await view<Json>(ex.business, "get_treasury"),
        entitlement: await view<Json | null>(ex.business, "get_entitlement", {
          customer: ex.customer,
          plan_id: 1,
        }).catch(() => null),
        seller_party: await view<Json | null>(ex.business, "get_party", {
          account: ex.founder,
        }).catch(() => null),
        tusd: Object.fromEntries(
          await Promise.all(
            people.map(async (a) => [
              a,
              await view<string>(TOKEN, "ft_balance_of", { account_id: a }),
            ]),
          ),
        ),
      };
    },
  };
}

/** One signed function call as this fictional account, final; failures kept, never thrown. */
async function sendAs(
  accountId: string,
  call: { receiverId: string; methodName: string; args: Json; gas: string; deposit: string },
) {
  await spendGuard(`before ${call.methodName}`);
  const r = await account(accountId).signAndSendTransaction({
    receiverId: call.receiverId,
    actions: [
      actions.functionCall(call.methodName, call.args, BigInt(call.gas), BigInt(call.deposit)),
    ],
    waitUntil: "FINAL",
    throwOnFailure: false,
  });
  const failure = (r.status as { Failure?: unknown }).Failure;
  const downstream = r.receipts_outcome.filter((o) => "Failure" in (o.outcome.status as object));
  console.log(
    `  ${accountId.split(".")[0]} ${call.methodName}: ${EXPLORER}${r.transaction.hash}${failure ? " (FAILED)" : downstream.length ? " (a downstream receipt failed)" : ""}`,
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
}

async function runExample(ex: Example, port: number) {
  await spendGuard(`${ex.name} run start`);
  const { app, business } = await bootExample(ex, port);
  const env = exampleEnv(ex, port, business);
  const rec = new Recorder({
    example: ex.name,
    network: "testnet",
    label: "NEAR testnet",
    commit: commit(),
    contract: { account: ex.business, wasm_sha256: WASM_SHA256, code_hash_expected: CODE_HASH },
    accounts: Object.fromEntries(
      Object.entries(ex).filter(([, v]) => typeof v === "string"),
    ) as Record<string, string>,
    model: "stand-in (scripted answers; no AI provider called)",
  });
  const out = join(EVIDENCE_DIR, `v3-${ex.name}-testnet.json`);
  try {
    if (ex.name === "gated") {
      const r = await runGated(env, rec, { closeWaitMs: 1_200_000, settleWaitMs: 180_000 });
      console.log(`✓ example 2 complete: ${JSON.stringify(r)}`);
    } else {
      let fired = false;
      app.onMessage((m) => {
        if (m?.type === "dropped") fired = true;
      });
      const renv: RecoveryEnv = {
        ...env,
        relay: { arm: () => app.send({ type: "arm-drop" }), fired: () => fired },
        unregister: async () =>
          sendAs(ex.founder, {
            receiverId: TOKEN,
            methodName: "storage_unregister",
            args: { force: false },
            gas: "30000000000000",
            deposit: "1",
          }),
        seller: async () => ({
          party: await view<Json | null>(ex.business, "get_party", { account: ex.founder }).catch(
            () => null,
          ),
          balance: await view<string>(TOKEN, "ft_balance_of", { account_id: ex.founder }),
          registered: !!(await view<Json | null>(TOKEN, "storage_balance_of", {
            account_id: ex.founder,
          })),
        }),
      };
      const r = await runRecovery(renv, rec, { settleWaitMs: 180_000 });
      console.log(`✓ examples 3 and 4 complete: ${JSON.stringify(r)}`);
    }
    rec.write(out, { completed: true });
  } catch (e) {
    rec.write(out, { completed: false, reason: (e as Error).message.slice(0, 600) });
    console.log(`app log (last part):\n${app.log().slice(-3000)}`);
    throw e;
  } finally {
    await spendGuard(`${ex.name} run end`).catch(() => {});
    await app.stop();
  }
  console.log(`evidence: ${out}`);
}

const cmd = process.argv[2];
try {
  if (cmd === "setup-direct") await setupDirect();
  else if (cmd === "run-direct") await runDirectLive();
  else if (cmd === "resume-direct") await resumeDirectLive();
  else if (cmd === "setup-gated") await setupExample(GATED);
  else if (cmd === "run-gated") await runExample(GATED, 8833);
  else if (cmd === "setup-recovery") await setupExample(RECOVERY);
  else if (cmd === "run-recovery") await runExample(RECOVERY, 8834);
  else {
    console.error("usage: v3-rehearsal.ts setup-direct | run-direct");
    process.exit(2);
  }
} catch (e) {
  console.error(`STOPPED: ${(e as Error).message}`);
  process.exit(1);
}
