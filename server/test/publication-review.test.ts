// Job 001d1: what is published is exactly what was reviewed. Astra's recipe at 295ec50 (actual
// build, evaluation and release routes with bounded fixture providers): review a profile, release
// a differently named version, publish the same draft revision; the unreviewed name went public.
// Plus coherence after publishing: a newer release's offer is never shown under the older
// reviewed product's name. Labelled fixtures; finite.

import { describe, expect, it } from "vitest";
import type { Json } from "./customer-world.ts";
import { maintenanceWorld } from "./maintenance-world.ts";
import { INVOICE_SPEC } from "./runtime-world.ts";
import { FixtureV3Transport, V3_CLOSED, V3_DIGEST } from "./v3-fixture-transport.ts";

const DRAFT = {
  headline: "Clean rows from supplier invoices",
  summary: "Upload a fictional supplier invoice and get its fields back as clean rows.",
};

async function reviewed() {
  const t = await maintenanceWorld();
  const biz = `/api/businesses/${t.w.f.business}`;
  await t.w.owner(biz, "PATCH", { name: "Fictional review test" });
  const saved = await t.w.owner(`${biz}/public-profile/draft`, "PUT", {
    base_rev: 0,
    draft: { ...DRAFT, products: [t.w.f.project] },
  });
  const review = saved.body as Json;
  expect(review.preview.products[0].name).toBe("Invoice reader");
  /** Releases a differently named, checked version through the actual routes. */
  const releaseRenamed = async () => {
    const job = await t.w.rw.build(t.w.f.ava, t.w.f.project, {
      ...INVOICE_SPEC,
      name: "A different unreviewed public product name",
    });
    await t.w.rw.release(t.w.f, job);
  };
  const publish = (body: Json) => t.w.owner(`${biz}/public-profile/publish`, "POST", body);
  const page = async () => {
    const slug = (
      t.w.state.store.db
        .prepare("SELECT slug FROM businesses WHERE id = ?")
        .get(t.w.f.business) as {
        slug: string;
      }
    ).slug;
    return t.w.cara(`/api/public/businesses/${slug}`);
  };
  return { t, biz, review, releaseRenamed, publish, page };
}

describe("001d1 Astra's recipe: a release change between review and publish", () => {
  it("publishing the reviewed revision after an unreviewed release change is refused", async () => {
    const x = await reviewed();
    await x.releaseRenamed();
    const r = await x.publish({ draft_rev: x.review.draft_rev, review: x.review.review });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("review_changed");
    expect((await x.page()).status).toBe(404); // nothing went public
    // A fresh review shows the new name; publishing that review works.
    const again = (await x.t.w.owner(`${x.biz}/public-profile`)).body as Json;
    expect(again.preview.products[0].name).toBe("A different unreviewed public product name");
    const ok = await x.publish({ draft_rev: again.draft_rev, review: again.review });
    expect(ok.status).toBe(200);
    expect((await x.page()).body.digital.products[0].name).toBe(
      "A different unreviewed public product name",
    );
  });

  it("publishing without the review identity is refused", async () => {
    const x = await reviewed();
    const r = await x.publish({ draft_rev: x.review.draft_rev });
    expect(r.status).toBe(400);
  });
});

describe("001d1 after publishing, content is immutable and availability stays truthful", () => {
  it("a newer release doesn't rename the live profile or lend it its offer", async () => {
    const x = await reviewed();
    expect(
      (await x.publish({ draft_rev: x.review.draft_rev, review: x.review.review })).status,
    ).toBe(200);
    expect((await x.page()).body.digital.products[0]).toMatchObject({
      name: "Invoice reader",
      status: "available",
      use_offer_id: x.t.offer,
    });
    await x.releaseRenamed();
    // The reviewed name stays; the reviewed release is no longer the active one, so no Use target
    // is attached to it (an offer for another release is not this product).
    const live = (await x.page()).body.digital.products[0] as Json;
    expect(live.name).toBe("Invoice reader");
    // First-use review (Nov 7, finding 66): the reviewed release's offer row is still active, but
    // its release is superseded and refuses every use, so it is no Use target any more: the
    // product reads not open, and the owner's desk says to republish.
    expect(live.status).toBe("not_open");
    expect(live.use_offer_id).toBeNull();
    const desk = (await x.t.w.owner(`${x.biz}/digital-desk`)).body as Json;
    expect(desk.work.map((w: Json) => w.key)).toContain("public_page");
    const dash = (await x.t.w.owner("/api/me/dashboard")).body as Json;
    expect(dash.businesses.flatMap((b: Json) => b.attention.map((a: Json) => a.kind))).toContain(
      "public_page_outdated",
    );
    // Offer the newer release, retire the reviewed one's: the newer offer is NOT attached to the
    // older reviewed name; the product reads not open until the owner reviews and republishes.
    const releaseB = (
      x.t.w.state.store.db
        .prepare("SELECT id FROM runtime_releases WHERE project_id = ? AND state = 'active'")
        .get(x.t.w.f.project) as { id: string }
    ).id;
    const terms = await x.t.w.owner(`${x.biz}/customer-offer-inspections`, "POST", {
      release_id: releaseB,
      plan_id: 1,
      retention_days: 30,
    });
    expect(terms.status).toBe(200);
    const offerB = await x.t.w.owner(`${x.biz}/customer-offers`, "POST", {
      idempotency_key: "offer-key-release-b",
      release_id: releaseB,
      plan_id: 1,
      retention_days: 30,
      reviewed_terms: terms.body.inspection.terms_digest,
    });
    expect(offerB.status).toBeLessThan(300);
    await x.t.w.owner(`${x.biz}/customer-offers/${x.t.offer}/retire`, "POST");
    const after = (await x.page()).body.digital.products[0] as Json;
    expect(after).toMatchObject({ name: "Invoice reader", status: "not_open", use_offer_id: null });
    expect(after.use_offer_id).not.toBe(offerB.body.offer.id);
    // The owner is told the live profile no longer matches the product's active release.
    const fresh = (await x.t.w.owner(`${x.biz}/public-profile`)).body as Json;
    expect(fresh.live_outdated).toBe(true);
    // They review the same draft revision again and republish it: the new release's name and its
    // offer go public together (not "already").
    const re = await x.publish({ draft_rev: fresh.draft_rev, review: fresh.review });
    expect(re.status).toBe(200);
    expect(re.body.already).toBe(false);
    expect(re.body.live_outdated).toBe(false);
    expect((await x.page()).body.digital.products[0]).toMatchObject({
      name: "A different unreviewed public product name",
      status: "available",
      use_offer_id: offerB.body.offer.id,
    });
  });
});

describe("001d1 taking the page down: retry-safe, owner-only, customers keep their history", () => {
  it("a repeated take-down (a lost reply) is harmless; a former owner's take-down changes nothing", async () => {
    const transport = new FixtureV3Transport();
    const t = await maintenanceWorld({ v3Transport: transport });
    const biz = `/api/businesses/${t.w.f.business}`;
    await t.w.owner(biz, "PATCH", { name: "Fictional review test" });
    const id = await t.reserve(t.w.cara, "down-use-0001");
    await t.execute(t.w.cara, id);
    const saved = (
      await t.w.owner(`${biz}/public-profile/draft`, "PUT", {
        base_rev: 0,
        draft: { ...DRAFT, products: [t.w.f.project] },
      })
    ).body as Json;
    await t.w.owner(`${biz}/public-profile/publish`, "POST", {
      draft_rev: saved.draft_rev,
      review: saved.review,
    });
    expect((await t.w.owner(`${biz}/unpublish`, "POST")).status).toBe(200);
    expect((await t.w.owner(`${biz}/unpublish`, "POST")).status).toBe(200); // the retry
    expect((await t.w.owner(`${biz}/public-profile`)).body.page_published).toBe(false);
    expect((await t.w.cara(`/api/customer/uses/${id}/result`)).status).toBe(200);
    // Republish, then the business is sold: the former owner can't take it down.
    const again = (await t.w.owner(`${biz}/public-profile`)).body as Json;
    await t.w.owner(`${biz}/public-profile/publish`, "POST", {
      draft_rev: again.draft_rev,
      review: again.review,
    });
    const buyer = t.w.person("Noah Fenn");
    t.w.link(t.w.f.ava.id, "founder.near");
    t.w.link(buyer.id, "buyer.near");
    await t.w.owner(`${biz}/v3/refresh`, "POST", {});
    const intent = (
      await t.w.owner(`${biz}/v3/intents`, "POST", {
        idempotency_key: "down-intent-0001",
        deal_seq: "1",
        version: 1,
        digest: V3_DIGEST,
      })
    ).body.intent.id as string;
    transport.next(V3_CLOSED);
    t.w.chain.afterSale();
    expect((await buyer(`${biz}/v3/intents/${intent}/reconcile`, "POST")).body.state).toBe(
      "applied",
    );
    expect((await t.w.owner(`${biz}/unpublish`, "POST")).status).toBe(404);
    expect((await buyer(`${biz}/public-profile`)).body.page_published).toBe(true);
  });
});
