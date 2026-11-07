// Promise 2: an external role is never shown as moved before the other chain finalized it. The new
// owner moves the feed's controller role; the move is included on the synthetic EVM chain but not
// final (3 blocks). The companions view is read at that moment.

import { describe, expect, it } from "vitest";
import { type ReviewWorld, reviewWorld } from "./world.ts";

async function pendingMove(r: ReviewWorld) {
  const c = r.companions as NonNullable<typeof r.companions>;
  await r.deal.propose();
  await r.deal.close();
  const move = await r.c.prepare(r.noah, "feed_move");
  expect(move.status, JSON.stringify(move.body)).toBe(200);
  const out = r.wallet(r.BUYER, move.body.call);
  const sent = await r.c.sent(r.noah, move.body.id, out.transaction.hash);
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  expect(sent.body.state).toBe("external_pending");
  expect(c.registry.statusOf(sent.body.evm_hash)).toBe("pending");
  return c;
}

describe("pr18 the controller role, included but not final on the other chain", () => {
  it("is not reported at the new owner's generation while the move is pending", async () => {
    const r = await reviewWorld();
    const c = await pendingMove(r);
    const v = (await r.c.view(r.noah)).body;
    expect(v.asset.move.state).toBe("external_pending");
    // Not final yet: the role is still reported where it was (generation 1), not at generation 2.
    expect(v.asset.controller_generation).toBe(1);
    c.registry.mine(3);
    const after = (await r.c.view(r.noah)).body;
    expect(after.asset.move.state).toBe("external_final");
    expect(after.asset.controller_generation).toBe(2);
  });

  it("a second move request while one is pending is refused as pending, not as already moved", async () => {
    const r = await reviewWorld();
    await pendingMove(r);
    const again = await r.c.prepare(r.noah, "feed_move");
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("move_pending");
  });
});
