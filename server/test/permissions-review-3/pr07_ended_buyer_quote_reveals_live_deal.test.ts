// Promise 3: a buyer whose deal ended reads nothing current, not the business's live deal. The sale
// page hides it (control.live_deal is null for a past participant). The quote route, and the sale
// prepare route, answer the same ended buyer differently depending on whether a live deal exists.

import { describe, expect, it } from "vitest";
import { reviewWorld } from "./world.ts";

describe("pr07 an ended buyer probes for a live deal", () => {
  it("the quote route answers alike whether or not the business has a live deal with someone else", async () => {
    const r = await reviewWorld();
    await r.deal.propose();
    await r.deal.cancelSeller();
    // Noah's deal ended. The sale page shows him no live deal.
    const none = await r.i.quote(r.noah);
    // The seller now sells to Sam instead.
    await r.deal.propose({ buyer_account: "stranger.near" });
    const page = (await r.setup(r.noah)).body;
    expect(page.control.live_deal).toBeNull();
    const some = await r.i.quote(r.noah);
    expect(some.status).toBe(none.status);
    expect(some.body.code).toBe(none.body.code);
  });

  it("the sale prepare route (fund) answers alike too", async () => {
    const r = await reviewWorld();
    await r.deal.propose();
    await r.deal.cancelSeller();
    const none = await r.prepare(r.noah, "fund");
    await r.deal.propose({ buyer_account: "stranger.near" });
    const some = await r.prepare(r.noah, "fund");
    expect(some.status).toBe(none.status);
    expect(some.body.code).toBe(none.body.code);
  });
});
