// Promise 5 and 1: a business's configuration isn't readable through its id by anyone signed in,
// and a companion request the owner prepared before the close does nothing after it.
import { describe, expect, it } from "vitest";
import { reviewWorld, SELLER } from "./world.ts";

describe("pr06: the companions' configuration and queued requests", () => {
  it("a stranger learns nothing from /api/businesses/:id/companions", async () => {
    const w = await reviewWorld();
    const mine = await w.ava(`/api/businesses/${w.biz}/companions`);
    expect(mine.status).toBe(200);
    expect(mine.body).toEqual({ asset: true, allowance: true });
    const theirs = await w.stranger(`/api/businesses/${w.biz}/companions`);
    expect(theirs.status, JSON.stringify(theirs.body)).toBe(404);
    const signedOut = await w.w.state.app.request(`/api/businesses/${w.biz}/companions`);
    expect(signedOut.status).toBe(401);
  });

  it("a move of the external role prepared before the close is refused by the companion", async () => {
    const w = await reviewWorld();
    // Generation 1's address controls the registry; a move needs a later generation. Build the
    // picture after a sale instead: the seller prepares a grant repeat before the close.
    const awaiting = w.sha("supplier-invoice-monthly-tier");
    w.companions.allowance.pay(w.AGENT, w.SUPPLIER, 6_300_000n, awaiting);
    const before = await w.ava(`/api/companions/${w.biz}`);
    expect(before.status).toBe(200);
    expect(before.body.you_own_it).toBe(true);
    expect(before.body.allowance.awaiting.map((p: { invoice: string }) => p.invoice)).toContain(
      awaiting,
    );
    const prepared = await w.ava(`/api/companions/${w.biz}/prepare`, "POST", {
      kind: "allowance_approve",
      input: { invoice: awaiting },
    });
    expect(prepared.status, JSON.stringify(prepared.body)).toBe(200);
    await w.proposeAndRegister();
    await w.fundAndClose();
    // The former owner's wallet sends the prepared call now.
    const out = w.wallet(SELLER, prepared.body.call);
    const sent = await w.ava(`/api/companions/actions/${prepared.body.id}/sent`, "POST", {
      tx_hash: out.transaction.hash,
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.state).toBe("refused");
    expect(sent.body.result?.code).toMatch(/E_NOT_OWNER/);
    // The invoice is still awaiting approval: nothing was paid.
    expect(w.companions.allowance.payments.get(awaiting)?.state).toBe("AwaitingApproval");
  });

  it("the new owner moves the external role; the former owner's prepared move is nobody's", async () => {
    const w = await reviewWorld();
    await w.proposeAndRegister();
    await w.fundAndClose();
    const view = await w.noah(`/api/companions/${w.biz}`);
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    expect(view.body.control.generation).toBe(2);
    expect(view.body.asset.controller_generation).toBe(1);
    const move = await w.noah(`/api/companions/${w.biz}/prepare`, "POST", {
      kind: "feed_move",
      input: {},
    });
    expect(move.status, JSON.stringify(move.body)).toBe(200);
    expect(move.body.review.from_generation).toBe(1);
    expect(move.body.review.to_generation).toBe(2);
    // The former owner can't act on the new owner's request id.
    const stolen = await w.ava(`/api/companions/actions/${move.body.id}/sent`, "POST", {
      tx_hash: "11111111111111111111111111111111111111111111",
    });
    expect(stolen.status).toBe(404);
    // Nor send the new owner's call from their own wallet and have it count.
    const out = w.wallet(SELLER, move.body.call);
    const sent = await w.noah(`/api/companions/actions/${move.body.id}/sent`, "POST", {
      tx_hash: out.transaction.hash,
    });
    expect(sent.status).toBe(409);
    expect(sent.body.code).toBe("not_this_request");
  });
});
