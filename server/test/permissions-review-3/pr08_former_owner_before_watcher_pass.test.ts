// Promise 3: a former owner reads nothing current. The sale closed on the contract (the buyer's
// acceptance landed; its answer never reached Everstreet, so no check ran) and the watcher has not
// passed yet. The seller's record here still says owner. Economics and companions are read "for a
// current participant"; the contract already says who that is.

import { describe, expect, it } from "vitest";
import { reviewWorld } from "./world.ts";

describe("pr08 the former owner, after the close on the contract, before the record follows", () => {
  it("economics, companions and the companion list are refused as to anyone else", async () => {
    const r = await reviewWorld();
    await r.deal.propose();
    await r.deal.acceptSeller(); // recorded here first (a version the watcher can follow)
    await r.deal.registerBuyer();
    await r.deal.fund();
    // The buyer's acceptance closes the sale on the contract; its answer is lost (no check).
    const a = await r.act(r.noah, r.BUYER, "accept", {}, { lose: true });
    expect(a.outcome?.status.SuccessValue).toBeDefined();
    const control = r.sale.controlView();
    expect(control.owner).toBe(r.BUYER);
    expect(control.generation).toBe(2);

    const econ = await r.c.economics(r.ava);
    const comp = await r.c.view(r.ava);
    const list = await r.c.config(r.ava);
    const page = (await r.setup(r.ava)).body;
    expect(econ.status, "economics for the former owner").toBe(404);
    expect(comp.status, "companions for the former owner").toBe(404);
    expect(list.status, "the companion list for the former owner").toBe(404);
    expect(page.customer_obligations, "customer totals on the former owner's sale page").toBeNull();

    // After one watcher pass the record follows and the same reads are refused.
    await r.watcherPass();
    expect((await r.c.economics(r.ava)).status).toBe(404);
    expect((await r.c.view(r.ava)).status).toBe(404);
    expect((await r.c.config(r.ava)).status).toBe(404);
    expect((await r.c.config(r.noah)).status).toBe(200);
  });
});
