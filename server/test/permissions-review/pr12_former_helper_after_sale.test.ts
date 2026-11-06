// Permissions review, promise 3 (helpers): a helper appointed on the contract by the seller must
// stop seeing and answering for the business after the sale closes; the former owner's desk and
// money routes must refuse too (v2 deals, FakeChain).
import { describe, expect, it } from "vitest";
import { fundedDeal } from "../deal-world.ts";

describe("pr12: former helper and former owner after a v2 close", () => {
  it("the helper's desk ends, replies and deliveries refuse, the former owner is out", async () => {
    const w = await fundedDeal();
    const { mara, ana, id, deal } = w;
    const hal = await w.join("Hal Helper");
    await hal("/api/wallet", "POST");
    const added = await mara(`/api/businesses/${id}/team`, "POST", { person_id: hal.id });
    expect(added.status).toBe(201);
    // A customer asks a question the helper can answer.
    const cust = await w.join("Cus Tomer");
    const slug = (
      w.store.db.prepare("SELECT slug FROM businesses WHERE id = ?").get(id) as { slug: string }
    ).slug;
    const inq = await cust(`/api/public/businesses/${slug}/inquiries`, "POST", {
      kind: "question",
      message: "Do you teach beginners?",
    });
    expect(inq.status).toBe(201);
    const desk = await hal(`/api/helping/${id}`);
    expect(desk.status).toBe(200);
    expect(desk.body.access).toBe("active");
    // The sale closes: Mara accepts the already buyer-accepted deal.
    const closed = await mara(`/api/deals/${deal.id}/accept`, "POST", { digest: deal.digest });
    expect(closed.status).toBe(200);
    expect(closed.body.deal.status).toBe("closed");
    // The former helper.
    const after = await hal(`/api/helping/${id}`);
    expect(after.status).toBe(200);
    expect(after.body.access).not.toBe("active");
    expect(after.body.inquiries).toBeNull();
    expect(after.body.orders).toBeNull();
    const reply = await hal(`/api/helping/${id}/inquiries/${inq.body.id}/reply`, "POST", {
      text: "Yes",
    });
    expect(reply.status).toBe(403);
    expect((await hal("/api/helping")).body.businesses).toEqual([]);
    // The former owner.
    for (const path of [
      `/api/businesses/${id}`,
      `/api/businesses/${id}/money`,
      `/api/businesses/${id}/team`,
      `/api/businesses/${id}/sessions`,
      `/api/businesses/${id}/listing`,
      `/api/businesses/${id}/books`,
    ])
      expect([path, (await mara(path)).status]).toEqual([path, 404]);
    expect((await mara(`/api/businesses/${id}/withdraw`, "POST", { cents: 100 })).status).toBe(404);
    expect((await mara(`/api/businesses/${id}/team`, "POST", { person_id: hal.id })).status).toBe(
      404,
    );
    expect(
      (await mara(`/api/inquiries/${inq.body.id}/reply`, "POST", { text: "mine" })).status,
    ).toBe(404);
    // The received inbox no longer carries the business's messages.
    const inbox = (await mara("/api/inbox")).body as { received: { business_id: string }[] };
    expect(inbox.received.map((r) => r.business_id)).not.toContain(id);
    // The buyer's representative now owns it.
    expect((await ana(`/api/businesses/${id}`)).status).toBe(200);
  });
});
