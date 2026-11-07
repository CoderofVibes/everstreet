// Promise 7: only the current owner runs a business; the server's record follows the contract
// within one watcher pass. The seller proposes through Everstreet, the buyer funds and accepts
// through Everstreet, and the seller accepts with their wallet directly (the CLI, another site):
// the contract closes the sale to the buyer. Nothing here ever recorded the seller's version.

import { describe, expect, it } from "vitest";
import { reviewWorld } from "./world.ts";

describe("pr09 the seller closes the sale with their own wallet, outside Everstreet", () => {
  it("the record follows the contract: the seller's desk ends, the buyer's begins", async () => {
    const r = await reviewWorld();
    await r.deal.propose();
    await r.deal.registerBuyer();
    await r.deal.fund();
    await r.deal.acceptBuyer();
    const out = r.deal.acceptSellerDirect();
    expect(out.status.SuccessValue).toBeDefined();
    const control = r.sale.controlView();
    expect(control.owner).toBe(r.BUYER);
    expect(control.live_deal).toBeNull();

    // Several watcher passes, and the buyer reading their own sale page and checking their action.
    for (let i = 0; i < 3; i++) await r.watcherPass();
    const buyerPage = (await r.setup(r.noah)).body;
    expect(buyerPage.roles.new_owner).toBe(true);

    // The seller's session, members and companions: a former owner now.
    expect((await r.c.config(r.ava)).status, "the former owner's companion list").toBe(404);
    expect((await r.c.economics(r.ava)).status, "the former owner's economics").toBe(404);
    expect(
      (await r.ava(`/api/businesses/${r.biz}/members`)).status,
      "the former owner's team",
    ).toBe(404);
    // The buyer's desk here.
    expect(buyerPage.local_owner, "the buyer owns it here").toBe(true);
    expect((await r.c.config(r.noah)).status, "the buyer's companion list").toBe(200);
  });
});
