// Job 001d: the disposable publication preview (scripts/lib/publicationPreview.ts), driven through
// its site's fetch (no listener, no network) as the browser would: draft -> exact review ->
// publish -> discovery and profile -> the existing customer workspace. SYNTHETIC throughout.

import { describe, expect, it } from "vitest";
import { publicationPreview } from "../../scripts/lib/publicationPreview.ts";
import type { Json } from "./customer-world.ts";

async function browser(p: Awaited<ReturnType<typeof publicationPreview>>, personId: string) {
  const as = await p.site.fetch(
    new Request(`http://preview/api/session/as/${personId}`, { method: "POST" }),
  );
  const cookie = (as.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  return async (path: string, method = "GET", body?: unknown) => {
    const res = await p.site.fetch(
      new Request(`http://preview${path}`, {
        method,
        headers: { cookie, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Json };
  };
}

describe("001d publication preview: draft, review, publish, discover, use", () => {
  it("a founder publishes a reviewed profile; a customer finds it and opens the product", async () => {
    const p = await publicationPreview();
    const ava = await browser(p, p.people.ava);
    const cara = await browser(p, p.people.cara);
    const biz = `/api/businesses/${p.businesses.digital}`;
    expect((await cara(`/api/public/businesses/${p.slugs.digital}`)).status).toBe(404);
    const saved = await ava(`${biz}/public-profile/draft`, "PUT", {
      base_rev: 0,
      draft: {
        headline: "Clean rows from supplier invoices",
        summary: "Upload a fictional supplier invoice and get its fields back as clean rows.",
        audience: "Bookkeepers at small fictional firms",
        capabilities: ["Reads invoice numbers, dates and totals"],
        products: [p.projects.digital],
      },
    });
    expect(saved.body.preview.products[0].status).toBe("available");
    expect(
      (
        await ava(`${biz}/public-profile/publish`, "POST", {
          draft_rev: 1,
          review: saved.body.review,
        })
      ).status,
    ).toBe(200);
    const found = (await cara("/api/public/discover?q=invoice")).body.businesses as Json[];
    const card = found.find((b) => b.slug === p.slugs.digital);
    expect(card?.digital.availability).toBe("available");
    const page = (await cara(`/api/public/businesses/${p.slugs.digital}`)).body;
    const target = page.digital.products[0].use_offer_id as string;
    expect(target).toBe(p.offerId);
    expect((await cara(`/api/public/customer-offers/${target}`)).status).toBe(200);
    // The legacy class business is unchanged; the brief-only founder has nothing public yet.
    const legacy = (await cara(`/api/public/businesses/${p.slugs.legacy}`)).body;
    expect(legacy.offer.title).toBe("Wheel throwing for beginners");
    expect(legacy.digital).toBeNull();
    expect((await cara(`/api/public/businesses/${p.slugs.briefOnly}`)).status).toBe(404);
  });
});
