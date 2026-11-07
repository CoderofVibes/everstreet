// Promise 3: a buyer whose deal ended (cancelled, expired, or a later sale to someone else) reads
// nothing current: not economics, not companions, not the live deal; they keep their own receipts.

import { describe, expect, it } from "vitest";
import { type ReviewWorld, reviewWorld } from "./world.ts";

async function endedReadsNothing(r: ReviewWorld, label: string) {
  expect((await r.c.economics(r.noah)).status, `${label}: economics`).toBe(404);
  expect((await r.c.view(r.noah)).status, `${label}: companions`).toBe(404);
  expect((await r.c.config(r.noah)).status, `${label}: companion list`).toBe(404);
  const page = (await r.setup(r.noah)).body;
  expect(page.control.live_deal, `${label}: live deal`).toBeNull();
  expect(page.customer_obligations, `${label}: customer totals`).toBeNull();
  expect(page.inventory, `${label}: inventory`).toBeNull();
  expect(page.readiness, `${label}: readiness`).toBeNull();
  for (const o of page.outcomes) expect([o.buyer, o.seller]).toContain(r.BUYER);
  // Their own records stay: party, payouts, actions.
  expect(page.party === null || typeof page.party === "object").toBe(true);
  for (const a of page.actions) expect(a.account).toBe(r.BUYER);
}

describe("pr14 an ended buyer", () => {
  it("after the seller cancels, and after a new deal goes to someone else", async () => {
    const r = await reviewWorld();
    await r.deal.propose();
    await r.deal.registerBuyer();
    await r.deal.fund();
    await r.deal.cancelSeller();
    await endedReadsNothing(r, "cancelled");
    // The escrow came back as a claim Noah can read and collect: his own receipt.
    const page = (await r.setup(r.noah)).body;
    expect(page.party.escrow_return_claim).toBe(r.PRICE);
    // A new deal to Sam.
    await r.deal.propose({ buyer_account: "stranger.near" });
    await endedReadsNothing(r, "later deal to another buyer");
    expect((await r.stranger(`/api/sales/${r.biz}`)).body.control.live_deal.buyer).toBe(
      "stranger.near",
    );
  });

  it("after the offer expires", async () => {
    const r = await reviewWorld();
    await r.deal.propose({ days: 1 });
    (r.w.chain as unknown as { tick: (ms: bigint) => void }).tick(2n * 86_400_000n);
    await r.deal.expire();
    expect(r.sale.controlView().live_deal).toBeNull();
    await endedReadsNothing(r, "expired");
    const q = await r.i.quote(r.noah);
    expect(q.status).toBe(409);
  });

  it("after the business is sold to someone else", async () => {
    const r = await reviewWorld();
    await r.deal.propose();
    await r.deal.cancelSeller();
    // Sam buys it instead.
    (r.w.chain as unknown as { balances: Map<string, bigint> }).balances.set(
      "stranger.near",
      1_000_000_000n,
    );
    await r.deal.propose({ buyer_account: "stranger.near" });
    const sam = r.stranger;
    for (const kind of ["register", "fund", "accept"]) {
      const a = await r.act(sam, "stranger.near", kind);
      expect(r.confirmed(a), `${kind}: ${JSON.stringify(a.p.body)}`).toBe(true);
    }
    await r.deal.acceptSeller();
    expect(r.sale.controlView().owner).toBe("stranger.near");
    await endedReadsNothing(r, "sold to another");
    const page = (await r.setup(r.noah)).body;
    // Noah's own cancelled deal is his receipt; Sam's close is not shown to him.
    expect(
      page.outcomes.map((o: { status: string; buyer: string }) => [o.status, o.buyer]),
    ).toEqual([["cancelled", r.BUYER]]);
    expect(page.handover).toBeNull();
    expect(page.roles).toMatchObject({ buyer: false, new_owner: false, former_seller: false });
    // The new owner and the former seller see their own sides.
    expect((await r.c.economics(sam)).status).toBe(200);
    expect((await r.c.economics(r.ava)).status).toBe(404);
  });
});
