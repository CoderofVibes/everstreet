// Promise 9 and 5: only the sale's buyer quotes and signs, and a funding id is nobody else's.
import { describe, expect, it } from "vitest";
import { BUYER, nearKey, reviewWorld } from "./world.ts";

describe("pr03: who may quote, read and sign an intents funding", () => {
  it("a stranger, the seller and a customer can't quote; the buyer can", async () => {
    const w = await reviewWorld();
    await w.proposeAndRegister();
    expect((await w.quote(w.stranger)).status).toBe(404);
    expect((await w.quote(w.cara)).status).toBe(404);
    const seller = await w.quote(w.ava);
    // Review 3, finding 4: one answer for anyone who isn't the live deal's buyer.
    expect(seller.status).toBe(409);
    expect(seller.body.code).toBe("no_deal");
    expect((await w.quote(w.noah, "other.token.near")).status).toBe(400);
    expect((await w.quote(w.noah)).status).toBe(200);
  });

  it("nobody else reads or signs the buyer's quote", async () => {
    const w = await reviewWorld();
    await w.proposeAndRegister();
    const q = await w.quote(w.noah);
    const key = nearKey();
    w.registerKey(BUYER, key.publicKey);
    w.deposit(q.body.give.amount);
    const body = { public_key: key.publicKey, signature: w.signQuote(key, q.body) };
    for (const who of [w.ava, w.stranger, w.cara]) {
      expect((await who(`/api/intents/${q.body.id}`)).status).toBe(404);
      expect((await w.signIntent(who, q.body.id, body)).status).toBe(404);
    }
    expect((await w.signIntent(w.noah, "not-a-real-id", body)).status).toBe(404);
    // The buyer's own panel: the funding is theirs.
    const panel = await w.noah(`/api/sales/${w.biz}/intents`);
    expect(panel.status).toBe(200);
    expect(panel.body.funding?.id).toBe(q.body.id);
    // The seller's panel shows no funding of the buyer's.
    const sellerPanel = await w.ava(`/api/sales/${w.biz}/intents`);
    expect(sellerPanel.status).toBe(200);
    expect(sellerPanel.body.funding).toBeNull();
    expect(w.solverFloat()).toBe(5_000_000_000n);
  });

  it("a signature by an unregistered key, or over another quote, is refused", async () => {
    const w = await reviewWorld();
    await w.proposeAndRegister();
    const q = await w.quote(w.noah);
    const key = nearKey();
    w.deposit(q.body.give.amount);
    // Not registered with the verifier: refused before any fill.
    const unregistered = await w.signIntent(w.noah, q.body.id, {
      public_key: key.publicKey,
      signature: w.signQuote(key, q.body),
    });
    expect(unregistered.status).toBe(409);
    expect(unregistered.body.code).toBe("key_not_registered");
    w.registerKey(BUYER, key.publicKey);
    // A signature over a different message.
    const other = { ...q.body, sign: { ...q.body.sign, message: `${q.body.sign.message} ` } };
    const wrong = await w.signIntent(w.noah, q.body.id, {
      public_key: key.publicKey,
      signature: w.signQuote(key, other),
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe("bad_signature");
    expect(w.solverFloat()).toBe(5_000_000_000n);
  });

  it("no response carries the solver's key", async () => {
    const w = await reviewWorld();
    await w.proposeAndRegister();
    const q = await w.quote(w.noah);
    const panel = await w.noah(`/api/sales/${w.biz}/intents`);
    for (const text of [JSON.stringify(q.body), JSON.stringify(panel.body)]) {
      expect(text).not.toMatch(/private|secret/i);
      expect(text).toContain("solver.synthetic.near");
      expect(text).not.toContain(w.intents.solver.publicKey.slice(8, 20));
    }
  });
});
