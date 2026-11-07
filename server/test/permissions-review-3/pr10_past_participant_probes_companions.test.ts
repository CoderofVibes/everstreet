// Promise 4: which businesses have companions is the owner's to know. A buyer whose deal ended is
// no longer a current participant, yet still passes the sale gate. The companion prepare route
// answers them differently for a business with companions and one without.

import { describe, expect, it } from "vitest";
import { reviewWorld } from "./world.ts";

describe("pr10 an ended buyer asks to prepare a companion request", () => {
  it("is answered alike for a business with companions and one without", async () => {
    const withC = await reviewWorld();
    const without = await reviewWorld({ companions: false });
    for (const r of [withC, without]) {
      await r.deal.propose();
      await r.deal.cancelSeller();
      // The current readings are refused, as promised.
      expect((await r.c.view(r.noah)).status).toBe(404);
      expect((await r.c.economics(r.noah)).status).toBe(404);
    }
    const a = await withC.c.prepare(withC.noah, "feed_move");
    const b = await without.c.prepare(without.noah, "feed_move");
    expect(a.status, JSON.stringify([a.body, b.body])).toBe(b.status);
    expect(a.body.code).toBe(b.body.code);
  });

  it("and the intents panel is answered alike for a business with intents funding and one without", async () => {
    const withI = await reviewWorld();
    await withI.deal.propose();
    await withI.deal.cancelSeller();
    const a = await withI.i.panel(withI.noah);
    // The same world without the intents binding.
    const bare = await reviewWorld();
    bare.w.state.app = bare.w.make(bare.w.state.store);
    await bare.deal.propose();
    await bare.deal.cancelSeller();
    const b = await bare.i.panel(bare.noah);
    expect(a.status, JSON.stringify([a.body, b.body])).toBe(b.status);
  });
});
