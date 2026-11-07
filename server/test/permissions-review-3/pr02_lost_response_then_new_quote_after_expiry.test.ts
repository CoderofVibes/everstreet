// Promise 1: the solver fills at most once per deal. Quote A's fill lands, but the solver's answer is
// lost and the verifier's nonce record isn't visible yet (the transaction isn't final: the Nov 6
// testnet run in docs/INTENTS.md), so A is stored "unknown". The buyer never reads A again, waits
// past A's deadline, quotes B and signs it. The verifier spent A's nonce long before.

import { describe, expect, it } from "vitest";
import { GIVE, reviewWorld } from "./world.ts";

describe("pr02 a lost answer, then a second quote after the first expired", () => {
  it("B is refused: A's nonce is spent on the verifier, so this deal was already filled", async () => {
    const r = await reviewWorld();
    await r.deal.propose();
    r.i.deposit(String(BigInt(GIVE) * 2n));
    r.i.registerKey();
    const a = (await r.i.quote()).body;
    // The fill is submitted and lands; its answer is lost and the nonce isn't readable yet.
    r.intents.solver.loseNext = true;
    const realView = r.intents.verifier.view.bind(r.intents.verifier);
    let hideNonce = true;
    r.intents.verifier.view = (m, args) =>
      hideNonce && m === "is_nonce_used" ? JSON.stringify(false) : realView(m, args);
    const sa = await r.i.sign(a);
    expect(sa.body.stage).toBe("unknown");
    expect(r.i.inside(r.BUYER, r.TOKEN)).toBe(BigInt(r.PRICE)); // A did fill
    hideNonce = false; // the verifier's record is readable from now on

    // Nobody reads A again; its quote expires; the buyer quotes once more.
    r.clock.now += 130_000;
    const b = (await r.i.quote()).body;
    const sb = await r.i.sign(b);
    expect(sb.status, JSON.stringify(sb.body)).toBe(409);
    expect(sb.body.code).toBe("already_filled");
    expect(r.i.inside(r.BUYER, r.TOKEN)).toBe(BigInt(r.PRICE));
  });
});
