// Permissions review, promise 4: a buyer sees only what the seller shared, only while that
// sharing is live. After the sale is cancelled, after the seller revokes, and after the grant's
// days run out, the evidence room, its export and its scenarios must refuse.
import { describe, expect, it } from "vitest";
import { fundedDeal } from "../deal-world.ts";

async function granted() {
  const w = await fundedDeal();
  const { mara, ana, id } = w;
  const listing = (await mara(`/api/businesses/${id}/listing`)).body as {
    requests: { id: string; status: string }[];
  };
  const req = listing.requests[0] as { id: string; status: string };
  const decided = await mara(`/api/acquire/requests/${req.id}/decide`, "POST", {
    action: "grant",
    days: 7,
  });
  expect(decided.status).toBe(200);
  expect((await ana(`/api/acquire/rooms/${req.id}`)).status).toBe(200);
  return { ...w, req };
}

describe("pr03: the buyer keeps reading after the sharing should have ended", () => {
  // Builder (Nov 6): kept by design. The evidence room follows the seller's grant (its purpose
  // and days), not a deal: a cancelled deal can be renegotiated, and the seller ends the room by
  // revoking (next test) or it expires. This records that cancelling alone leaves the grant.
  it("a deal's cancellation leaves the seller's grant as the seller set it", async () => {
    const w = await granted();
    const cancelled = await w.mara(`/api/deals/${w.deal.id}/cancel`, "POST");
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.deal.status).toBe("cancelled");
    expect((await w.ana(`/api/acquire/rooms/${w.req.id}`)).status).toBe(200);
  });

  it("the seller's revocation ends the room, export and scenarios at once", async () => {
    const w = await granted();
    expect((await w.mara(`/api/acquire/requests/${w.req.id}/revoke`, "POST")).status).toBe(200);
    expect((await w.ana(`/api/acquire/rooms/${w.req.id}`)).status).toBe(403);
    expect((await w.ana(`/api/acquire/rooms/${w.req.id}/export`)).status).toBe(403);
    expect(
      (await w.ana(`/api/acquire/rooms/${w.req.id}/try`, "POST", { overrides: {} })).status,
    ).toBe(403);
    expect(
      (
        await w.ana(`/api/acquire/rooms/${w.req.id}/scenarios`, "POST", {
          name: "x",
          overrides: {},
        })
      ).status,
    ).toBe(403);
  });

  it("an expired grant refuses every read", async () => {
    const w = await granted();
    w.store.db
      .prepare("UPDATE access_requests SET expires_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), w.req.id);
    expect((await w.ana(`/api/acquire/rooms/${w.req.id}`)).status).toBe(403);
    expect((await w.ana(`/api/acquire/rooms/${w.req.id}/export`)).status).toBe(403);
    expect(
      (await w.ana(`/api/acquire/rooms/${w.req.id}/try`, "POST", { overrides: {} })).status,
    ).toBe(403);
  });

  it("a stranger and a research-only member can't open the room", async () => {
    const w = await granted();
    const sam = await w.join("Sam Outsider");
    expect((await sam(`/api/acquire/rooms/${w.req.id}`)).status).toBe(404);
    const rae = await w.join("Rae Research");
    expect(
      (
        await w.ana(`/api/acquire/buyers/${w.coop}/members`, "POST", {
          person_id: rae.id,
          role: "research",
        })
      ).status,
    ).toBe(200);
    expect((await rae(`/api/acquire/rooms/${w.req.id}`)).status).toBe(403);
    expect((await rae(`/api/acquire/rooms/${w.req.id}/export`)).status).toBe(403);
  });

  it("the room shows only the granted categories", async () => {
    const w = await granted();
    const room = (await w.ana(`/api/acquire/rooms/${w.req.id}`)).body as Record<string, unknown>;
    // Only financials was asked and granted.
    expect(room.financials).toBeDefined();
    expect(room.customers).toBeUndefined();
    expect(room.costs).toBeUndefined();
    expect(room.operations).toBeUndefined();
    expect(room.digital_performance).toBeUndefined();
  });
});
