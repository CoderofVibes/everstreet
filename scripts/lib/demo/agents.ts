// Two fictional agents meet Signalwatch's HTTP 402 in the demo, each signed in with its own
// account as its own customer: one registers, buys three units from its own account and has the
// purchase confirmed by the contract's receipt; the other gets the exact offer and doesn't pay.
// The owner's "Agent purchases" desk page shows both. Synthetic chain, test tokens.

import { createPrivateKey, createPublicKey } from "node:crypto";
import type { Json } from "../../../server/test/customer-world.ts";
import { ACCOUNTS, AGENT_ACCOUNT, type DemoWorld } from "./world.ts";

export const PAYING_AGENT = { name: "Supply Desk agent", account: "supply-desk.demo.near" };
export const BROWSING_AGENT = { name: "Atlas research agent", account: "atlas-research.demo.near" };

export async function agentPurchases(w: DemoWorld) {
  const ledger = w.chains.chains.get(ACCOUNTS.signalwatch) as unknown as {
    balances: Map<string, bigint>;
    tokenRegistered: Set<string>;
  };
  const offer = w.offers.signalwatch;
  const run = async (who: { name: string; account: string }, pay: boolean) => {
    ledger.balances.set(who.account, 50_000_000n);
    ledger.tokenRegistered.add(who.account);
    const me = w.person(who.name, who.account);
    let n = 0;
    const prepare = () =>
      me(`/api/customer/offers/${offer}/prepare`, "POST", {
        idempotency_key: `demo-agent-${who.account.split(".")[0]}-${++n}`,
        input: "Summarize this week's alerts for our supplier list.",
        key_slot: 1,
        buy: {
          units: 3,
          install: { slot: 1, pk: "cd".repeat(32), max_hold_units: 1, max_units_per_day: 20 },
        },
      });
    let r = await prepare();
    for (const step of (r.body.before ?? []) as { call: Json }[])
      w.chains.walletCall(who.account, step.call);
    if (r.status === 402 && r.body.before?.length) r = await prepare();
    if (r.status !== 402 || !r.body.purchase) throw new Error(`demo agent: ${r.status}`);
    if (!pay) return;
    const p = r.body.purchase;
    const made = await me(`/api/customer/offers/${offer}/purchases`, "POST", {
      idempotency_key: `demo-agent-buy-${who.account.split(".")[0]}`,
      units: p.units,
      install: { slot: 1, pk: "cd".repeat(32), max_hold_units: 1, max_units_per_day: 20 },
      terms_digest: p.terms_digest,
    });
    const id = made.body.purchase.id as string;
    const tx = w.chains.walletCall(who.account, p.call) as Json;
    const hash = String(tx.transaction.hash);
    await me(`/api/customer/purchases/${id}/requested`, "POST", { tx_hash: hash });
    const checked = await me(`/api/customer/purchases/${id}/check`, "POST", { tx_hash: hash });
    if (checked.body.resolution?.kind !== "confirmed")
      throw new Error(`demo agent purchase: ${JSON.stringify(checked.body.resolution)}`);
  };
  await run(PAYING_AGENT, true);
  await run(BROWSING_AGENT, false);
}

/**
 * Agent hires agent (Anthony, Nov 7: "the agentic economy in action"): Signalwatch's own agent,
 * the same account that holds Signalwatch's supplier budget, needs an invoice read while serving
 * a Signalwatch customer. It asks Ledgerline for a use, gets HTTP 402, registers and pays from its
 * own account on Ledgerline's contract, and uses one unit. Ledgerline's owner sees the purchase on
 * the Agent purchases page; signed in as the agent, its own activity shows the use. It pays from
 * its own balance, not from Signalwatch's budget (that pays named suppliers). Synthetic chain.
 */
export const SIGNALWATCH_AGENT = { name: "Signalwatch's agent", account: AGENT_ACCOUNT };
export async function agentHiresAgent(w: DemoWorld) {
  const ledger = w.chains.chains.get(ACCOUNTS.ledgerline) as unknown as {
    balances: Map<string, bigint>;
    tokenRegistered: Set<string>;
  };
  ledger.balances.set(AGENT_ACCOUNT, 20_000_000n);
  ledger.tokenRegistered.add(AGENT_ACCOUNT);
  const me = w.person(SIGNALWATCH_AGENT.name, AGENT_ACCOUNT);
  // Ledgerline's newest offer: the simulated month releases a second version, and the first
  // version's offer no longer serves.
  const offer = (
    w.db
      .prepare(
        "SELECT id FROM customer_offers WHERE business_id = ? AND state = 'active' ORDER BY rowid DESC LIMIT 1",
      )
      .get(w.business.ledgerline.id) as { id: string }
  ).id;
  // The demo's device key (seed 1), so the use below signs as every demo customer's device does.
  const pk = createPublicKey(
    createPrivateKey({
      key: Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"),
        Buffer.alloc(32, 1),
      ]),
      format: "der",
      type: "pkcs8",
    }),
  )
    .export({ format: "der", type: "spki" })
    .subarray(-32)
    .toString("hex");
  const install = { slot: 0, pk, max_hold_units: 1, max_units_per_day: 20 };
  const invoice = "Fictional invoice NA-4410 from Northwind AI Ops, 2026-10-01, total 48.00 USD";
  let n = 0;
  const prepare = () =>
    me(`/api/customer/offers/${offer}/prepare`, "POST", {
      idempotency_key: `demo-a2a-${++n}`,
      input: invoice,
      buy: { units: 2, install },
    });
  let r = await prepare();
  for (const step of (r.body.before ?? []) as { call: Json }[])
    w.chains.walletCall(AGENT_ACCOUNT, step.call);
  if (r.status === 402 && r.body.before?.length) r = await prepare();
  if (r.status !== 402 || !r.body.purchase)
    throw new Error(`agent hires agent: ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
  const p = r.body.purchase;
  const made = await me(`/api/customer/offers/${offer}/purchases`, "POST", {
    idempotency_key: "demo-a2a-buy",
    units: p.units,
    install,
    terms_digest: p.terms_digest,
  });
  const id = made.body.purchase.id as string;
  const tx = w.chains.walletCall(AGENT_ACCOUNT, p.call) as Json;
  const hash = String(tx.transaction.hash);
  await me(`/api/customer/purchases/${id}/requested`, "POST", { tx_hash: hash });
  const checked = await me(`/api/customer/purchases/${id}/check`, "POST", { tx_hash: hash });
  if (checked.body.resolution?.kind !== "confirmed")
    throw new Error(`agent hires agent purchase: ${JSON.stringify(checked.body.resolution)}`);
  const used = await w.use(me, offer, invoice);
  if (!used.ok || used.unit !== "charged")
    throw new Error(`agent hires agent use: ${JSON.stringify(used)}`);
  return { person: me.id, use: used.id };
}
