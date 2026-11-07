// Promise 1: the solver fills only while the deal is live and the quote is for that deal. The seller
// cancels after the quote; later a new deal (a new sequence) names the same buyer. Also: a quote
// taken twice and signed one after the other.

import { describe, expect, it } from "vitest";
import { GIVE, reviewWorld } from "./world.ts";

describe("pr06 a quote outlives its deal", () => {
  it("cancel, then sign: refused; re-propose (new seq), then sign the old quote: refused", async () => {
    const r = await reviewWorld();
    await r.deal.propose();
    const q = (await r.i.quote()).body;
    r.i.deposit();
    r.i.registerKey();
    await r.deal.cancelSeller();
    const s1 = await r.i.sign(q);
    expect(s1.status).toBe(409);
    expect(s1.body.code).toBe("no_deal");
    expect(r.i.inside(r.BUYER, r.TOKEN)).toBe(0n);
    // A fresh quote now is refused too (no live deal).
    expect((await r.i.quote()).status).toBe(409);
    // A new deal to the same buyer; the old quote is for the old sequence. Signing it again
    // answers the stored refusal (nothing is attempted again).
    await r.deal.propose();
    expect(r.sale.controlView().live_deal.seq).not.toBe(q.deal_seq);
    const s2 = await r.i.sign(q);
    expect(s2.status).toBe(200);
    expect(s2.body.stage).toBe("refused");
    expect(r.i.inside(r.BUYER, r.TOKEN)).toBe(0n);
    // The row was marked refused; the stage says so, with the deposit still inside.
    const st = (await r.i.status(q.id)).body;
    expect(st.stage).toBe("refused");
    expect(st.give.inside).toBe(GIVE);
  });

  it("quote, cancel (no signature yet), re-propose: the untouched old quote is refused for the new deal", async () => {
    const r = await reviewWorld();
    await r.deal.propose();
    const q = (await r.i.quote()).body;
    r.i.deposit();
    r.i.registerKey();
    await r.deal.cancelSeller();
    await r.deal.propose();
    const s = await r.i.sign(q);
    expect(s.status).toBe(409);
    expect(s.body.code).toBe("no_deal");
    expect(r.i.inside(r.BUYER, r.TOKEN)).toBe(0n);
  });

  it("quote twice, sign both one after the other: the second is refused as already filled", async () => {
    const r = await reviewWorld();
    await r.deal.propose();
    const a = (await r.i.quote()).body;
    const b = (await r.i.quote()).body;
    r.i.deposit(String(BigInt(GIVE) * 2n));
    r.i.registerKey();
    expect((await r.i.sign(a)).body.stage).toBe("swapped");
    const sb = await r.i.sign(b);
    expect(sb.status).toBe(409);
    expect(sb.body.code).toBe("already_filled");
    expect(r.i.inside(r.BUYER, r.TOKEN)).toBe(BigInt(r.PRICE));
  });

  it("a funded escrow refuses a new quote and a signature on an older one", async () => {
    const r = await reviewWorld();
    await r.deal.propose();
    const q = (await r.i.quote()).body;
    r.i.deposit();
    r.i.registerKey();
    await r.deal.registerBuyer();
    await r.deal.fund();
    expect((await r.i.quote()).body.code).toBe("funded");
    const s = await r.i.sign(q);
    expect(s.status).toBe(409);
    expect(s.body.code).toBe("funded");
    expect(r.i.inside(r.BUYER, r.TOKEN)).toBe(0n);
  });
});
