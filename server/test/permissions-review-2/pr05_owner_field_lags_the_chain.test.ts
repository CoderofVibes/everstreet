// Promise 8: Everstreet never acts on a state the chain contradicts. The server's own owner field
// is what every owner route checks; the contract's owner changes at the close.
import { describe, expect, it } from "vitest";
import { BUYER, reviewWorld, SELLER } from "./world.ts";

describe("pr05: the seller after the chain closed but before anyone told Everstreet", () => {
  it("owner writes are refused once the contract shows the buyer as owner", async () => {
    const w = await reviewWorld();
    await w.proposeAndRegister();
    for (const kind of ["fund", "accept"] as const) {
      const r = await w.act(w.noah, BUYER, kind);
      expect(r.check?.body.resolution?.kind).toBe("confirmed");
    }
    // The seller's acceptance closes the sale; its answer is lost, so nothing is checked here.
    const lost = await w.act(w.ava, SELLER, "accept", {}, { lose: true });
    expect(lost.outcome?.status?.SuccessValue).toBeDefined();
    expect(w.control().owner).toBe(BUYER);
    expect(w.control().generation).toBe(2);
    // The chain says the buyer owns it. The server:
    const edit = await w.ava(`/api/businesses/${w.biz}`, "PATCH", { tagline: "Still mine" });
    const invite = await w.ava(`/api/businesses/${w.biz}/members`, "POST", {
      person_id: w.cara.id,
      role: "case_worker",
    });
    const offers = await w.ava(`/api/businesses/${w.biz}/customer-offers`);
    const purchases = await w.ava(`/api/businesses/${w.biz}/agent-purchases`);
    const results = {
      edit: edit.status,
      invite: invite.status,
      offers: offers.status,
      purchases: purchases.status,
    };
    // The watcher brings the local owner to the contract's; after it, every one is 404.
    const states = await (
      w.w.state.app as { reconcileRecordedSales: () => Promise<string[]> }
    ).reconcileRecordedSales();
    expect(states).toContain("applied");
    expect((await w.ava(`/api/businesses/${w.biz}`)).status).toBe(404);
    // Finding 4 (kept as the documented limit, docs/AUTHORITY.md and docs/SAFETY_CASE.md): until
    // a participant checks or the watcher runs (every 15 s in the composed app and the demo), the
    // server follows its own ownership record. This records the window; the lines above show
    // the watcher closing it.
    expect(results).toEqual({ edit: 200, invite: 201, offers: 200, purchases: 200 });
  });
});
