// Agent hires agent, on NEAR testnet (Anthony, Nov 7: "the agentic economy in action"):
// Signalwatch, a second fictional business, is deployed as its own business contract (the same
// reproducible build as Ledgerline's, born with no access keys). Its owner appoints Signalwatch's
// agent as an operator on that contract, so the chain says who the agent works for. The agent then
// asks Ledgerline for an invoice read, gets HTTP 402, registers and pays from its own NEAR account,
// and uses one unit. Ledgerline's owner sees the purchase. The agent pays from its own balance; no
// contract caps that spend. Fictional, script-held accounts; test tokens with no monetary value.
//
//   npx tsx scripts/agent-hires-agent-testnet.ts
//   npx tsx scripts/verify-rehearsal.ts data/evidence/agent-hires-agent-testnet.json --live

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { baseEncode } from "near-api-js";
import { account, actions, exists, nearToYocto, provider, ROOT, teraToGas } from "./lib/near.ts";
import { Recorder } from "./lib/rehearsal/evidence.ts";
import {
  type Call,
  invoice,
  type Json,
  newDeviceKey,
  StopRun,
  steps,
  type WalletCall,
  type Who,
} from "./lib/rehearsal/journey.ts";
import {
  createFull,
  fundToken,
  httpClient,
  okBody,
  registerToken,
  sendAs,
  signIn,
  spendGuard,
  startApp,
  startSpend,
} from "./lib/testnetRun.ts";

const TOKEN = "tusd.everstreet.testnet";
const LEDGERLINE = `ledgerline-v3-3b.${ROOT}`;
const LL_OWNER = `ines-v3s4.${ROOT}`; // Ledgerline's owner, generation 4
const METER = `meter-direct-v3s3b.${ROOT}`;
const OFFER = "1b909d95-22e1-452a-9a26-f440f35004cb"; // Ledgerline's current offer (0.15 tUSD)
const SIGNALWATCH = `signalwatch-v3s8.${ROOT}`; // the second business: its own contract
const SW_OWNER = `wes-v3s8.${ROOT}`; // Signalwatch's owner (fictional)
const SW_AGENT = `signalwatch-agent-v3s8.${ROOT}`; // Signalwatch's agent: its own account
const WASM_SHA256 = "ede1c2f7bed77d1832f5b16e8a873645b387693a486b42a745a06b6d510a29b4";
const CODE_HASH = "H1bHmRMXLKb6BY7UXH4fEzPyQ5vs5FMoXhA9Z3tMTUvw";
const RULES = {
  min_reserve: "750000",
  max_hold_units: 1,
  max_hold_ttl_ms: "600000",
  max_settle_grace_ms: "480000",
};
const METERING = 1;
const RUN_DIR = resolve("data", "runtime", "rehearsal-s4");
const OUT = join("data", "evidence", "agent-hires-agent-testnet.json");
const SPEND = join("data", "runtime", "rehearsal-spend-s8.json");
const UNITS = 2;
const SLOT = 0;
const guard = spendGuard(SPEND, 5.5);

if (existsSync(OUT) && (JSON.parse(readFileSync(OUT, "utf8")) as Json).outcome?.completed)
  throw new StopRun("already recorded as complete");
await startSpend(SPEND);
await guard("start");

const viewAt = async <T>(contract: string, method: string, args: Json, height: number) =>
  (await provider.callFunction({
    contractId: contract,
    method,
    args,
    blockQuery: { blockId: height },
  } as never)) as T;
const views = async () => {
  // Every view read at one final block, so the checkpoint names exactly what it shows.
  const block = (await provider.viewBlock({ finality: "final" } as never)) as Json;
  const h = block.header.height as number;
  const sw = (await exists(SIGNALWATCH))
    ? {
        account: SIGNALWATCH,
        code_hash: (
          (await provider.query({
            request_type: "view_account",
            account_id: SIGNALWATCH,
            block_id: h,
          } as never)) as unknown as Json
        ).code_hash,
        access_keys: (
          (await provider.query({
            request_type: "view_access_key_list",
            account_id: SIGNALWATCH,
            block_id: h,
          } as never)) as unknown as { keys: unknown[] }
        ).keys.length,
        control: await viewAt<Json>(SIGNALWATCH, "get_control", {}, h),
      }
    : null;
  return {
    block: { height: String(h), hash: block.header.hash },
    control: await viewAt<Json>(LEDGERLINE, "get_control", {}, h),
    entitlement: await viewAt<Json | null>(
      LEDGERLINE,
      "get_entitlement",
      { customer: SW_AGENT, plan_id: 1 },
      h,
    ).catch(() => null),
    signalwatch: sw,
  };
};
const start = await views();
if (start.control.owner !== LL_OWNER)
  throw new StopRun(`expected ${LL_OWNER} as Ledgerline's owner, saw ${start.control.owner}`);

// 1. Signalwatch's owner and agent (full keys, held by the script), and Signalwatch's contract.
await createFull(SW_OWNER, "0.3");
await createFull(SW_AGENT, "0.3");
const setupTx: Json[] = [];
if (!(await exists(SIGNALWATCH))) {
  const wasm = readFileSync("contracts/target/near/business_v3/business_v3.wasm");
  const sha = createHash("sha256").update(wasm).digest();
  if (sha.toString("hex") !== WASM_SHA256 || baseEncode(sha) !== CODE_HASH)
    throw new StopRun(`the local wasm (${sha.toString("hex")}) isn't the reviewed build`);
  await guard("before the Signalwatch deploy");
  const r = await account(ROOT).signAndSendTransaction({
    receiverId: SIGNALWATCH,
    actions: [
      actions.createAccount(),
      actions.transfer(nearToYocto("4.3")),
      actions.deployContract(wasm),
      actions.functionCall(
        "new",
        { name: "Signalwatch", owner: SW_OWNER, asset: TOKEN, rules: RULES, closer: null },
        teraToGas(100),
        0n,
      ),
    ],
    waitUntil: "FINAL",
  });
  setupTx.push({
    what: "deploy and init Signalwatch (born locked: no key)",
    hash: r.transaction.hash,
  });
  console.log(`+ Signalwatch deployed: https://testnet.nearblocks.io/txns/${r.transaction.hash}`);
}
const deployed = await views();
if (deployed.signalwatch?.code_hash !== CODE_HASH)
  throw new StopRun(`Signalwatch's code is ${deployed.signalwatch?.code_hash}`);
if (deployed.signalwatch.access_keys !== 0) throw new StopRun("Signalwatch has access keys");
if (deployed.signalwatch.control.owner !== SW_OWNER)
  throw new StopRun(`Signalwatch's owner is ${deployed.signalwatch.control.owner}`);
await registerToken(TOKEN, SW_AGENT);
await fundToken(TOKEN, `${ROOT}`, SW_AGENT, 1_000_000n);

const base = JSON.parse(readFileSync(join(RUN_DIR, "config.json"), "utf8")) as Json;
const bizId = base.v3.bindings[0].business_id as string;
const port = 8837;
const cfgFile = join(RUN_DIR, "config-a2a.json");
writeFileSync(cfgFile, JSON.stringify({ ...base, listen: { host: "127.0.0.1", port } }));
const app = startApp(cfgFile);
await app.ready();

const rec = new Recorder({
  example: "agent-hires-agent",
  network: "testnet",
  label: "NEAR testnet",
  commit: execFileSync("git", ["rev-parse", "HEAD"]).toString().trim(),
  contract: { account: LEDGERLINE, wasm_sha256: WASM_SHA256, code_hash_expected: CODE_HASH },
  accounts: {
    founder: LL_OWNER,
    customer: SW_AGENT,
    operator: METER,
    agents_business: SIGNALWATCH,
    agents_business_owner: SW_OWNER,
  },
  model: "stand-in (labelled; no AI provider is called)",
});
const accounts: Record<Who, string> = {
  founder: LL_OWNER,
  buyer: LL_OWNER, // no sale in this run
  customer: SW_AGENT,
  prober: SW_AGENT,
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
  business: { id: bizId, project: "", contract: LEDGERLINE },
  client: (who: Who) => client(accounts[who]),
  signIn: (who: Who, call: Call) => signIn(call, accounts[who]),
  wallet: (who: Who, call: WalletCall) => sendAs(accounts[who], call),
  views,
};

try {
  rec.app("signalwatch_deployed", {
    account: SIGNALWATCH,
    owner: SW_OWNER,
    code_hash: deployed.signalwatch.code_hash,
    access_keys: deployed.signalwatch.access_keys,
    setup: setupTx,
  });
  await rec.checkpoint("signalwatch_deployed", deployed);

  // 2. Signalwatch's owner appoints its agent as an operator on Signalwatch's own contract.
  const swc = deployed.signalwatch.control as Json;
  const appointed = (swc.operators as [string, number, number][]).some(([a]) => a === SW_AGENT);
  if (!appointed) {
    const call: WalletCall = {
      receiverId: SIGNALWATCH,
      methodName: "appoint_operator_guarded",
      args: {
        account: SW_AGENT,
        caps: METERING,
        expected_control_seq: String(swc.control_seq),
      },
      gas: "30000000000000",
      deposit: "1",
    };
    const out = await sendAs(SW_OWNER, call);
    rec.tx("signalwatch_appoints_its_agent", "founder", SW_OWNER, call, out, null);
    if (!out.ok) throw new StopRun(`appoint: ${out.error}`);
  }
  const hired = await views();
  const op = (hired.signalwatch?.control.operators as [string, number, number][]).find(
    ([a]) => a === SW_AGENT,
  );
  if (!op) throw new StopRun("the agent isn't Signalwatch's operator");
  await rec.checkpoint("agent_appointed_by_signalwatch", hired);

  // 3. The agent asks Ledgerline for an invoice read: 402, its registration, 402, its purchase.
  for (const id of [LL_OWNER, SW_AGENT]) await signIn(client(id), id);
  const agent = client(SW_AGENT);
  const key = newDeviceKey();
  const install = { slot: SLOT, pk: key.pk, max_hold_units: 1, max_units_per_day: 100 };
  const ask = (n: number) =>
    agent(`/api/customer/offers/${OFFER}/prepare`, "POST", {
      idempotency_key: `a2a-ask-${n}`,
      input: invoice(n),
      key_slot: SLOT,
      buy: { units: UNITS, install },
    });
  const summary = (b: Json) => ({
    code: b.code,
    reason: b.reason,
    offer: b.offer,
    before: (b.before as Json[]).map((x) => ({
      step: x.step,
      receiver: x.call?.receiverId,
      method: x.call?.methodName,
    })),
    purchase: b.purchase
      ? {
          units: b.purchase.units,
          amount: b.purchase.amount,
          receiver: b.purchase.call?.receiverId,
          method: b.purchase.call?.methodName,
          terms_digest: b.purchase.terms_digest,
        }
      : null,
  });
  let r = await ask(1);
  if (r.status !== 402)
    throw new StopRun(`expected 402, got ${r.status}: ${JSON.stringify(r.body)}`);
  rec.app("http_402_first", { status: 402, ...summary(r.body) });
  for (const b of r.body.before as Json[]) {
    const out = await sendAs(SW_AGENT, b.call as WalletCall);
    rec.tx(`agent_${b.step}`, "customer", SW_AGENT, b.call as WalletCall, out, null);
    if (!out.ok) throw new StopRun(`${b.step}: ${out.error}`);
  }
  r = await ask(2);
  if (r.status !== 402 || !r.body.purchase)
    throw new StopRun(`expected 402 with a purchase, got ${r.status}: ${JSON.stringify(r.body)}`);
  rec.app("http_402_purchase", { status: 402, ...summary(r.body) });
  const made = okBody(
    await agent(`/api/customer/offers/${OFFER}/purchases`, "POST", {
      idempotency_key: "a2a-buy",
      units: UNITS,
      install,
      terms_digest: r.body.purchase.terms_digest,
    }),
    [200, 201],
    "purchase",
  );
  const pid = made.purchase.id as string;
  await agent(`/api/customer/purchases/${pid}/requested`, "POST", {});
  const sent = await sendAs(SW_AGENT, made.purchase.call as WalletCall);
  await agent(`/api/customer/purchases/${pid}/requested`, "POST", { tx_hash: sent.hash });
  let checked: Json = {};
  for (let i = 0; i < 20; i++) {
    checked = (await agent(`/api/customer/purchases/${pid}/check`, "POST", { tx_hash: sent.hash }))
      .body;
    if (checked.resolution?.kind === "confirmed") break;
    await new Promise((x) => setTimeout(x, 3000));
  }
  rec.tx(
    `agent_purchase_${UNITS}`,
    "customer",
    SW_AGENT,
    made.purchase.call as WalletCall,
    sent,
    checked.resolution ?? null,
  );
  if (checked.resolution?.kind !== "confirmed")
    throw new StopRun(`purchase not confirmed: ${JSON.stringify(checked)}`);
  await rec.checkpoint("bought", await views());

  // 4. It uses one unit: the invoice read is delivered and charged on Ledgerline's contract.
  const s = steps(env as never, rec, 120_000);
  await s.serve(OFFER, 3, key, SLOT, "customer", "a2a-use");
  await rec.checkpoint("used_once", await views());

  // 5. Ledgerline's owner sees the 402 and what the contract confirmed for this agent.
  const own = okBody(
    await client(LL_OWNER)(`/api/businesses/${bizId}/agent-purchases`),
    200,
    "agent purchases",
  );
  const mine = (own.offers as Json[]).filter((o) => o.account === SW_AGENT);
  rec.app("ledgerline_owner_sees_the_agent", {
    this_agent: mine.map((o) => ({
      reason: o.reason,
      units: o.units,
      amount: o.amount,
      purchase: o.purchase ?? null,
    })),
  });
  if (!mine.some((o) => o.purchase?.state === "confirmed"))
    throw new StopRun(`no confirmed purchase in the owner's view: ${JSON.stringify(mine)}`);
  rec.write(OUT, { completed: true });
  console.log(`✓ recorded: ${OUT}`);
} catch (e) {
  rec.write(OUT, { completed: false, reason: (e as Error).message.slice(0, 600) });
  console.log(`app log (last part):\n${app.log().slice(-3000)}`);
  throw e;
} finally {
  await guard("end").catch(() => {});
  await app.stop();
}
