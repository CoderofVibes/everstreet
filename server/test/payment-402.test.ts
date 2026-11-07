// HTTP 402 for a customer who pays per use, here an agent signed in with its own NEAR account
// (the fixture's fresh customer account): with no units it gets 402 and the exact purchase; it
// sends the purchase from its own account; the units exist only from the contract's own receipt.
// A payment answer naming someone else's transaction grants nothing.

import { describe, expect, it } from "vitest";
import {
  CUSTOMER,
  customerWorld,
  FRESH,
  type Json,
  SyntheticProtection,
} from "./customer-world.ts";

const PK = "ab".repeat(32);

async function world() {
  const w = await customerWorld({ customer: { protection: new SyntheticProtection() } });
  const offer = await w.offer();
  const agent = w.dana; // signed in as its own account (FRESH), like any customer
  const prepare = (key: string, buy: Json = { units: 3 }) =>
    agent(`/api/customer/offers/${offer}/prepare`, "POST", {
      idempotency_key: key,
      input: "Summarize this week's alerts.",
      key_slot: 1,
      buy: { ...buy, install: { slot: 1, pk: PK, max_hold_units: 2, max_units_per_day: 50 } },
    });
  return { w, offer, agent, prepare };
}

describe("HTTP 402: a customer with no units gets the exact purchase", () => {
  it("402 with the steps, then the purchase; units come only from the contract's receipt", async () => {
    const { w, offer, agent, prepare } = await world();

    // No registration yet: 402, with the registration call first.
    let r = await prepare("agent-use-0001");
    expect(r.status).toBe(402);
    expect(r.body).toMatchObject({
      code: "payment_required",
      reason: "no_entitlement",
      offer: { payer: FRESH, plan_id: expect.any(Number) },
      purchase: null,
    });
    expect(r.body.before.map((b: Json) => b.step)).toEqual(["registration"]);
    w.chain.walletCall(FRESH, r.body.before[0].call);

    // Registered, still no units: 402 with the exact buy call and its digest.
    r = await prepare("agent-use-0002");
    expect(r.status).toBe(402);
    expect(r.body.before).toEqual([]);
    expect(r.body.purchase).toMatchObject({
      units: 3,
      call: { methodName: "ft_transfer_call", deposit: "1" },
      terms_digest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    const p = r.body.purchase;

    // Someone else's transaction named as the payment grants nothing.
    const other = w.chain.walletCall(CUSTOMER, {
      ...p.call,
      args: { ...p.call.args },
    } as never);
    const created = await agent(`/api/customer/offers/${offer}/purchases`, "POST", {
      idempotency_key: "agent-buy-0001",
      units: 3,
      install: { slot: 1, pk: PK, max_hold_units: 2, max_units_per_day: 50 },
      terms_digest: p.terms_digest,
    });
    expect(created.status).toBe(201);
    const id = created.body.purchase.id;
    const forged = await agent(`/api/customer/purchases/${id}/check`, "POST", {
      tx_hash: other.transaction.hash,
    });
    expect(forged.body.resolution?.kind ?? forged.body.purchase?.state).not.toBe("confirmed");
    expect((await prepare("agent-use-0003")).status).toBe(402);

    // The agent's own purchase: confirmed by the contract's receipt, then the use is prepared.
    const sent = w.chain.walletCall(FRESH, p.call);
    await agent(`/api/customer/purchases/${id}/requested`, "POST", {
      tx_hash: sent.transaction.hash,
    });
    const checked = await agent(`/api/customer/purchases/${id}/check`, "POST", {
      tx_hash: sent.transaction.hash,
    });
    expect(checked.body.resolution).toEqual({ kind: "confirmed", units: 3, amount: p.amount });
    r = await prepare("agent-use-0004");
    expect(r.status).toBe(201);

    // The owner sees each 402 and what the contract confirmed for it.
    const owner = await w.owner(`/api/businesses/${w.f.business}/agent-purchases`);
    expect(owner.status).toBe(200);
    expect(owner.body.totals).toMatchObject({ units_granted: 3 });
    expect(owner.body.offers.some((o: Json) => o.purchase?.state === "confirmed")).toBe(true);
    // Nobody else sees it.
    expect((await agent(`/api/businesses/${w.f.business}/agent-purchases`)).status).toBe(404);
  });
});
