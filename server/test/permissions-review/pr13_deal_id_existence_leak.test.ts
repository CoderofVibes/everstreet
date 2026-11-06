// Permissions review, promise 5 (guessing ids): an unrelated signed-in account must get the same
// 404 for a deal it isn't part of as for a deal that doesn't exist. `fund`, `test-dollars`,
// `withdraw-hold` and `items/:key` check the representative only, so a stranger learns the deal
// exists (403) and nothing else.
import { describe, expect, it } from "vitest";
import { fundedDeal } from "../deal-world.ts";

describe("pr13: deal ids reveal existence to strangers", () => {
  it("a stranger gets 404, not 403, on another team's deal", async () => {
    const w = await fundedDeal();
    const sam = await w.join("Sam Outsider");
    const missing = "00000000-0000-4000-8000-000000000000";
    expect((await sam(`/api/deals/${missing}/fund`, "POST")).status).toBe(404);
    for (const path of [
      `/api/deals/${w.deal.id}/fund`,
      `/api/deals/${w.deal.id}/test-dollars`,
      `/api/deals/${w.deal.id}/withdraw-hold`,
      `/api/deals/${w.deal.id}/items/booking_service`,
    ])
      expect([path, (await sam(path, "POST", { note: "x" })).status]).toEqual([path, 404]);
    // The view itself is refused with 404 (for comparison).
    expect((await sam(`/api/deals/${w.deal.id}`)).status).toBe(404);
  });
});
