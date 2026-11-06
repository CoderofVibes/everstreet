// Permissions review, promise 8: Everstreet never acts on a state the chain contradicts. The
// seller's acceptance lands on the contract (the sale is CLOSED there, the buyer is owner) but the
// wallet's answer is lost, so Everstreet's own owner field still says the seller. Every owner
// write the seller then makes should be refused.
//
// Fixed (builder, Nov 6): the composed entry runs the recorded-sale watcher every 15 s
// (V3Intents.watchPass); one pass reads the contract and moves the business to the buyer, so the
// window is one interval. Each test drives that pass, then checks the seller is refused.
import { describe, expect, it } from "vitest";
import { BUYER, proposal, SELLER, saleWorld } from "../sale-world.ts";

async function closedOnChainOnly() {
  const s = await saleWorld();
  const { ava, noah, act } = s;
  const proposed = await act(ava, SELLER, "propose", proposal());
  expect(proposed.check?.body.resolution?.kind).toBe("confirmed");
  for (const k of ["register", "fund", "accept"]) {
    const r = await act(noah, BUYER, k);
    expect(r.check?.body.resolution?.kind).toBe("confirmed");
  }
  // The seller's acceptance: the wallet sends it, the contract closes, the browser never checks.
  const closed = await act(ava, SELLER, "accept", {}, { lose: true });
  expect(closed.outcome?.transaction?.hash).toBeTruthy();
  const control = s.control() as { owner: string; generation: number };
  expect(control.owner).toBe(BUYER);
  const owner = s.w.state.store.db
    .prepare("SELECT owner_id FROM businesses WHERE id = ?")
    .get(s.biz) as { owner_id: string };
  // Everstreet lags: it still records the seller as owner, until the watcher's next pass.
  expect(owner.owner_id).toBe(ava.id);
  const app = s.w.state.app as unknown as { reconcileRecordedSales: () => Promise<string[]> };
  expect(await app.reconcileRecordedSales()).toContain("applied");
  return s;
}

describe("pr02: the seller keeps running the business after the contract made the buyer owner", () => {
  it("owner writes are refused once the contract says the buyer owns the business", async () => {
    const s = await closedOnChainOnly();
    const { ava, biz, w, offerId } = s;
    const results: Record<string, number> = {};
    results.rename = (await ava(`/api/businesses/${biz}`, "PATCH", { name: "Still mine" })).status;
    results.invite = (
      await ava(`/api/businesses/${biz}/members`, "POST", {
        person_id: w.dana.id,
        role: "case_worker",
      })
    ).status;
    results.retire = (
      await ava(`/api/businesses/${biz}/customer-offers/${offerId}/retire`, "POST", {})
    ).status;
    results.agent_switch = (
      await ava(`/api/businesses/${biz}/customer-offers/${offerId}/agent-access`, "PUT", {
        enabled: true,
      })
    ).status;
    results.publish = (await ava(`/api/businesses/${biz}/publish`, "POST", {})).status;
    results.withdraw_release = (
      await ava(`/api/product-projects/${w.f.project}/releases/withdraw`, "POST", {})
    ).status;
    // Promised: none of these succeed for a seller the contract no longer names as owner.
    expect(results).toEqual(
      Object.fromEntries(Object.keys(results).map((k) => [k, expect.not.toBeOneOf([200, 201])])),
    );
  });

  it("the watcher changes nothing while the contract hasn't closed the sale", async () => {
    const s = await saleWorld();
    const { ava, noah, act } = s;
    await act(ava, SELLER, "propose", proposal());
    for (const k of ["register", "fund", "accept"]) await act(noah, BUYER, k);
    const app = s.w.state.app as unknown as { reconcileRecordedSales: () => Promise<string[]> };
    const states = await app.reconcileRecordedSales();
    expect(states.length).toBeGreaterThan(0);
    expect(states.every((x) => x === "pending")).toBe(true);
    expect((await ava(`/api/businesses/${s.biz}`)).status).toBe(200);
  });

  it("owner reads say the business is no longer theirs", async () => {
    const s = await closedOnChainOnly();
    const r = await s.ava(`/api/businesses/${s.biz}`);
    expect(r.status).toBe(404);
  });
});
