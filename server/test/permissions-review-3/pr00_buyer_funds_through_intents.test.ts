// Baseline: the deal's buyer quotes, deposits, registers a key, signs, withdraws and funds, and the
// stages follow the chain. Every later attack starts from this working path.

import { describe, expect, it } from "vitest";
import { reviewWorld } from "./world.ts";

describe("pr00 the buyer funds escrow through the intents verifier", () => {
  it("quoted → deposited → swapped → delivered → funded, each read from the chain", async () => {
    const r = await reviewWorld();
    await r.deal.propose();
    const q = await r.i.quote();
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    expect(q.body.stage).toBe("quoted");
    expect(q.body.give.amount).toBe("312500000");
    // The solver is labelled, and only by account and source.
    expect(Object.keys(q.body.solver).sort()).toEqual(["account", "source"]);

    r.i.deposit();
    expect((await r.i.status(q.body.id)).body.stage).toBe("deposited");

    // Unregistered key: refused before anything is submitted.
    const early = await r.i.sign(q.body);
    expect(early.status).toBe(409);
    expect(early.body.code).toBe("key_not_registered");
    r.i.registerKey();
    const s = await r.i.sign(q.body);
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(s.body.stage).toBe("swapped");
    expect(r.i.inside(r.BUYER, r.TOKEN)).toBe(BigInt(r.PRICE));

    await r.deal.registerBuyer();
    r.i.withdraw();
    expect((await r.i.status(q.body.id)).body.stage).toBe("delivered");
    await r.deal.fund();
    expect((await r.i.status(q.body.id)).body.stage).toBe("funded");
    expect(r.sale.controlView().live_deal.escrow).toBe(r.PRICE);
  });
});
