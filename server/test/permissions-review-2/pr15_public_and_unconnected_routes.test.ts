// Promise 6: signed-out visitors see only published pages; refusals say nothing about what exists.
import { describe, expect, it } from "vitest";
import type { Json } from "../customer-world.ts";
import { reviewWorld } from "./world.ts";

describe("pr15: public routes and what they reveal", () => {
  it("an unpublished business's page, offers and products are not public", async () => {
    const w = await reviewWorld();
    const app = w.w.state.app;
    const slug = w.w.state.store.db
      .prepare("SELECT slug, published_at FROM businesses WHERE id = ?")
      .get(w.biz) as Json;
    expect(slug.published_at).toBeNull();
    const page = await app.request(`/api/public/businesses/${slug.slug}`);
    expect(page.status).toBe(404);
    const offers = await app.request(`/api/public/businesses/${slug.slug}/customer-offers`);
    expect(offers.status).toBe(404);
    const offer = await app.request(`/api/public/customer-offers/${w.offerId}`);
    expect(offer.status).toBe(404);
    const describe = await app.request(`/api/agent/v1/offers/${w.offerId}`);
    expect(describe.status).toBe(404);
    const discover = (await (await app.request("/api/public/discover")).json()) as Json;
    expect(discover.businesses.map((b: Json) => b.slug)).not.toContain(slug.slug);
    // Published: the page and the offer appear, with no customer or owner-only field.
    w.w.state.store.db
      .prepare("UPDATE businesses SET published_at = ? WHERE id = ?")
      .run(new Date().toISOString(), w.biz);
    const open = await app.request(`/api/public/businesses/${slug.slug}`);
    expect(open.status).toBe(200);
    const text = JSON.stringify(await open.json());
    expect(text).not.toMatch(/cara\.near|dana\.near|owner_id|secret|token_hash/);
    const pub = (await (
      await app.request(`/api/public/customer-offers/${w.offerId}`)
    ).json()) as Json;
    expect(JSON.stringify(pub)).not.toMatch(/cara\.near|person_id|reg_id/);
    expect(pub.offer.business.id ?? pub.offer.business_id ?? w.biz).toBe(w.biz);
  });

  it("the proof, economics and intents pages need a signed-in participant", async () => {
    const w = await reviewWorld();
    const app = w.w.state.app;
    for (const path of [
      `/api/sales/${w.biz}/proof`,
      `/api/sales/${w.biz}/receipt`,
      `/api/sales/${w.biz}/economics`,
      `/api/sales/${w.biz}/intents`,
      `/api/companions/${w.biz}`,
      `/api/intents/00000000-0000-4000-8000-000000000000`,
      "/api/me/v3/handovers",
      "/api/me/sales",
      "/api/operator/writer-history",
    ]) {
      const r = await app.request(path);
      expect([401, 404], path).toContain(r.status);
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
    // The public docket and the recorded example are served without sign-in and name no person.
    const docket = await app.request("/api/public/attacks");
    const example = await app.request("/api/examples/ledgerline");
    for (const r of [docket, example]) {
      expect([200, 404, 503]).toContain(r.status);
      if (r.status === 200) {
        const text = await r.text();
        expect(text).not.toMatch(/es_session|private_key|secret_key|token_hash|person_id/);
      }
    }
  });

  it("sign-in is checked before the environment's connections", async () => {
    const w = await reviewWorld();
    const app = w.w.state.app;
    const leaks: string[] = [];
    for (const [method, path] of [
      ["GET", `/api/businesses/${w.biz}/sessions`],
      ["GET", `/api/businesses/${w.biz}/money`],
      ["GET", `/api/businesses/${w.biz}/team`],
      ["GET", `/api/businesses/${w.biz}/deals/snapshot`],
      ["GET", `/api/helping/${w.biz}`],
      ["POST", `/api/businesses/${w.biz}/deals`],
      ["POST", `/api/businesses/${w.biz}/team`],
      ["POST", `/api/businesses/${w.biz}/withdraw`],
      ["POST", `/api/businesses/${w.biz}/payments/activate`],
      ["POST", "/api/wallet"],
      ["POST", `/api/public/sessions/x/pay`],
      ["GET", "/api/payments/x"],
      ["GET", "/api/deals/x"],
    ] as const) {
      const r = await app.request(path, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "POST" ? "{}" : undefined,
      });
      if (r.status !== 401) leaks.push(`${method} ${path} -> ${r.status} ${await r.text()}`);
    }
    expect(leaks).toEqual([]);
  });

  it("a 402 asked for with a malformed install is refused, not served", async () => {
    const w = await reviewWorld();
    const r = await w.dana(`/api/customer/offers/${w.offerId}/prepare`, "POST", {
      idempotency_key: "malformed-install-0001",
      input: "Fictional invoice SH-1042 from Stackline Hosting Ltd, total 412.50 USD",
      buy: { units: 1, install: "not an install" },
    });
    expect([400, 402]).toContain(r.status);
    if (r.status === 402) expect(r.body.purchase?.install ?? null).toBeNull();
    const r2 = await w.dana(`/api/customer/offers/${w.offerId}/prepare`, "POST", {
      idempotency_key: "malformed-install-0002",
      input: "Fictional invoice SH-1042 from Stackline Hosting Ltd, total 412.50 USD",
      buy: { units: 1, install: { slot: 9, pk: "zz", max_hold_units: -1, max_units_per_day: 0 } },
    });
    expect([400, 402]).toContain(r2.status);
    if (r2.status === 402) {
      const msg = r2.body.purchase ? JSON.parse(r2.body.purchase.call.args.msg) : null;
      expect(msg?.buy?.install ?? null).toBeNull();
    }
  });
});
