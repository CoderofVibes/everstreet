// Permissions review, promise 6: signed-out visitors see only published pages. Drafts,
// unpublished businesses, studio projects and private app passes stay private; guessed ids,
// tokens and pass addresses find nothing.
import { describe, expect, it } from "vitest";
import { saleWorld } from "../sale-world.ts";

describe("pr08: outsiders", () => {
  it("an unpublished business and its offers are invisible to the public", async () => {
    const s = await saleWorld();
    const { w, biz, offerId } = s;
    const app = w.state.app;
    const anon = async (path: string, method = "GET", body?: unknown) => {
      const res = await app.request(path, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    };
    const slug = w.state.store.db
      .prepare("SELECT slug, published_at FROM businesses WHERE id = ?")
      .get(biz) as {
      slug: string;
      published_at: string | null;
    };
    expect(slug.published_at).toBeNull();
    expect((await anon(`/api/public/businesses/${slug.slug}`)).status).toBe(404);
    expect((await anon(`/api/public/businesses/${slug.slug}/customer-offers`)).status).toBe(404);
    expect((await anon(`/api/public/customer-offers/${offerId}`)).status).toBe(404);
    expect((await anon(`/api/agent/v1/offers/${offerId}`)).status).toBe(404);
    // Signed-in or not, every private route is 401 when signed out.
    for (const path of [
      `/api/businesses/${biz}`,
      `/api/businesses/${biz}/customer-offers`,
      `/api/product-projects/${w.f.project}`,
      `/api/sales/${biz}`,
      `/api/customer/uses`,
      `/api/me/portfolio`,
      `/api/inbox`,
    ])
      expect([path, (await anon(path)).status]).toEqual([path, 401]);
    // Owner-only writes signed out.
    expect((await anon(`/api/businesses/${biz}`, "PATCH", { name: "x" })).status).toBe(401);
    expect((await anon(`/api/businesses/${biz}/publish`, "POST", {})).status).toBe(401);
    // The public discover list doesn't include the unpublished business.
    const discover = (await anon("/api/public/discover")).body as {
      businesses: { slug: string }[];
    };
    expect(discover.businesses.map((b) => b.slug)).not.toContain(slug.slug);
    // Guessed pass, preview and app addresses.
    expect((await anon(`/p/${"A".repeat(43)}/index.html`)).status).toBe(404);
    expect((await anon(`/p/short/index.html`)).status).toBe(404);
    expect((await anon(`/a/${"B".repeat(16)}/index.html`)).status).toBe(404);
    expect((await anon(`/preview/app/${"C".repeat(43)}/index.html`)).status).toBe(404);
  });

  it("an unpublished business's existence doesn't leak through public follow, inquire or people routes", async () => {
    const s = await saleWorld();
    const { w, biz, stranger } = s;
    const slug = (
      w.state.store.db.prepare("SELECT slug FROM businesses WHERE id = ?").get(biz) as {
        slug: string;
      }
    ).slug;
    expect(
      (await stranger(`/api/public/businesses/${slug}/follow`, "POST", { on: true })).status,
    ).toBe(404);
    expect(
      (
        await stranger(`/api/public/businesses/${slug}/inquiries`, "POST", {
          kind: "question",
          message: "hi",
        })
      ).status,
    ).toBe(404);
    // The founder's public profile: nothing published, nothing shown.
    expect((await stranger(`/api/public/people/${w.f.ava.id}`)).status).toBe(404);
    // The former-helper and desk routes for a business one never helped.
    expect((await stranger(`/api/helping/${biz}`)).status).not.toBe(200);
  });
});
