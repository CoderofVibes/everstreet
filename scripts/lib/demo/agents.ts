// Two fictional agents meet Signalwatch's HTTP 402 in the demo, each signed in with its own
// account as its own customer: one registers, buys three units from its own account and has the
// purchase confirmed by the contract's receipt; the other gets the exact offer and doesn't pay.
// The owner's "Agent purchases" desk page shows both. Synthetic chain, test tokens.

import type { Json } from "../../../server/test/customer-world.ts";
import { ACCOUNTS, type DemoWorld } from "./world.ts";

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
