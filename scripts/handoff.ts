// The gate-1 handoff on NEAR testnet, end to end (docs/AUTHORITY.md):
//
//   1. Fixture on chain: treasury 45 with 20 reserved, buyer funded with 150, worker A appointed.
//   2. OpenSeat seeded: the linocut class is full, Maya holds a seat, Sam is first in line.
//   3. Before the sale the founder's signed command is accepted (generation 1).
//   4. Sale: founder proposes, both accept the same digest, the buyer's acceptance closes it.
//   5. The founder's real transactions fail on chain; their stale OpenSeat command is refused.
//   6. Maya cancels; worker A's job is refused (old generation) and waits as blocked.
//   7. Northline appoints worker B; the job runs and Sam is promoted once, under generation 2.
//   8. Sam's original reference shows a confirmed seat and a calendar file.
//
// Each step checks chain state first, so a stopped run resumes where it left off. Evidence,
// with every transaction hash, goes to data/evidence/handoff-testnet.json.
//
//   npm run handoff            (testnet; keys in .near-credentials/ and ~/.near-credentials/)

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { NearRpcAuthority } from "../services/openseat/src/authority.ts";
import { type OperatorIdentity, signCommand } from "../services/openseat/src/command.ts";
import { JUNIPER_CLASS, seedJuniper } from "../services/openseat/src/fixture.ts";
import { OpenSeat } from "../services/openseat/src/service.ts";
import { PromotionWorker } from "../services/openseat/src/worker.ts";
import { call, mustCall, readConfig, secretKeyOf, type TxResult, view } from "./lib/near.ts";

const cfg = readConfig();
const B = cfg.business;
const DEAL = "D-OPENSEAT-1";
const STATE_PATH = "data/runtime/handoff-testnet.json";
const DB_PATH = "data/runtime/openseat-testnet.db";
const EVIDENCE_PATH = "data/evidence/handoff-testnet.json";
mkdirSync("data/runtime", { recursive: true });
mkdirSync("data/evidence", { recursive: true });

interface RunState {
  salt: string;
  maya?: string;
  sam?: string;
  evidence: Evidence[];
}
interface Evidence {
  step: string;
  actor: string;
  expected: string;
  observed: string;
  ok: boolean;
  mode: "live testnet" | "seeded demo";
  tx?: string;
  url?: string;
  at: string;
}

const state: RunState = existsSync(STATE_PATH)
  ? JSON.parse(readFileSync(STATE_PATH, "utf8"))
  : { salt: randomBytes(16).toString("hex"), evidence: [] };
const save = () => writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

function record(e: Omit<Evidence, "at">) {
  const entry = { ...e, at: new Date().toISOString() };
  state.evidence.push(entry);
  save();
  console.log(`${e.ok ? "✓" : "✗"} ${e.step}: ${e.observed}${e.url ? `\n    ${e.url}` : ""}`);
  if (!e.ok) {
    writeEvidence();
    throw new Error(`Step failed: ${e.step}`);
  }
}

function tx(r: TxResult) {
  return { tx: r.hash, url: r.url };
}

const identity = (accountId: string): OperatorIdentity => ({
  accountId,
  secretKey: secretKeyOf(accountId),
});
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const control = () => view<{ owner: string; generation: number }>(B, "get_control");
const balance = async (who: string) =>
  Number(await view<string>(B, "balance_of", { account_id: who }));

// ---------- 1. on-chain fixture ----------
const beneficiary = `juniper-studio.${cfg.root}`; // a promised-credit recipient; never revealed on chain
if ((await control()).owner === cfg.founder && (await balance(cfg.buyer)) === 0) {
  await mustCall(cfg.issuer, B, "mint", { to: cfg.founder, amount: "45" }, 0n);
  await mustCall(cfg.issuer, B, "mint", { to: cfg.buyer, amount: "150" }, 0n);
  await mustCall(cfg.founder, B, "deposit_treasury", { amount: "45" });
  await mustCall(cfg.founder, B, "register_obligation", {
    obligation_id: "credit-juniper-2610",
    amount: "20",
    commitment: sha256(`${state.salt}|${beneficiary}`),
    memo: "Promised service credits to a studio customer (October outage)",
  });
  const r = await mustCall(cfg.founder, B, "appoint_operator", {
    account_id: cfg.workerA,
    capabilities: ["fulfillment"],
  });
  const t = await view<Record<string, string>>(B, "get_treasury");
  record({
    step: "fixture on chain",
    actor: "founder",
    expected: "treasury 45, reserved 20, available 25; worker A appointed in generation 1",
    observed: `treasury ${t.treasury}, reserved ${t.reserved}, available ${t.available}; worker A appointed`,
    ok: t.treasury === "45" && t.reserved === "20" && t.available === "25",
    mode: "live testnet",
    ...tx(r),
  });
}

// ---------- 2. OpenSeat ----------
const service = new OpenSeat({
  dbPath: DB_PATH,
  authority: new NearRpcAuthority("testnet", B, cfg.rpc),
});
if (!state.maya || !state.sam) {
  const { maya, sam } = seedJuniper(service);
  state.maya = maya.ref;
  state.sam = sam.ref;
  record({
    step: "class full, Sam waiting",
    actor: "attendees",
    expected: "Maya confirmed, Sam waitlisted at position 1",
    observed: `Maya ${maya.ref} ${maya.status}, Sam ${sam.ref} ${sam.status} #${sam.position}`,
    ok: maya.status === "confirmed" && sam.status === "waitlisted" && sam.position === 1,
    mode: "seeded demo",
  });
}
const maya = state.maya as string;
const sam = state.sam as string;
const founder = identity(cfg.founder);

// ---------- 3. founder acts before the sale ----------
if ((await control()).owner === cfg.founder) {
  const out = await service.execute(
    signCommand(founder, {
      business: B,
      action: "publish_release",
      args: { version: "openseat-1.4.0" },
      op_id: `pre-sale-release-${randomBytes(4).toString("hex")}`,
      generation: 1,
    }),
  );
  record({
    step: "founder operates before the sale",
    actor: "founder",
    expected: "signed command accepted at generation 1",
    observed: `${out.accepted ? "accepted" : "refused"}: ${out.reason} (authority ${out.authority.mode}, generation ${out.authority.generation})`,
    ok: out.accepted && out.authority.generation === 1,
    mode: "live testnet",
  });
}

// ---------- 4. the sale ----------
const packet = {
  kind: "closing-packet/v1",
  business: B,
  rights: ["owner role of the business contract", "appointment of operators from generation 2"],
  protected_obligations: [
    "monetary: credit-juniper-2610, 20 demo credits reserved in the treasury",
    `service: OpenSeat bookings and waitlist places for ${JUNIPER_CLASS.id}`,
  ],
  transfer_items_outside_the_contract: [
    { item: "openseat.example domain (simulated provider)", status: "pending", owner: "founder" },
  ],
  price: "100 demo credits",
};
writeFileSync("data/evidence/closing-packet.json", `${JSON.stringify(packet, null, 2)}\n`);
const termsHash = sha256(JSON.stringify(packet));

if ((await control()).owner === cfg.founder) {
  const existing = await view<{ digest: string } | null>(B, "get_deal", { deal_id: DEAL });
  if (!existing) {
    const r = await mustCall(cfg.founder, B, "propose_sale", {
      deal_id: DEAL,
      buyer: cfg.buyer,
      price: "100",
      expires_at_ms: String(Date.now() + 24 * 3_600_000),
      terms_hash: termsHash,
    });
    record({
      step: "founder proposes the sale",
      actor: "founder",
      expected: "deal open, no acceptances",
      observed: `deal ${DEAL} proposed for 100 demo credits`,
      ok: true,
      mode: "live testnet",
      ...tx(r),
    });
  }
  const deal = (await view<{ digest: string }>(B, "get_deal", { deal_id: DEAL })) as {
    digest: string;
  };
  const s = await mustCall(cfg.founder, B, "accept_sale", { deal_id: DEAL, digest: deal.digest });
  record({
    step: "seller accepts the terms",
    actor: "founder",
    expected: "acceptance recorded; nothing moves yet",
    observed: `accepted digest ${deal.digest.slice(0, 12)}…`,
    ok: (await control()).owner === cfg.founder,
    mode: "live testnet",
    ...tx(s),
  });
  const b = await mustCall(cfg.buyer, B, "accept_sale", { deal_id: DEAL, digest: deal.digest });
  const c = await control();
  const t = await view<Record<string, string>>(B, "get_treasury");
  const [fb, bb] = [await balance(cfg.founder), await balance(cfg.buyer)];
  record({
    step: "buyer accepts and the sale closes",
    actor: "northline",
    expected: "owner Northline, generation 2, seller +100, buyer 50 left, treasury still 45/20/25",
    observed: `owner ${c.owner}, generation ${c.generation}, founder ${fb}, buyer ${bb}, treasury ${t.treasury}/${t.reserved}/${t.available}`,
    ok:
      c.owner === cfg.buyer &&
      c.generation === 2 &&
      fb === 100 &&
      bb === 50 &&
      t.treasury === "45" &&
      t.available === "25",
    mode: "live testnet",
    ...tx(b),
  });
}

// ---------- 5. the founder's old authority fails everywhere ----------
const done = (step: string) => state.evidence.some((e) => e.step === step && e.ok);
if (!done("founder appoints after the sale")) {
  const r = await call(cfg.founder, B, "appoint_operator", {
    account_id: cfg.founder,
    capabilities: ["support"],
  });
  record({
    step: "founder appoints after the sale",
    actor: "founder",
    expected: "transaction fails on chain with E_NOT_OWNER",
    observed: r.ok ? "transaction SUCCEEDED" : `failed: ${r.error}`,
    ok: !r.ok && /E_NOT_OWNER/.test(r.error ?? ""),
    mode: "live testnet",
    ...tx(r),
  });
}
if (!done("founder withdraws the treasury after the sale")) {
  const w = await call(cfg.founder, B, "withdraw_treasury", { amount: "25" });
  record({
    step: "founder withdraws the treasury after the sale",
    actor: "founder",
    expected: "transaction fails on chain with E_NOT_OWNER",
    observed: w.ok ? "transaction SUCCEEDED" : `failed: ${w.error}`,
    ok: !w.ok && /E_NOT_OWNER/.test(w.error ?? ""),
    mode: "live testnet",
    ...tx(w),
  });
}
if (!done("the same close replayed")) {
  const again = await call(cfg.buyer, B, "accept_sale", {
    deal_id: DEAL,
    digest: (await view<{ digest: string }>(B, "get_deal", { deal_id: DEAL })).digest,
  });
  record({
    step: "the same close replayed",
    actor: "northline",
    expected: "fails: the deal is closed and the seller is not paid twice",
    observed: again.ok
      ? "transaction SUCCEEDED"
      : `failed: ${again.error}; founder holds ${await balance(cfg.founder)}`,
    ok: !again.ok && (await balance(cfg.founder)) === 100,
    mode: "live testnet",
    ...tx(again),
  });
}
if (!done("founder's stale dashboard changes capacity")) {
  const stale = await service.execute(
    signCommand(founder, {
      business: B,
      action: "set_capacity",
      args: { class_id: JUNIPER_CLASS.id, capacity: 2 },
      op_id: `stale-ui-${randomBytes(4).toString("hex")}`,
      generation: 1,
    }),
  );
  record({
    step: "founder's stale dashboard changes capacity",
    actor: "founder",
    expected: "OpenSeat refuses after checking the contract",
    observed: `${stale.accepted ? "ACCEPTED" : "refused"}: ${stale.reason}`,
    ok: !stale.accepted,
    mode: "live testnet",
  });
}

// ---------- 6. Maya cancels; the old worker is refused ----------
if (service.booking(maya).status !== "cancelled") {
  service.cancel(maya);
  const oldWorker = new PromotionWorker(service, identity(cfg.workerA), 1);
  const [attempt] = await oldWorker.drain();
  record({
    step: "Maya cancels; the founder-era worker tries to promote",
    actor: "worker A",
    expected: "refused: grant from generation 1; Sam keeps his place, job waits",
    observed: `${attempt?.outcome.accepted ? "ACCEPTED" : "refused"}: ${attempt?.outcome.reason}; Sam ${service.booking(sam).status}`,
    ok: attempt?.outcome.accepted === false && service.booking(sam).status === "waitlisted",
    mode: "live testnet",
  });
}

// ---------- 7. the buyer appoints a worker; Sam is promoted once ----------
if (service.booking(sam).status === "waitlisted") {
  const check = await view<{ authorized: boolean }>(B, "operator_check", {
    account_id: cfg.workerB,
    capability: "fulfillment",
  });
  if (!check.authorized) {
    const r = await mustCall(cfg.buyer, B, "appoint_operator", {
      account_id: cfg.workerB,
      capabilities: ["fulfillment"],
    });
    record({
      step: "Northline appoints worker B",
      actor: "northline",
      expected: "worker B authorized for fulfillment in generation 2",
      observed: "appointed",
      ok: true,
      mode: "live testnet",
      ...tx(r),
    });
  }
  const worker = new PromotionWorker(service, identity(cfg.workerB), 2);
  const [run] = await worker.drain();
  service.cancel(maya); // the same cancellation delivered again
  const rerun = await worker.drain();
  const s = service.booking(sam);
  record({
    step: "worker B promotes Sam",
    actor: "worker B",
    expected: "Sam confirmed once under generation 2; a redelivered cancel changes nothing",
    observed: `${run?.outcome.reason}; Sam ${s.status} by ${s.promoted_by} at generation ${s.promoted_generation}; ${service.notifications(sam).length} notification; ${rerun.length} further jobs`,
    ok:
      s.status === "confirmed" &&
      s.promoted_generation === 2 &&
      service.notifications(sam).length === 1 &&
      rerun.length === 0,
    mode: "live testnet",
  });
}

// ---------- 8. the customer's original reference ----------
const ics = service.calendar(sam);
writeFileSync(`data/evidence/${sam}.ics`, ics);
const final = service.booking(sam);
if (!state.evidence.some((e) => e.step === "Sam checks his original reference")) {
  record({
    step: "Sam checks his original reference",
    actor: "Sam",
    expected: "the reference he got before the sale shows a confirmed seat and a calendar file",
    observed: `${sam}: ${final.status}; calendar file written`,
    ok: final.status === "confirmed" && ics.includes(sam),
    mode: "live testnet",
  });
}

function writeEvidence() {
  const evidence = {
    kind: "handoff-evidence/v1",
    network: "testnet",
    business: B,
    code_hash: cfg.codeHash,
    deploy_tx: cfg.deployTx,
    note: "OpenSeat ran locally and checked authority against this contract over testnet RPC at final finality. Attendee names stay in OpenSeat; nothing personal is on chain.",
    steps: state.evidence,
  };
  writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
}
writeEvidence();
service.close();
console.log(`\nEvidence: ${EVIDENCE_PATH}`);
