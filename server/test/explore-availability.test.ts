// Job 001f1: Explore's tabs reflect actual customer availability. Astra's browser finding at
// 8df9f34: a published digital product with an active offer (Available to use, a working Use) was
// listed under "Starting now" and "Open for customers" was empty, because the feed split on the
// legacy offering's action alone. Real routes: publication, offer retirement, a release change,
// unpublish, a legacy business testing interest and one taking requests, and a mixed business.
// Every published business appears exactly once. Labelled fixtures; finite.

import { describe, expect, it } from "vitest";
import { exploreClass } from "../src/community.ts";
import type { Json } from "./customer-world.ts";
import { maintenanceWorld } from "./maintenance-world.ts";
import { INVOICE_SPEC } from "./runtime-world.ts";

const DRAFT = {
  headline: "Clean rows from supplier invoices",
  summary: "Upload a fictional supplier invoice and get its fields back as clean rows.",
  capabilities: ["Reads invoice numbers, dates and totals"],
};

/** All the facts a legacy offering needs before it takes requests (fictional). */
const LEGACY_FACTS = {
  audience: "Adults new to pottery",
  outcome: "A finished bowl",
  deliverable: "90 minutes",
  price: "$35",
  when: "Saturdays",
  where: "14 Alder Lane",
  capacity: "6",
  confirmed: true,
};

async function world() {
  const t = await maintenanceWorld();
  const biz = `/api/businesses/${t.w.f.business}`;
  await t.w.owner(biz, "PATCH", { name: "Ledgerline Invoice Reader" });
  const slugOf = (id: string) =>
    (
      t.w.state.store.db.prepare("SELECT slug FROM businesses WHERE id = ?").get(id) as {
        slug: string;
      }
    ).slug;
  const publishDigital = async () => {
    const v = (
      await t.w.owner(`${biz}/public-profile/draft`, "PUT", {
        base_rev: (await t.w.owner(`${biz}/public-profile`)).body.draft_rev,
        draft: { ...DRAFT, products: [t.w.f.project] },
      })
    ).body as Json;
    const r = await t.w.owner(`${biz}/public-profile/publish`, "POST", {
      draft_rev: v.draft_rev,
      review: v.review,
    });
    if (r.status !== 200) throw new Error(`publish ${r.status} ${r.body.error}`);
  };
  /** A legacy business started the old way; `open` gives its offering every fact. */
  const legacy = async (name: string, open: boolean) => {
    const dee = t.w.person(`${name} Owner`);
    const p = (await dee("/api/projects", "POST", { route: "started", name })).body;
    const id = p.business.id as string;
    await dee(`/api/businesses/${id}`, "PATCH", { family: "class" });
    await dee(
      `/api/projects/${p.id}/answers`,
      "PATCH",
      open ? LEGACY_FACTS : { outcome: "A bowl" },
    );
    await dee(`/api/businesses/${id}/offer`, "PATCH", { title: `${name} for beginners` });
    const pub = await dee(`/api/businesses/${id}/publish`, "POST");
    if (pub.status !== 200) throw new Error(`legacy publish ${pub.status} ${pub.body.error}`);
    return { id, slug: slugOf(id), who: dee };
  };
  const explore = async () => (await t.w.cara("/api/public/explore")).body as Json;
  const where = (feed: Json, slug: string) => ({
    open: (feed.open as Json[]).filter((b) => b.slug === slug).length,
    starting: (feed.starting as Json[]).filter((b) => b.slug === slug).length,
  });
  return { t, biz, slug: slugOf(t.w.f.business), publishDigital, legacy, explore, where };
}

/** The business's row in one tab; a missing row fails the test. */
function rowIn(feed: Json, tab: "open" | "starting", slug: string): Json {
  const r = (feed[tab] as Json[]).find((b) => b.slug === slug);
  if (!r) throw new Error(`${slug} not in ${tab}`);
  return r;
}

describe("001f1 Astra's finding: a usable digital product is open for customers", () => {
  it("published with an active offer: listed once, under Open, with its reason", async () => {
    const x = await world();
    await x.publishDigital();
    const feed = await x.explore();
    expect(x.where(feed, x.slug)).toEqual({ open: 1, starting: 0 });
    const row = rowIn(feed, "open", x.slug);
    expect(row.explore).toEqual({ tab: "open", reason: "digital_available" });
    // The storefront and the feed agree, down to the Use target, and the public section keeps
    // exactly its reviewed allowlist (nothing new is exposed by the classification).
    const page = (await x.t.w.cara(`/api/public/businesses/${x.slug}`)).body as Json;
    expect(page.digital.availability).toBe("available");
    expect(row.digital).toEqual(page.digital);
    expect(row.digital.products[0].use_offer_id).toBe(x.t.offer);
    expect(Object.keys(row.digital).sort()).toEqual(
      [
        "audience",
        "availability",
        "capabilities",
        "example",
        "headline",
        "products",
        "published_at",
        "summary",
      ].sort(),
    );
    expect(Object.keys(row.digital.products[0]).sort()).toEqual(
      ["family_label", "name", "status", "use_offer_id"].sort(),
    );
    const { explore: _e, new_here: _n, ...rest } = row;
    for (const k of Object.keys(rest)) expect(Object.keys(page)).toContain(k);
  });
});

describe("001f1 availability changes move it between tabs, never duplicating it", () => {
  it("offer retired: starting (coming soon); unpublished: in neither", async () => {
    const x = await world();
    await x.publishDigital();
    await x.t.w.owner(`${x.biz}/customer-offers/${x.t.offer}/retire`, "POST");
    const feed = await x.explore();
    expect(x.where(feed, x.slug)).toEqual({ open: 0, starting: 1 });
    expect(rowIn(feed, "starting", x.slug).explore).toEqual({
      tab: "starting",
      reason: "digital_coming_soon",
    });
    await x.t.w.owner(`${x.biz}/unpublish`, "POST");
    expect(x.where(await x.explore(), x.slug)).toEqual({ open: 0, starting: 0 });
  });

  it("a release change moves it to starting until the owner republishes (its offer's release is superseded)", async () => {
    const x = await world();
    await x.publishDigital();
    const job = await x.t.w.rw.build(x.t.w.f.ava, x.t.w.f.project, {
      ...INVOICE_SPEC,
      name: "A newer unreviewed name",
    });
    await x.t.w.rw.release(x.t.w.f, job);
    // First-use review (Nov 7, finding 66): the reviewed release's offer refuses every use now,
    // so the page is not "open"; it keeps the reviewed name and reads coming soon.
    const feed = await x.explore();
    expect(x.where(feed, x.slug)).toEqual({ open: 0, starting: 1 });
    expect(rowIn(feed, "starting", x.slug).digital.products[0].name).toBe("Invoice reader");
  });
});

describe("001f1 legacy and mixed businesses", () => {
  it("legacy testing interest: starting; legacy taking requests: open; mixed: open once, by whichever part is open", async () => {
    const x = await world();
    const testing = await x.legacy("Pottery", false);
    const taking = await x.legacy("Weaving", true);
    let feed = await x.explore();
    expect(x.where(feed, testing.slug)).toEqual({ open: 0, starting: 1 });
    expect(rowIn(feed, "starting", testing.slug).explore.reason).toBe("legacy_interest");
    expect(x.where(feed, taking.slug)).toEqual({ open: 1, starting: 0 });
    expect(rowIn(feed, "open", taking.slug).explore.reason).toBe("legacy_open");
    // Mixed: the digital business also publishes a legacy offering still testing interest.
    await x.t.w.owner(`${x.biz}/offer`, "PATCH", { title: "Invoice clean-up session" });
    await x.t.w.owner(`${x.biz}/publish`, "POST");
    await x.publishDigital();
    feed = await x.explore();
    expect(x.where(feed, x.slug)).toEqual({ open: 1, starting: 0 });
    expect(rowIn(feed, "open", x.slug).explore.reason).toBe("digital_available");
    // Its digital offer retired: the legacy part is still only testing interest, so starting.
    await x.t.w.owner(`${x.biz}/customer-offers/${x.t.offer}/retire`, "POST");
    expect(x.where(await x.explore(), x.slug)).toEqual({ open: 0, starting: 1 });
  });

  it("the rule's four outcomes, including mixed with only the legacy part open", () => {
    type Page = Parameters<typeof exploreClass>[0];
    const page = (kind: "question" | "interest", availability?: "available" | "coming_soon") =>
      ({ action: { kind }, digital: availability ? { availability } : null }) as unknown as Page;
    expect(exploreClass(page("interest", "available"))).toEqual({
      tab: "open",
      reason: "digital_available",
    });
    expect(exploreClass(page("question", "available")).reason).toBe("digital_available");
    expect(exploreClass(page("question", "coming_soon"))).toEqual({
      tab: "open",
      reason: "legacy_open",
    });
    expect(exploreClass(page("interest", "coming_soon"))).toEqual({
      tab: "starting",
      reason: "digital_coming_soon",
    });
    expect(exploreClass(page("question"))).toEqual({ tab: "open", reason: "legacy_open" });
    expect(exploreClass(page("interest"))).toEqual({ tab: "starting", reason: "legacy_interest" });
  });

  it("every published business is in exactly one tab", async () => {
    const x = await world();
    await x.publishDigital();
    await x.legacy("Pottery", false);
    await x.legacy("Weaving", true);
    const feed = await x.explore();
    const slugs = [...(feed.open as Json[]), ...(feed.starting as Json[])].map((b) => b.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const published = (
      x.t.w.state.store.db
        .prepare("SELECT slug FROM businesses WHERE published_at IS NOT NULL")
        .all() as { slug: string }[]
    ).map((r) => r.slug);
    expect(slugs.sort()).toEqual(published.sort());
  });
});
