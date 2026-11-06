// Permissions review, promise 1 and 5: after a Direct sale closes, the seller's open session
// must not read the business's private records. The sale room (`GET /api/sales/:business`) is
// reachable by anyone with a sale action, a terms document or an intent naming them, for ever.
//
// Fixed (builder, Nov 6), differently from the reviewer's first expectation: the former seller
// still opens the room, because that is where they collect their proceeds, but a past participant
// now sees only their own claims, payouts, actions and outcomes, and who holds authority now (the
// public owner and operators): no live deal, customer totals or handover.
import { describe, expect, it } from "vitest";
import { BUYER, proposal, SELLER, saleWorld } from "../sale-world.ts";

async function closedSale() {
  const s = await saleWorld();
  const { ava, noah, act } = s;
  const proposed = await act(ava, SELLER, "propose", proposal());
  expect(proposed.check?.body.resolution?.kind).toBe("confirmed");
  for (const k of ["register", "fund", "accept"]) {
    const r = await act(noah, BUYER, k);
    expect(r.check?.body.resolution?.kind).toBe("confirmed");
  }
  const closed = await act(ava, SELLER, "accept");
  expect(closed.check?.body.resolution?.result).toBe("closed");
  const owner = s.w.state.store.db
    .prepare("SELECT owner_id FROM businesses WHERE id = ?")
    .get(s.biz) as { owner_id: string };
  expect(owner.owner_id).toBe(noah.id);
  return s;
}

describe("pr01: former owner reads the sale room after the close", () => {
  it("the former owner's sale room shows only their own part once the business changed hands", async () => {
    const s = await closedSale();
    const r = await s.ava(`/api/sales/${s.biz}`);
    expect(r.status).toBe(200);
    const body = r.body as Record<string, unknown>;
    const control = body.control as { live_deal: unknown };
    expect(body.local_owner).toBe(false);
    expect((body.roles as { former_seller: boolean }).former_seller).toBe(true);
    expect(control.live_deal).toBeNull();
    expect(body.customer_obligations).toBeNull();
    expect(body.handover).toBeNull();
    // Their own proceeds stay visible, so they can collect them.
    expect(body.party).not.toBeNull();
  });

  it("the former owner cannot read the NEW owner's next sale terms or the treasury", async () => {
    const s = await closedSale();
    const { noah, stranger, act, biz } = s;
    // The new owner proposes a fresh sale to a third party.
    const next = await act(noah, BUYER, "propose", {
      ...proposal(),
      buyer_account: "stranger.near",
      price: "999000000",
    });
    expect(next.check?.body.resolution?.kind).toBe("confirmed");
    const r = await s.ava(`/api/sales/${biz}`);
    const body = r.body as Record<string, unknown>;
    const control = body.control as { live_deal?: { price?: string; buyer?: string } } | undefined;
    // Promised: nothing of the new owner's sale, nor the business's balances, reaches the seller.
    expect(control?.live_deal?.price).not.toBe("999000000");
    expect(control?.live_deal?.buyer).not.toBe("stranger.near");
    expect(body.customer_obligations).toBeNull();
    expect(body.handover).toBeNull();
    // The new deal's buyer (stranger.near here) is a current party and sees it.
    const sr = await stranger(`/api/sales/${biz}`);
    expect(sr.status).toBe(200);
    expect((sr.body as { control: { live_deal: { price: string } } }).control.live_deal.price).toBe(
      "999000000",
    );
  });
});
