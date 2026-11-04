// Job 003q: the bounded public offer reads and the customer's own list. Real app; the chain is the
// labelled fixture double. Finite.

import { describe, expect, it } from "vitest";
import { customerWorld, type Json, SyntheticProtection } from "./customer-world.ts";

const INVOICE =
  "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD";

async function world() {
  const w = await customerWorld({ customer: { protection: new SyntheticProtection() } });
  const offer = await w.offer();
  const slug = (
    w.state.store.db.prepare("SELECT slug FROM businesses WHERE id = ?").get(w.f.business) as {
      slug: string;
    }
  ).slug;
  return { w, offer, slug };
}

describe("003q public offers respect publication", () => {
  it("an unpublished business exposes nothing, even by guessing the offer id", async () => {
    const { w, offer, slug } = await world();
    expect((await w.cara(`/api/public/businesses/${slug}/customer-offers`)).status).toBe(404);
    expect((await w.cara(`/api/public/customer-offers/${offer}`)).status).toBe(404);
  });

  it("a published business lists its active offers with exact terms and no customer data", async () => {
    const { w, offer, slug } = await world();
    w.state.store.db
      .prepare("UPDATE businesses SET published_at = ? WHERE id = ?")
      .run(new Date().toISOString(), w.f.business);
    const r = await w.cara(`/api/public/businesses/${slug}/customer-offers`);
    expect(r.body.offers).toHaveLength(1);
    expect(r.body.offers[0]).toMatchObject({
      offer_id: offer,
      offer_state: "active",
      product: { name: "Invoice reader", max_chars: expect.any(Number) },
      terms: { units_per_use: 1, unit_price: "50000", asset: "tusd.near", retention_days: 30 },
    });
    expect(r.body.offers[0].product.fields.map((f: Json) => f.key)).toContain("vendor");
    // Retired: no longer public, by list or id.
    await w.owner(`/api/businesses/${w.f.business}/customer-offers/${offer}/retire`, "POST");
    expect((await w.cara(`/api/public/businesses/${slug}/customer-offers`)).body.offers).toEqual(
      [],
    );
    expect((await w.cara(`/api/public/customer-offers/${offer}`)).status).toBe(404);
  });
});

describe("003q the customer's own list", () => {
  it("lists only the caller's requests, bounded, with no private fields; retired offers still show", async () => {
    const { w, offer } = await world();
    w.clock.now = Number(w.chain.ts);
    const p = await w.cara(`/api/customer/offers/${offer}/prepare`, "POST", {
      idempotency_key: "list-key-0001",
      input: INVOICE,
    });
    expect(p.status).toBe(201);
    const env = p.body.use.envelope;
    const mine = await w.cara("/api/customer/uses?limit=500");
    expect(mine.body.uses).toHaveLength(1);
    expect(mine.body.uses[0]).toMatchObject({
      id: p.body.use.id,
      state: "prepared",
      product: { name: "Invoice reader" },
      unit: "not_held", // 003q1: a prepared request holds nothing
      headline: { title: "Ready to review" },
    });
    const text = JSON.stringify(mine.body);
    for (const secret of [env.commitment.salt_hex, env.envelope_digest, "Stackline"])
      expect(text).not.toContain(secret);
    // Someone else, and the owner, see none of it.
    expect((await w.person("Lena Park")("/api/customer/uses")).body.uses).toEqual([]);
    expect((await w.owner("/api/customer/uses")).body.uses).toEqual([]);
    expect((await w.state.app.request("/api/customer/uses")).status).toBe(401); // no session
    await w.owner(`/api/businesses/${w.f.business}/customer-offers/${offer}/retire`, "POST");
    const after = await w.cara("/api/customer/uses");
    expect(after.body.uses[0].id).toBe(p.body.use.id);
    expect((await w.cara(`/api/customer/uses/${p.body.use.id}`)).body.use.offer.offer_state).toBe(
      "retired",
    );
  });
});
