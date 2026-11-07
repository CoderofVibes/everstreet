// Promise 3 (helpers): a helper sees and does only what the contract confirms now, never after
// the owner's revoke, a contract-only revoke, or the sale.
import { describe, expect, it } from "vitest";
import { fundedDeal, world } from "../deal-world.ts";

describe("pr17: helpers", () => {
  it("a helper's desk follows the appointment and the contract, and ends with the sale", async () => {
    const w = await fundedDeal(world());
    const hal = await w.join("Hal Brennan");
    // A customer wrote in, so the desk has something private to show.
    const cust = await w.join("Cass Vale");
    const slug = (
      w.store.db.prepare("SELECT slug FROM businesses WHERE id = ?").get(w.id) as { slug: string }
    ).slug;
    expect(
      (
        await cust(`/api/public/businesses/${slug}/inquiries`, "POST", {
          kind: "question",
          message: "Do you teach left-handed carving?",
          share_contact: true,
        })
      ).status,
    ).toBe(201);
    // Never a helper: 404, and no reply.
    expect((await hal(`/api/helping/${w.id}`)).status).toBe(404);
    const added = await w.mara(`/api/businesses/${w.id}/team`, "POST", { person_id: hal.id });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    const desk = await hal(`/api/helping/${w.id}`);
    expect(desk.status).toBe(200);
    expect(desk.body.access).toBe("active");
    expect(desk.body.inquiries.length).toBe(1);
    const inquiry = desk.body.inquiries[0].id as string;
    expect(JSON.stringify(desk.body)).not.toContain(cust.id);
    // A helper is not the owner.
    for (const path of [
      `/api/businesses/${w.id}`,
      `/api/businesses/${w.id}/money`,
      `/api/businesses/${w.id}/team`,
      `/api/businesses/${w.id}/books`,
      `/api/businesses/${w.id}/listing`,
      `/api/inbox`,
    ]) {
      const r = await hal(path);
      if (path === "/api/inbox") expect(r.body.received).toEqual([]);
      else expect(r.status, path).toBe(404);
    }
    expect(
      (await hal(`/api/inquiries/${inquiry}/reply`, "POST", { text: "As owner" })).status,
    ).toBe(404);
    expect((await hal(`/api/businesses/${w.id}/withdraw`, "POST", { cents: 100 })).status).toBe(
      404,
    );
    // Revoked on the contract only (the owner's wallet, outside Everstreet): denied, nothing shown.
    const biz = w.chain.businesses.get(w.account);
    const halAccount = (
      w.store.db
        .prepare(
          "SELECT account_id FROM chain_accounts WHERE owner_kind = 'person' AND owner_id = ?",
        )
        .get(hal.id) as { account_id: string }
    ).account_id;
    const caps = biz?.operators.get(halAccount);
    biz?.operators.delete(halAccount);
    const denied = await hal(`/api/helping/${w.id}`);
    expect(denied.status).toBe(200);
    expect(denied.body.access).toBe("denied");
    expect(denied.body.inquiries).toBeNull();
    expect(
      (await hal(`/api/helping/${w.id}/inquiries/${inquiry}/reply`, "POST", { text: "Yes" }))
        .status,
    ).toBe(403);
    if (caps) biz?.operators.set(halAccount, caps);
    expect((await hal(`/api/helping/${w.id}`)).body.access).toBe("active");
    // Revoked by the owner here: ended, the business's name only; no reply.
    expect((await w.mara(`/api/businesses/${w.id}/team/${hal.id}`, "DELETE")).status).toBe(200);
    const ended = await hal(`/api/helping/${w.id}`);
    expect(ended.status).toBe(200);
    expect(ended.body.access).toBe("ended");
    expect(ended.body.inquiries).toBeNull();
    expect(ended.body.orders).toBeNull();
    expect(
      (await hal(`/api/helping/${w.id}/inquiries/${inquiry}/reply`, "POST", { text: "Yes" }))
        .status,
    ).toBe(403);
    expect((await hal("/api/helping")).body.businesses).toEqual([]);
    // Re-appointed, then the business is sold: ended again, by the sale.
    expect(
      (await w.mara(`/api/businesses/${w.id}/team`, "POST", { person_id: hal.id })).status,
    ).toBe(201);
    expect((await hal(`/api/helping/${w.id}`)).body.access).toBe("active");
    const closed = await w.mara(`/api/deals/${w.deal.id}/accept`, "POST", {
      digest: w.deal.digest,
    });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    const after = await hal(`/api/helping/${w.id}`);
    expect(after.body.access).toBe("ended");
    expect(after.body.inquiries).toBeNull();
    expect(
      (await hal(`/api/helping/${w.id}/inquiries/${inquiry}/reply`, "POST", { text: "Yes" }))
        .status,
    ).toBe(403);
    // The former owner can't re-appoint or remove helpers.
    expect(
      (await w.mara(`/api/businesses/${w.id}/team`, "POST", { person_id: hal.id })).status,
    ).toBe(404);
    expect((await w.mara(`/api/businesses/${w.id}/team/${hal.id}`, "DELETE")).status).toBe(404);
  });
});
