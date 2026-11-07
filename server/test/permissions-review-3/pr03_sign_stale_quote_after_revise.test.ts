// Promise 1: the solver fills only a quote whose conditions still hold. The seller revises the
// deal (same sequence, a new version, a lower price) between the buyer's quote and signature.
// The quote was for the old price; it is no longer a quote for this deal's terms.

import { describe, expect, it } from "vitest";
import { reviewWorld } from "./world.ts";

describe("pr03 the buyer signs a quote taken before the terms were revised", () => {
  it("is refused: the quote's version and price are not the live deal's", async () => {
    const r = await reviewWorld();
    await r.deal.propose();
    const q = (await r.i.quote()).body;
    expect(q.version).toBe(1);
    r.i.deposit();
    r.i.registerKey();
    await r.deal.revise({ price: "100000000" });
    expect(r.sale.controlView().live_deal.version).toBe(2);
    const s = await r.i.sign(q);
    expect(s.status, JSON.stringify(s.body)).toBe(409);
    expect(r.i.inside(r.BUYER, r.TOKEN)).toBe(0n);
  });
});
