// Promise 7: the record follows the contract within one watcher pass. The seller proposes through
// Everstreet (version 1 is recorded here), then REVISES with their wallet directly (the exact call
// Everstreet's own preview shows; version 2 is never recorded), the buyer accepts version 2 through
// Everstreet, and the seller accepts version 2 with their wallet. The contract closes to the buyer.

import { describe, expect, it } from "vitest";
import { proposal } from "../sale-world.ts";
import { reviewWorld } from "./world.ts";

describe("pr09b the seller revises outside Everstreet, then closes outside Everstreet", () => {
  it("the record still follows: the seller's desk ends, the buyer's begins", async () => {
    const r = await reviewWorld();
    await r.deal.propose();
    // The seller previews a revision (nothing stored) and sends that exact call with their wallet.
    const preview = await r.prepare(r.ava, "revise", proposal({ price: "240000000" }));
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    const out = r.wallet(r.SELLER, preview.body.call);
    expect(out.status.SuccessValue, JSON.stringify(out.status)).toBeDefined();
    expect(r.sale.controlView().live_deal.version).toBe(2);
    // The buyer takes version 2 through Everstreet.
    await r.deal.registerBuyer();
    await r.deal.fund();
    await r.deal.acceptBuyer();
    // The seller closes it with their wallet.
    r.deal.acceptSellerDirect();
    const control = r.sale.controlView();
    expect(control.owner).toBe(r.BUYER);
    expect(control.generation).toBe(2);

    for (let i = 0; i < 3; i++) await r.watcherPass();
    const buyerPage = (await r.setup(r.noah)).body;
    expect(buyerPage.roles.new_owner).toBe(true);
    // Finding 6 (fixed): the close at the version the seller introduced outside Everstreet was
    // applied to the recorded intent between the same two parties; the new owner reads it.
    const intents = (await r.noah(`/api/businesses/${r.biz}/v3/intents`)).body;
    const v1 = intents.intents.find((i: { deal: { version: number } }) => i.deal.version === 1);
    expect(v1?.status, JSON.stringify(intents).slice(0, 300)).toBe("applied");
    expect((await r.c.config(r.ava)).status, "the former owner's companion list").toBe(404);
    expect((await r.c.economics(r.ava)).status, "the former owner's economics").toBe(404);
    expect((await r.c.view(r.ava)).status, "the former owner's companions").toBe(404);
    expect(
      (await r.ava(`/api/businesses/${r.biz}/members`)).status,
      "the former owner's team",
    ).toBe(404);
    expect(buyerPage.local_owner, "the buyer owns it here").toBe(true);
    expect((await r.c.config(r.noah)).status, "the buyer's companion list").toBe(200);
  });
});
