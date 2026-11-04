// Job 001d: publishing a digital business through real routes. Draft -> exact review -> publish
// without any legacy offering; saving never changes what is live; a lost save reply is safe; the
// public view carries none of the canaries planted in private places; retiring and unpublishing
// remove entry points but not customers' history; a sale moves editing to the buyer; legacy and
// mixed businesses keep their offerings. Labelled fixtures; finite.

import { describe, expect, it } from "vitest";
import { digitalPublic } from "../src/publication.ts";
import type { Json } from "./customer-world.ts";
import { maintenanceWorld } from "./maintenance-world.ts";
import { FixtureV3Transport, V3_CLOSED, V3_DIGEST } from "./v3-fixture-transport.ts";

const DRAFT = {
  headline: "Clean rows from supplier invoices",
  summary: "Upload a fictional supplier invoice and get its fields back as clean rows.",
  audience: "Bookkeepers at small fictional firms",
  capabilities: ["Reads invoice numbers, dates and totals", "Results stay private to you"],
};

async function digital(v3Transport?: FixtureV3Transport) {
  const t = await maintenanceWorld({ v3Transport });
  const biz = `/api/businesses/${t.w.f.business}`;
  await t.w.owner(biz, "PATCH", { name: "Ledgerline Invoice Reader" });
  const slug = (
    t.w.state.store.db.prepare("SELECT slug FROM businesses WHERE id = ?").get(t.w.f.business) as {
      slug: string;
    }
  ).slug;
  const profile = (who = t.w.owner) => who(`${biz}/public-profile`);
  const save = (base_rev: number, draft: Json, who = t.w.owner) =>
    who(`${biz}/public-profile/draft`, "PUT", { base_rev, draft });
  const publish = (draft_rev: number, who = t.w.owner) =>
    who(`${biz}/public-profile/publish`, "POST", { draft_rev });
  const page = () => t.w.cara(`/api/public/businesses/${slug}`);
  return { t, biz, slug, profile, save, publish, page };
}

describe("001d draft, exact review, publish: no legacy offering needed", () => {
  it("a released, offered product goes public with a working Use target", async () => {
    const x = await digital();
    const start = (await x.profile()).body as Json;
    expect(start).toMatchObject({ draft_rev: 0, live: null, page_published: false });
    expect(start.eligibility.ok).toBe(false);
    expect((await x.page()).status).toBe(404);
    const saved = await x.save(0, { ...DRAFT, products: [x.t.w.f.project] });
    expect(saved.status).toBe(200);
    const v = saved.body as Json;
    expect(v.draft_rev).toBe(1);
    expect(v.eligibility).toEqual({ ok: true, reasons: [] });
    // The exact preview: the released product's name, available, with the existing offer.
    expect(v.preview.products).toEqual([
      {
        name: expect.any(String),
        family_label: expect.any(String),
        status: "available",
        use_offer_id: x.t.offer,
      },
    ]);
    expect(v.preview.availability).toBe("available");
    expect((await x.page()).status).toBe(404); // saving publishes nothing
    const pub = await x.publish(1);
    expect(pub.status).toBe(200);
    const p = (await x.page()).body as Json;
    expect(p.digital).toEqual({ ...v.preview, published_at: expect.any(String) });
    expect(p.offer).toBeNull(); // the empty legacy offering stays unpublished
    expect(p.idea).toBeNull();
    // The existing customer route works from the public Use target.
    expect((await x.t.w.cara(`/api/public/customer-offers/${x.t.offer}`)).status).toBe(200);
    // Discovery finds it by its public words.
    const found = (await x.t.w.cara("/api/public/discover?q=bookkeepers")).body
      .businesses as Json[];
    expect(found.map((b) => b.slug)).toContain(x.slug);
  });

  it("saving a new draft leaves the live profile unchanged until that version is published", async () => {
    const x = await digital();
    await x.save(0, { ...DRAFT, products: [x.t.w.f.project] });
    await x.publish(1);
    await x.save(1, { ...DRAFT, headline: "A newer headline", products: [x.t.w.f.project] });
    expect((await x.page()).body.digital.headline).toBe(DRAFT.headline);
    // Publishing a revision other than the one reviewed is refused.
    const stale = await x.publish(1);
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("draft_changed");
    expect((await x.publish(2)).status).toBe(200);
    expect((await x.page()).body.digital.headline).toBe("A newer headline");
    // Publishing the same reviewed revision again is "already".
    expect((await x.publish(2)).body.already).toBe(true);
  });

  it("a lost save reply is safe to retry; a stale base with other content is a conflict", async () => {
    const x = await digital();
    const d = { ...DRAFT, products: [x.t.w.f.project] };
    expect((await x.save(0, d)).body.draft_rev).toBe(1);
    expect((await x.save(0, d)).body.draft_rev).toBe(1); // the retry: same content, accepted
    const other = await x.save(0, { ...d, headline: "Different" });
    expect(other.status).toBe(409);
    expect(other.body.code).toBe("draft_changed");
  });

  it("refuses unbounded text, too many capabilities and another business's product", async () => {
    const x = await digital();
    expect((await x.save(0, { ...DRAFT, headline: "x".repeat(121) })).status).toBe(400);
    expect(
      (await x.save(0, { ...DRAFT, capabilities: Array.from({ length: 7 }, (_, i) => `c${i}`) }))
        .status,
    ).toBe(400);
    const bea = await x.t.w.rw.founder("Bea Fictional");
    const foreign = await x.save(0, { ...DRAFT, products: [bea.project] });
    expect(foreign.status).toBe(400);
    expect(foreign.body.code).toBe("unknown_product");
  });
});

describe("001d the public view carries nothing private", () => {
  it("brief, customer document, sale listing and unpublished draft canaries never appear", async () => {
    const x = await digital();
    // Canary 1: the private brief (a new revision of the product brief).
    const view = (await x.t.w.owner(`/api/product-projects/${x.t.w.f.project}`)).body as Json;
    const rev = await x.t.w.owner(`/api/product-projects/${x.t.w.f.project}/revisions`, "POST", {
      base_revision: view.head.number,
      brief: { ...view.head.brief, problem: "CANARY-BRIEF problem text" },
      prototype: view.head.prototype,
    });
    expect(rev.status).toBeLessThan(300);
    // Canary 2: a customer's document.
    await x.t.prepare(x.t.w.cara, "canary-key-0001", "Fictional invoice CANARY-DOC total 9.99 USD");
    await x.save(0, { ...DRAFT, products: [x.t.w.f.project] });
    expect((await x.publish(1)).status).toBe(200);
    // Canary 3: a sale listing with an asking price and reason.
    const listing = await x.t.w.owner(`${x.biz}/listing`, "PATCH", {
      mode: "named",
      asking_cents: 98765432,
      reason: "CANARY-SALE reason",
    });
    expect(listing.status).toBe(200);
    // Canary 4: an unpublished draft edit.
    expect(
      (
        await x.save(1, {
          ...DRAFT,
          summary: "CANARY-DRAFT summary not yet published",
          products: [],
        })
      ).status,
    ).toBe(200);
    // The owner's own view does hold the draft canary: the public one must not.
    expect(JSON.stringify((await x.profile()).body)).toContain("CANARY-DRAFT");
    const outputs = [
      (await x.page()).body,
      (await x.t.w.cara("/api/public/discover")).body,
      (await x.t.w.cara(`/api/public/businesses/${x.slug}/customer-offers`)).body,
    ].map((o) => JSON.stringify(o));
    for (const out of outputs)
      for (const canary of [
        "CANARY-BRIEF",
        "CANARY-DOC",
        "CANARY-SALE",
        "98765432",
        "CANARY-DRAFT",
        x.t.w.f.project,
      ])
        expect(out).not.toContain(canary);
  });
});

describe("001d retire, unpublish and sale keep customers' history", () => {
  it("retiring the offer removes the Use target; unpublishing hides the page; customers keep results", async () => {
    const x = await digital();
    const id = await x.t.reserve(x.t.w.cara, "pub-use-0001");
    await x.t.execute(x.t.w.cara, id);
    await x.save(0, { ...DRAFT, products: [x.t.w.f.project] });
    await x.publish(1);
    await x.t.w.owner(`${x.biz}/customer-offers/${x.t.offer}/retire`, "POST");
    const after = (await x.page()).body.digital as Json;
    expect(after.products[0]).toMatchObject({ status: "not_open", use_offer_id: null });
    expect(after.availability).toBe("coming_soon");
    expect((await x.t.w.cara(`/api/customer/uses/${id}/result`)).status).toBe(200);
    await x.t.w.owner(`${x.biz}/unpublish`, "POST");
    expect((await x.page()).status).toBe(404);
    // The section itself is withheld too (not only the page route around it).
    expect(digitalPublic(x.t.w.state.store.db, x.t.w.f.business)).toBeNull();
    const found = (await x.t.w.cara("/api/public/discover")).body.businesses as Json[];
    expect(found.map((b) => b.slug)).not.toContain(x.slug);
    expect((await x.t.w.cara(`/api/customer/uses/${id}/result`)).status).toBe(200);
    // Publishing the same reviewed version again re-opens the page.
    expect((await x.publish(1)).body.already).toBe(false);
    expect((await x.page()).status).toBe(200);
  });

  it("after the actual sale the buyer edits and publishes; the former owner can't", async () => {
    const transport = new FixtureV3Transport();
    const x = await digital(transport);
    await x.save(0, { ...DRAFT, products: [x.t.w.f.project] });
    await x.publish(1);
    const buyer = x.t.w.person("Noah Fenn");
    x.t.w.link(x.t.w.f.ava.id, "founder.near");
    x.t.w.link(buyer.id, "buyer.near");
    await x.t.w.owner(`${x.biz}/v3/refresh`, "POST", {});
    const intent = (
      await x.t.w.owner(`${x.biz}/v3/intents`, "POST", {
        idempotency_key: "pub-intent-0001",
        deal_seq: "1",
        version: 1,
        digest: V3_DIGEST,
      })
    ).body.intent.id as string;
    transport.next(V3_CLOSED);
    x.t.w.chain.afterSale();
    expect((await buyer(`${x.biz}/v3/intents/${intent}/reconcile`, "POST")).body.state).toBe(
      "applied",
    );
    expect((await x.profile()).status).toBe(404);
    expect((await x.save(1, { ...DRAFT, headline: "Old owner edit" })).status).toBe(404);
    expect((await x.publish(1)).status).toBe(404);
    const theirs = (await x.profile(buyer)).body as Json;
    expect(theirs.draft_rev).toBe(1);
    expect(
      (await x.save(1, { ...DRAFT, headline: "Under new ownership", products: [] }, buyer)).status,
    ).toBe(200);
    expect((await x.page()).body.digital.headline).toBe(DRAFT.headline); // until they publish
  });
});

describe("001d legacy, mixed and brief-only businesses", () => {
  it("a legacy class business publishes as before; a mixed one shows both; a brief-only one is coming soon", async () => {
    const t = await maintenanceWorld();
    const dee = t.w.person("Dee Fictional");
    const start = await dee("/api/projects", "POST", { route: "idea", name: "Fictional Pottery" });
    const id = start.body.business.id as string;
    await dee(`/api/businesses/${id}`, "PATCH", { family: "class" });
    // Legacy rule unchanged: a legacy publish still needs its offering title.
    expect((await dee(`/api/businesses/${id}/publish`, "POST")).status).toBe(400);
    await dee(`/api/businesses/${id}/offer`, "PATCH", { title: "Wheel throwing for beginners" });
    expect((await dee(`/api/businesses/${id}/publish`, "POST")).status).toBe(200);
    const slug = start.body.business.slug as string;
    const legacy = (await t.w.cara(`/api/public/businesses/${slug}`)).body as Json;
    expect(legacy.offer.title).toBe("Wheel throwing for beginners");
    expect(legacy.digital).toBeNull();

    // Mixed: the digital business also publishes its legacy offering the old way.
    const biz = `/api/businesses/${t.w.f.business}`;
    await t.w.owner(biz, "PATCH", { name: "Ledgerline Invoice Reader" });
    await t.w.owner(`${biz}/public-profile/draft`, "PUT", {
      base_rev: 0,
      draft: { ...DRAFT, products: [t.w.f.project] },
    });
    await t.w.owner(`${biz}/public-profile/publish`, "POST", { draft_rev: 1 });
    await t.w.owner(`${biz}/offer`, "PATCH", { title: "Invoice clean-up session" });
    await t.w.owner(`${biz}/publish`, "POST");
    const mslug = (
      t.w.state.store.db
        .prepare("SELECT slug FROM businesses WHERE id = ?")
        .get(t.w.f.business) as {
        slug: string;
      }
    ).slug;
    const mixed = (await t.w.cara(`/api/public/businesses/${mslug}`)).body as Json;
    expect(mixed.digital.headline).toBe(DRAFT.headline);
    expect(mixed.offer.title).toBe("Invoice clean-up session");

    // Brief-only: a truthful coming-soon profile, no Use target.
    const bea = t.w.person("Bea Fictional");
    const p = await bea("/api/product-projects", "POST", {
      idea: "A fictional client portal for a tutoring practice",
      foundation: "client_portal",
      name: "Tutor Portal",
    });
    const bid = p.body.project.business_id as string;
    await bea(`/api/businesses/${bid}`, "PATCH", { name: "Tutor Portal Co" });
    await bea(`/api/businesses/${bid}/public-profile/draft`, "PUT", {
      base_rev: 0,
      draft: { ...DRAFT, products: [p.body.project.id] },
    });
    const pub = await bea(`/api/businesses/${bid}/public-profile/publish`, "POST", {
      draft_rev: 1,
    });
    expect(pub.status).toBe(200);
    expect(pub.body.live).toMatchObject({
      availability: "coming_soon",
      products: [
        { name: "A product in development", status: "in_development", use_offer_id: null },
      ],
    });
  });
});
