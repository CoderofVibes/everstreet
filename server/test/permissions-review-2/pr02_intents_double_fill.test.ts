// Promise 9: the solver fills once per quote, and never for a swap that doesn't fund a real sale.
import { describe, expect, it } from "vitest";
import { BUYER, nearKey, PRICE, reviewWorld } from "./world.ts";

describe("pr02: getting the solver to fill twice", () => {
  it("two concurrent signs of one quote fill once", async () => {
    const w = await reviewWorld();
    await w.proposeAndRegister();
    const q = await w.quote(w.noah);
    const key = nearKey();
    w.registerKey(BUYER, key.publicKey);
    w.deposit(q.body.give.amount);
    const floatBefore = w.solverFloat();
    const body = { public_key: key.publicKey, signature: w.signQuote(key, q.body) };
    const [a, b] = await Promise.all([
      w.signIntent(w.noah, q.body.id, body),
      w.signIntent(w.noah, q.body.id, body),
    ]);
    // Exactly one fill: the solver's float moved by exactly the price, once.
    expect(floatBefore - w.solverFloat()).toBe(BigInt(PRICE));
    const status = await w.noah(`/api/intents/${q.body.id}`);
    expect(status.body.stage).toBe("swapped");
    expect([a.status, b.status].filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
  });

  it("two open quotes for one sale don't both get filled", async () => {
    const w = await reviewWorld();
    await w.proposeAndRegister();
    const q1 = await w.quote(w.noah);
    const q2 = await w.quote(w.noah);
    expect(q1.status).toBe(200);
    expect(q2.status).toBe(200);
    expect(q1.body.id).not.toBe(q2.body.id);
    const key = nearKey();
    w.registerKey(BUYER, key.publicKey);
    w.deposit(String(BigInt(q1.body.give.amount) * 2n));
    const floatBefore = w.solverFloat();
    const a = await w.signIntent(w.noah, q1.body.id, {
      public_key: key.publicKey,
      signature: w.signQuote(key, q1.body),
    });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(a.body.stage).toBe("swapped");
    // The sale's price is now in the buyer's hands; a second fill funds nothing.
    const b = await w.signIntent(w.noah, q2.body.id, {
      public_key: key.publicKey,
      signature: w.signQuote(key, q2.body),
    });
    expect(b.status, JSON.stringify(b.body)).toBe(409);
    expect(floatBefore - w.solverFloat()).toBe(BigInt(PRICE));
  });
});
