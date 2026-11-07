// Promise 4: a buyer sees only what the seller shared, only while the sharing is live.
import { describe, expect, it } from "vitest";
import { fundedDeal, type Json, world } from "../deal-world.ts";

describe("pr14: the buyer's evidence room", () => {
  it("opens with the grant and closes on revoke, expiry, another team and the sale", async () => {
    const w = await fundedDeal(world());
    const request = (
      w.store.db.prepare("SELECT id FROM access_requests LIMIT 1").get() as { id: string }
    ).id;
    // Pending: nothing yet.
    expect((await w.ana(`/api/acquire/rooms/${request}`)).status).toBe(403);
    const granted = await w.mara(`/api/acquire/requests/${request}/decide`, "POST", {
      action: "grant",
    });
    expect(granted.status, JSON.stringify(granted.body)).toBe(200);
    const room = await w.ana(`/api/acquire/rooms/${request}`);
    expect(room.status).toBe(200);
    expect(room.body.financials).toBeDefined();
    expect(room.body.customers).toBeUndefined();
    expect(room.body.costs).toBeUndefined();
    // Only the granted kind: a scenario needs financials (granted); the export is the same room.
    const exported = await w.ana(`/api/acquire/rooms/${request}/export`);
    expect(exported.status).toBe(200);
    expect(exported.body.customers).toBeUndefined();
    // Another buying team's member, and the seller, get nothing from this request id.
    const sam = await w.join("Sam Okoro");
    expect((await sam(`/api/acquire/rooms/${request}`)).status).toBeGreaterThanOrEqual(403);
    expect((await w.mara(`/api/acquire/rooms/${request}`)).status).toBeGreaterThanOrEqual(403);
    // The buyer can't widen their own grant.
    expect(
      (
        await w.ana(`/api/acquire/requests/${request}/decide`, "POST", {
          action: "grant",
          categories: ["customers"],
        })
      ).status,
    ).toBe(404);
    // Expired by the clock: refused.
    w.store.db
      .prepare("UPDATE access_requests SET expires_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), request);
    expect((await w.ana(`/api/acquire/rooms/${request}`)).status).toBe(403);
    expect((await w.ana(`/api/acquire/rooms/${request}/export`)).status).toBe(403);
    w.store.db
      .prepare("UPDATE access_requests SET expires_at = ? WHERE id = ?")
      .run(new Date(Date.now() + 86_400_000).toISOString(), request);
    expect((await w.ana(`/api/acquire/rooms/${request}`)).status).toBe(200);
    // Revoked by the seller: refused, with no private field in the refusal.
    const revoked = await w.mara(`/api/acquire/requests/${request}/revoke`, "POST");
    expect(revoked.status).toBe(200);
    const after = await w.ana(`/api/acquire/rooms/${request}`);
    expect(after.status).toBe(403);
    expect(JSON.stringify(after.body)).not.toMatch(/revenue|months|estimate/);
    // The seller can't revoke what isn't theirs; a stranger can't decide.
    expect((await sam(`/api/acquire/requests/${request}/revoke`, "POST")).status).toBe(404);
    expect(
      (await sam(`/api/acquire/requests/${request}/decide`, "POST", { action: "grant" })).status,
    ).toBe(404);
  });

  it("the room closes when the business changes hands", async () => {
    const w = await fundedDeal(world());
    const request = (
      w.store.db.prepare("SELECT id FROM access_requests LIMIT 1").get() as { id: string }
    ).id;
    await w.mara(`/api/acquire/requests/${request}/decide`, "POST", { action: "grant" });
    expect((await w.ana(`/api/acquire/rooms/${request}`)).status).toBe(200);
    const accepted = await w.mara(`/api/deals/${w.deal.id}/accept`, "POST", {
      digest: w.deal.digest,
    });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    const owner = (
      w.store.db.prepare("SELECT owner_id FROM businesses WHERE id = ?").get(w.id) as Json
    ).owner_id;
    expect(owner).toBe(w.ana.id);
    // The buyer owns it now: the room was the seller's sharing, which ended with the sale.
    const room = await w.ana(`/api/acquire/rooms/${request}`);
    expect(room.status).toBe(403);
    // The former owner's desk routes are closed.
    expect((await w.mara(`/api/businesses/${w.id}`)).status).toBe(404);
    expect((await w.mara(`/api/businesses/${w.id}/listing`)).status).toBe(404);
    expect((await w.mara(`/api/acquire/requests/${request}/revoke`, "POST")).status).toBe(404);
    expect((await w.mara(`/api/businesses/${w.id}/books`)).status).toBe(404);
    expect((await w.mara(`/api/businesses/${w.id}/money`)).status).toBe(404);
    expect((await w.mara(`/api/businesses/${w.id}/withdraw`, "POST", { cents: 1 })).status).toBe(
      404,
    );
  });
});
