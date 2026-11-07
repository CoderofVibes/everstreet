// Promise 9: the intents flow funds a sale only while its escrow is unfunded, and nobody can make
// the solver pay for a swap that doesn't fund a real sale. The quote checks that; does the sign?
import { describe, expect, it } from "vitest";
import { ALT_TOKEN, BUYER, nearKey, PRICE, reviewWorld, SELLER } from "./world.ts";

describe("pr01: the buyer signs a quote after the escrow was funded another way", () => {
  it("the solver refuses to fill a swap that no longer funds the sale", async () => {
    const w = await reviewWorld();
    await w.proposeAndRegister();
    const q = await w.quote(w.noah);
    expect(q.status).toBe(200);
    expect(q.body.stage).toBe("quoted");
    const key = nearKey();
    w.registerKey(BUYER, key.publicKey);
    w.deposit(q.body.give.amount);
    // Meanwhile the buyer funds the escrow directly with their own tUSD (the ordinary fund request).
    const funded = await w.act(w.noah, BUYER, "fund");
    expect(funded.check?.body.resolution?.kind).toBe("confirmed");
    expect(String(w.sale.controlView().live_deal?.escrow)).toBe(PRICE);
    const floatBefore = w.solverFloat();
    // Then signs the still-open quote. The promise: only while the escrow is unfunded.
    const r = await w.signIntent(w.noah, q.body.id, {
      public_key: key.publicKey,
      signature: w.signQuote(key, q.body),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(w.solverFloat()).toBe(floatBefore);
    expect(w.intents.verifier.nonces.size).toBe(0);
  });

  it("the solver refuses to fill after the deal was cancelled", async () => {
    const w = await reviewWorld();
    await w.proposeAndRegister();
    const q = await w.quote(w.noah);
    expect(q.status).toBe(200);
    const key = nearKey();
    w.registerKey(BUYER, key.publicKey);
    w.deposit(q.body.give.amount);
    const cancelled = await w.act(w.ava, SELLER, "cancel");
    expect(cancelled.check?.body.resolution?.kind).toBe("confirmed");
    expect(w.sale.controlView().live_deal).toBeNull();
    const floatBefore = w.solverFloat();
    const r = await w.signIntent(w.noah, q.body.id, {
      public_key: key.publicKey,
      signature: w.signQuote(key, q.body),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(w.solverFloat()).toBe(floatBefore);
  });

  it("control: a plain quote, deposit and sign swaps once", async () => {
    const w = await reviewWorld();
    await w.proposeAndRegister();
    const q = await w.quote(w.noah, ALT_TOKEN);
    const key = nearKey();
    w.registerKey(BUYER, key.publicKey);
    w.deposit(q.body.give.amount);
    const r = await w.signIntent(w.noah, q.body.id, {
      public_key: key.publicKey,
      signature: w.signQuote(key, q.body),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.stage).toBe("swapped");
  });
});
