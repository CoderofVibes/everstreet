// "Seller pays its own business", on NEAR testnet: the owner of the Ledgerline example (ines-v3s4,
// generation 4) pays for a new fictional customer's registration (the contract's sponsor_shell
// records her as the payer); that customer buys two uses and uses one through the app; then the
// owner's view of the sale economics names that revenue as linked to the seller, while the
// earlier customer's uses stay independent. Fictional, script-held accounts; test tokens.
//
//   npx tsx scripts/linked-revenue-testnet.ts
//   npx tsx scripts/verify-rehearsal.ts data/evidence/linked-revenue-testnet.json --live

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { provider, ROOT, view } from "./lib/near.ts";
import { Recorder } from "./lib/rehearsal/evidence.ts";
import {
  buy,
  type Call,
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
// The second run (Nov 7, late): a new customer, so the record holds the owner-paid registration
// and each checkpoint names its block. The first run (wren-v3s5, no blocks) is kept as
// data/evidence/linked-revenue-first-testnet.json.
const WREN = `wren-v3s6.${ROOT}`; // the new customer, registration paid by the owner
const CARA = `cara-v3s3-1.${ROOT}`; // the earlier customer (paid for her own registration)
const METER = `meter-direct-v3s3b.${ROOT}`;
const OFFER = "1b909d95-22e1-452a-9a26-f440f35004cb"; // the business's current offer (0.15 tUSD)
const RUN_DIR = resolve("data", "runtime", "rehearsal-s4");
const OUT = join("data", "evidence", "linked-revenue-testnet.json");
const SPEND = join("data", "runtime", "rehearsal-spend-s6.json");
const guard = spendGuard(SPEND, 1.5);

if (existsSync(OUT) && (JSON.parse(readFileSync(OUT, "utf8")) as Json).outcome?.completed)
  throw new StopRun("already recorded as complete");
await startSpend(SPEND);
await guard("start");
const control = await view<Json>(BIZ, "get_control");
if (control.owner !== OWNER) throw new StopRun(`expected ${OWNER} as owner, saw ${control.owner}`);

// The customer: a fictional account with a key, the test token, and enough tUSD for two uses.
await createFull(WREN, "0.3");
await registerToken(TOKEN, WREN);
await fundToken(TOKEN, `${ROOT}`, WREN, 1_000_000n);

const base = JSON.parse(readFileSync(join(RUN_DIR, "config.json"), "utf8")) as Json;
const bizId = base.v3.bindings[0].business_id as string;
const port = 8838;
const cfgFile = join(RUN_DIR, "config-linked.json");
writeFileSync(cfgFile, JSON.stringify({ ...base, listen: { host: "127.0.0.1", port } }));
const app = startApp(cfgFile);
await app.ready();

const rec = new Recorder({
  example: "linked-revenue",
  network: "testnet",
  label: "NEAR testnet",
  commit: execFileSync("git", ["rev-parse", "HEAD"]).toString().trim(),
  contract: {
    account: BIZ,
    wasm_sha256: "ede1c2f7bed77d1832f5b16e8a873645b387693a486b42a745a06b6d510a29b4",
    code_hash_expected: "H1bHmRMXLKb6BY7UXH4fEzPyQ5vs5FMoXhA9Z3tMTUvw",
  },
  accounts: { founder: OWNER, customer: WREN, earlier_customer: CARA, operator: METER },
  model: "stand-in (labelled; no AI provider is called)",
});
const accounts: Record<Who, string> = {
  founder: OWNER,
  buyer: OWNER, // no buyer in this run
  customer: WREN,
  prober: WREN,
};
const clients = new Map<string, Call>();
const client = (id: string) => {
  if (!clients.has(id)) clients.set(id, httpClient(port));
  return clients.get(id) as Call;
};
const views = async () => {
  // The final block each checkpoint was read at, and every view read at that block (the Nov 7
  // review: the first run's record carries none, so it can't be re-read at the moment it describes).
  const block = (await provider.viewBlock({ finality: "final" } as never)) as Json;
  const at = async <T>(method: string, args: Json) =>
    (await provider.callFunction({
      contractId: BIZ,
      method,
      args,
      blockQuery: { blockId: block.header.height },
    } as never)) as T;
  const ent = (c: string) =>
    at<Json | null>("get_entitlement", { customer: c, plan_id: 1 }).catch(() => null);
  return {
    block: { height: String(block.header.height), hash: block.header.hash },
    control: await at<Json>("get_control", {}),
    entitlement: await ent(WREN),
    earlier_customer: await ent(CARA),
  };
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
  for (const id of [OWNER, WREN]) await signIn(client(id), id);
  await rec.checkpoint("start", await views());

  // 1. The owner pays for the new customer's registration (the exact storage, per the contract).
  if (!(await view<Json | null>(BIZ, "get_entitlement", { customer: WREN, plan_id: 1 }))) {
    const terms = await view<Json>(BIZ, "get_purchase_terms", { customer: WREN });
    const deposit = (BigInt(terms.shell_bytes) * BigInt(terms.storage_byte_cost)).toString();
    const call: WalletCall = {
      receiverId: BIZ,
      methodName: "sponsor_shell",
      args: { customer: WREN, plan_id: 1 },
      gas: "30000000000000",
      deposit,
    };
    const out = await sendAs(OWNER, call);
    rec.tx("owner_pays_customer_registration", "founder", OWNER, call, out, null);
    if (!out.ok) throw new StopRun(`sponsor_shell: ${out.error}`);
  }
  const reg = await view<Json>(BIZ, "get_entitlement", { customer: WREN, plan_id: 1 });
  if (reg.storage_payer !== OWNER)
    throw new StopRun(`the contract names ${reg.storage_payer} as the payer, not ${OWNER}`);
  await rec.checkpoint("registration_paid_by_owner", await views());

  // 2. The customer buys two uses and uses one, through the app's customer routes.
  const s = steps(env as never, rec, 120_000);
  const key = newDeviceKey();
  await buy(env as never, rec, s, {
    who: "customer",
    offer: OFFER,
    units: 2,
    key,
    slot: 0,
    tag: "linked",
  });
  await s.serve(OFFER, 1, key, 0, "customer", "linked-use");
  await rec.checkpoint("used_once", await views());

  // 3. The owner's view of the sale economics: the new customer's revenue is linked.
  const e = okBody(await client(OWNER)(`/api/sales/${bizId}/economics`), 200, "economics");
  const r = e.revenue_sources as Json;
  rec.app("revenue_by_source", {
    independent: r.independent,
    linked: r.linked,
    unchecked: r.unchecked,
    checked: r.checked,
    not_checked: r.not_checked,
    books: { earned_uses: e.books.earned_uses, earned_revenue: e.books.earned_revenue },
  });
  const wren = (r.linked.accounts as Json[]).find((x) => x.account === WREN);
  if (!wren?.reasons?.includes("registration_paid_by_seller"))
    throw new StopRun(`the new customer isn't linked: ${JSON.stringify(r.linked)}`);
  if ((r.linked.accounts as Json[]).some((x) => x.account === CARA))
    throw new StopRun("the earlier customer was linked");
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
