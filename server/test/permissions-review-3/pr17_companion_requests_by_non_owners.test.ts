// Promises 3 and 7: companion requests are the current owner's. The buyer (a current participant)
// may read the companions but not prepare a request; a request the seller prepared before the close
// and sends after it is refused by the companion contract and shown so, never relayed.

import { describe, expect, it } from "vitest";
import { reviewWorld } from "./world.ts";

describe("pr17 companion requests by people who don't own the business now", () => {
  it("the live deal's buyer reads the companions but can't prepare a request", async () => {
    const r = await reviewWorld();
    await r.deal.propose();
    const v = await r.c.view(r.noah);
    expect(v.status).toBe(200);
    expect(v.body.you_own_it).toBe(false);
    expect(v.body.allowance.active).toBe(true);
    for (const kind of ["feed_move", "allowance_grant", "allowance_approve"]) {
      const p = await r.c.prepare(r.noah, kind, { invoice: "x" });
      expect(p.status, kind).toBe(409);
      expect(p.body.code, kind).toBe("not_owner");
    }
    expect((await r.c.economics(r.noah)).status).toBe(200);
  });

  it("the seller's approval prepared before the close, sent after it: refused by the contract, shown refused", async () => {
    const r = await reviewWorld();
    const c = r.companions as NonNullable<typeof r.companions>;
    const invoice = "cd".repeat(32);
    c.allowance.pay("agent.synthetic.near", "supplier.synthetic.near", 6_000_000n, invoice);
    await r.deal.propose();
    const p = await r.c.prepare(r.ava, "allowance_approve", { invoice });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    // The sale closes on the contract (the buyer's acceptance; its answer is lost: no check yet).
    await r.deal.acceptSeller();
    await r.deal.registerBuyer();
    await r.deal.fund();
    await r.act(r.noah, r.BUYER, "accept", {}, { lose: true });
    expect(r.sale.controlView().owner).toBe(r.BUYER);
    // The seller's wallet sends the prepared call now.
    const out = r.wallet(r.SELLER, p.body.call);
    const sent = await r.c.sent(r.ava, p.body.id, out.transaction.hash);
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.state).toBe("refused");
    expect(sent.body.result.code).toBe("E_NOT_OWNER");
    expect(c.allowance.payments.get(invoice)?.state).toBe("AwaitingApproval");
    // And the grant ended with the generation: the new owner sees it inactive.
    await r.watcherPass();
    expect((await r.c.view(r.noah)).body.allowance.active).toBe(false);
  });

  it("a move the seller prepared is refused the same way after the close", async () => {
    const r = await reviewWorld();
    const c = r.companions as NonNullable<typeof r.companions>;
    await r.deal.propose();
    // Before the close the role is at the owner's own address: nothing to move.
    const early = await r.c.prepare(r.ava, "feed_move");
    expect(early.body.code).toBe("already_moved");
    await r.deal.acceptSeller();
    await r.deal.registerBuyer();
    await r.deal.fund();
    await r.act(r.noah, r.BUYER, "accept", {}, { lose: true });
    // The former owner, before the record follows: the contract's owner decides.
    const late = await r.c.prepare(r.ava, "feed_move");
    expect(late.status).toBe(409);
    expect(late.body.code).toBe("not_owner");
    expect(c.asset.signed).toBe(0);
    // The new owner prepares the move the role needs (generation 1 → 2).
    const move = await r.c.prepare(r.noah, "feed_move");
    expect(move.status, JSON.stringify(move.body)).toBe(200);
    expect(move.body.review.from_generation).toBe(1);
    expect(move.body.review.to_generation).toBe(2);
  });
});
