// Promise 1: the solver fills at most once per deal. The buyer takes two quotes for the same deal,
// deposits enough for both, and sends both signatures in the same instant.

import { describe, expect, it } from "vitest";
import { GIVE, reviewWorld } from "./world.ts";

describe("pr01 two quotes for one deal, signed at the same time", () => {
  it("the solver fills only one of them", async () => {
    const r = await reviewWorld();
    await r.deal.propose();
    const a = (await r.i.quote()).body;
    const b = (await r.i.quote()).body;
    expect(a.id).not.toBe(b.id);
    r.i.deposit(String(BigInt(GIVE) * 2n));
    r.i.registerKey();
    const floatBefore = r.i.inside("solver.synthetic.near", r.TOKEN);

    const [sa, sb] = await Promise.all([r.i.sign(a), r.i.sign(b)]);
    const swapped = [sa, sb].filter((s) => s.status === 200 && s.body.stage === "swapped");
    const refused = [sa, sb].filter((s) => s.status === 409 && s.body.code === "already_filled");
    // One fill, one refusal; the solver's float moved by exactly one price.
    expect(swapped.length, JSON.stringify([sa.body, sb.body])).toBe(1);
    expect(refused.length).toBe(1);
    expect(floatBefore - r.i.inside("solver.synthetic.near", r.TOKEN)).toBe(BigInt(r.PRICE));
    expect(r.i.inside(r.BUYER, r.TOKEN)).toBe(BigInt(r.PRICE));
  });
});
