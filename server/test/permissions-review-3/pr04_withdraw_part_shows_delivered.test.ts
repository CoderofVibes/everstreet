// Promise 2: tUSD is never shown as delivered when it did not leave the verifier. After the swap
// the buyer withdraws one base unit of the 250 tUSD; the rest stays inside the verifier.

import { describe, expect, it } from "vitest";
import { reviewWorld } from "./world.ts";

describe("pr04 the buyer withdraws a sliver of the swapped tUSD", () => {
  it("the stage stays swapped while the price is still inside the verifier", async () => {
    const r = await reviewWorld();
    await r.deal.propose();
    const q = (await r.i.quote()).body;
    r.i.deposit();
    r.i.registerKey();
    expect((await r.i.sign(q)).body.stage).toBe("swapped");
    await r.deal.registerBuyer();
    r.i.withdraw("1");
    const left = r.i.inside(r.BUYER, r.TOKEN);
    expect(left).toBe(BigInt(r.PRICE) - 1n);
    const s = (await r.i.status(q.id)).body;
    expect(s.get.inside).toBe(String(left));
    expect(s.stage).toBe("swapped");
  });
});
