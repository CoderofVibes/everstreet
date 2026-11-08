// An agent buys and uses a service over HTTP 402, on NEAR testnet: a fictional agent with its own
// NEAR account (no person behind it in this run, a script holds its key) signs in to Everstreet,
// asks Ledgerline for one use, and gets 402 Payment Required with the exact calls it must send:
// its registration with the business contract, then the purchase. It sends each from its own
// account; the units exist only once the business contract confirms the purchase. Then it uses
// one unit, and the owner sees the 402 and what the contract confirmed for it.
// Fictional, script-held accounts; test tokens with no monetary value.
//
//   npx tsx scripts/agent-402-testnet.ts
//   npx tsx scripts/verify-rehearsal.ts data/evidence/agent-402-testnet.json --live

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { provider, ROOT } from "./lib/near.ts";
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
const BIZ = `ledgerline-v3-3b.${ROOT}`;
const OWNER = `ines-v3s4.${ROOT}`; // generation 4
const AGENT = `agent-buyer-v3s7.${ROOT}`; // the agent: its own account, nothing bought yet
const METER = `meter-direct-v3s3b.${ROOT}`;
const OFFER = "1b909d95-22e1-452a-9a26-f440f35004cb"; // the business's current offer (0.15 tUSD)
const RUN_DIR = resolve("data", "runtime", "rehearsal-s4");
const OUT = join("data", "evidence", "agent-402-testnet.json");
const SPEND = join("data", "runtime", "rehearsal-spend-s7.json");
const UNITS = 2;
const SLOT = 0;
const guard = spendGuard(SPEND, 1.5);

if (existsSync(OUT) && (JSON.parse(readFileSync(OUT, "utf8")) as Json).outcome?.completed)
  throw new StopRun("already recorded as complete");
await startSpend(SPEND);
await guard("start");

const views = async () => {
  // Every view read at one final block, so the checkpoint names exactly what it shows.
  const block = (await provider.viewBlock({ finality: "final" } as never)) as Json;
  const at = async <T>(method: string, args: Json) =>
    (await provider.callFunction({
      contractId: BIZ,
      method,
      args,
      blockQuery: { blockId: block.header.height },
    } as never)) as T;
  return {
    block: { height: String(block.header.height), hash: block.header.hash },
    control: await at<Json>("get_control", {}),
    entitlement: await at<Json | null>("get_entitlement", { customer: AGENT, plan_id: 1 }).catch(
      () => null,
    ),
  };
};
const control = (await views()).control;
if (control.owner !== OWNER) throw new StopRun(`expected ${OWNER} as owner, saw ${control.owner}`);

// The agent's account and the test token it pays with (the token's storage and a balance are set
// up by the script's root account; the business registration is the agent's own, from the 402).
await createFull(AGENT, "0.3");
await registerToken(TOKEN, AGENT);
await fundToken(TOKEN, `${ROOT}`, AGENT, 1_000_000n);

const base = JSON.parse(readFileSync(join(RUN_DIR, "config.json"), "utf8")) as Json;
const bizId = base.v3.bindings[0].business_id as string;
const port = 8839;
const cfgFile = join(RUN_DIR, "config-agent.json");
writeFileSync(cfgFile, JSON.stringify({ ...base, listen: { host: "127.0.0.1", port } }));
const app = startApp(cfgFile);
await app.ready();

const rec = new Recorder({
  example: "agent-402",
  network: "testnet",
  label: "NEAR testnet",
  commit: execFileSync("git", ["rev-parse", "HEAD"]).toString().trim(),
  contract: {
    account: BIZ,
    wasm_sha256: "ede1c2f7bed77d1832f5b16e8a873645b387693a486b42a745a06b6d510a29b4",
    code_hash_expected: "H1bHmRMXLKb6BY7UXH4fEzPyQ5vs5FMoXhA9Z3tMTUvw",
  },
  accounts: { founder: OWNER, customer: AGENT, operator: METER },
  model: "stand-in (labelled; no AI provider is called)",
});
const accounts: Record<Who, string> = {
  founder: OWNER,
  buyer: OWNER, // no buyer in this run
  customer: AGENT,
  prober: AGENT,
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
  views,
};

try {
  for (const id of [OWNER, AGENT]) await signIn(client(id), id);
  await rec.checkpoint("start", await views());
  const agent = client(AGENT);
  const key = newDeviceKey();
  const install = { slot: SLOT, pk: key.pk, max_hold_units: 1, max_units_per_day: 100 };
  const ask = (n: number) =>
    agent(`/api/customer/offers/${OFFER}/prepare`, "POST", {
      idempotency_key: `agent-402-ask-${n}`,
      input: invoice(n),
      key_slot: SLOT,
      buy: { units: UNITS, install },
    });
  const summary = (b: Json) => ({
    code: b.code,
    reason: b.reason,
    payment_offer: b.payment_offer,
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
    next: b.next,
  });

  // 1. No registration, no units: 402 with the registration call first; the agent sends it.
  let r = await ask(1);
  if (r.status !== 402)
    throw new StopRun(`expected 402, got ${r.status}: ${JSON.stringify(r.body)}`);
  rec.app("http_402_first", { status: 402, ...summary(r.body) });
  for (const b of r.body.before as Json[]) {
    const out = await sendAs(AGENT, b.call as WalletCall);
    rec.tx(`agent_${b.step}`, "customer", AGENT, b.call as WalletCall, out, null);
    if (!out.ok) throw new StopRun(`${b.step}: ${out.error}`);
  }

  // 2. Registered, still no units: 402 with the exact purchase and its terms digest.
  r = await ask(2);
  if (r.status !== 402 || !r.body.purchase)
    throw new StopRun(`expected 402 with a purchase, got ${r.status}: ${JSON.stringify(r.body)}`);
  rec.app("http_402_purchase", { status: 402, ...summary(r.body) });
  const p = r.body.purchase as Json;
  const made = okBody(
    await agent(`/api/customer/offers/${OFFER}/purchases`, "POST", {
      idempotency_key: "agent-402-buy",
      units: UNITS,
      install,
      terms_digest: p.terms_digest,
    }),
    [200, 201],
    "purchase",
  );
  const pid = made.purchase.id as string;
  await agent(`/api/customer/purchases/${pid}/requested`, "POST", {});
  const sent = await sendAs(AGENT, made.purchase.call as WalletCall);
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
    AGENT,
    made.purchase.call as WalletCall,
    sent,
    checked.resolution ?? null,
  );
  if (checked.resolution?.kind !== "confirmed")
    throw new StopRun(`purchase not confirmed: ${JSON.stringify(checked)}`);
  await rec.checkpoint("bought", await views());

  // 3. Units exist now: the next request is a use, not a 402; the agent uses one.
  const s = steps(env as never, rec, 120_000);
  await s.serve(OFFER, 3, key, SLOT, "customer", "agent-402-use");
  await rec.checkpoint("used_once", await views());

  // 4. The owner's view: each 402 and what the contract confirmed for it.
  const own = okBody(
    await client(OWNER)(`/api/businesses/${bizId}/agent-purchases`),
    200,
    "agent purchases",
  );
  const mine = (own.offers as Json[]).filter((o) => o.account === AGENT);
  rec.app("owner_sees_agent_purchases", {
    totals: own.totals,
    this_agent: mine.map((o) => ({
      reason: o.reason,
      units: o.units,
      amount: o.amount,
      purchase: o.purchase ?? null,
    })),
  });
  if (!mine.some((o) => o.purchase?.state === "confirmed"))
    throw new StopRun(`the owner's view has no confirmed purchase: ${JSON.stringify(mine)}`);
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
