// Job 003q: the disposable customer preview's scenario (scripts/lib/customerPreview.ts), driven
// through its site's fetch (no listener, no network) exactly as the browser would: the page-side
// authorizer is the preview's own signer endpoint. SYNTHETIC: chain double, scripted extractor,
// in-memory protection, synthetic key. Not a live NEAR transaction.

import { describe, expect, it } from "vitest";
import {
  AUTHORIZER_SCRIPT,
  customerPreview,
  PREVIEW_PUBLIC_KEY,
} from "../../scripts/lib/customerPreview.ts";
import { verifyEnvelope } from "../../web/src/customerEnvelope.ts";
import type { Json } from "./customer-world.ts";

const INVOICE =
  "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD";

async function browser(p: Awaited<ReturnType<typeof customerPreview>>, personId: string) {
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

async function oneUse(
  p: Awaited<ReturnType<typeof customerPreview>>,
  cara: Awaited<ReturnType<typeof browser>>,
  key: string,
  offerId = p.offerId as string,
) {
  const prep = await cara(`/api/customer/offers/${offerId}/prepare`, "POST", {
    idempotency_key: key,
    input: INVOICE,
  });
  expect(prep.status).toBe(201);
  const env = prep.body.use.envelope;
  const t = prep.body.use.offer.terms;
  // The page checks the envelope itself before the authorizer is asked.
  const check = await verifyEnvelope(env, {
    input: INVOICE,
    offerId,
    network: t.network,
    contract: t.contract,
    unitPrice: t.unit_price,
    asset: t.asset,
    retentionDays: t.retention_days,
    publicKey: PREVIEW_PUBLIC_KEY,
    now: Date.now(),
  });
  expect(check).toEqual({ ok: true });
  const sig = await cara("/__preview/sign", "POST", {
    hold_message_hex: env.hold.message_hex,
    use_message_hex: env.use.message_hex,
  });
  const id = prep.body.use.id as string;
  const c = await cara(`/api/customer/uses/${id}/confirm`, "POST", {
    envelope_digest: env.envelope_digest,
    ...sig.body,
  });
  expect(c.body.use.state).toBe("reserved");
  const x = await cara(`/api/customer/uses/${id}/execute`, "POST", {});
  expect(x.body.use.execution.fulfilled).toBe(true);
  let unit = "";
  for (let i = 0; i < 3 && unit !== "charged"; i++)
    unit = (await cara(`/api/customer/uses/${id}/units/reconcile`, "POST")).body.use.units.unit;
  expect(unit).toBe("charged");
  return id;
}

describe("003q customer preview scenario", () => {
  it("100 → one successful use → 99; the result survives a sale; neither owner reads it; the next use works", async () => {
    const p = await customerPreview({ withOffer: true });
    expect(AUTHORIZER_SCRIPT).toContain("Preview only");
    const cara = await browser(p, p.people.cara);
    const pub = await cara("/api/public/businesses/ledgerline/customer-offers");
    expect(pub.body.offers[0]).toMatchObject({
      offer_id: p.offerId,
      business: { name: "Ledgerline Invoice Reader" },
    });
    const id = await oneUse(p, cara, "preview-key-0001");
    expect(p.controls.summary()).toMatchObject({
      entitlement: { free: "99", consumed: "1" },
      provider_calls: expect.any(Number),
      settle_calls: 1,
    });
    p.controls.sale();
    const ava = await browser(p, p.people.ava);
    const noah = await browser(p, p.people.noah);
    expect((await cara(`/api/customer/uses/${id}/result`)).status).toBe(200);
    expect((await ava(`/api/customer/uses/${id}/result`)).status).toBe(404);
    expect((await noah(`/api/customer/uses/${id}/result`)).status).toBe(404);
    await oneUse(p, cara, "preview-key-0002");
    expect(p.controls.summary().entitlement).toMatchObject({ free: "98", consumed: "2" });
  });

  it("controls: a lost answer is recoverable, and the authorizer can be switched off", async () => {
    const p = await customerPreview({ withOffer: true });
    const cara = await browser(p, p.people.cara);
    p.controls.lose("prepare");
    const lost = await cara(`/api/customer/offers/${p.offerId}/prepare`, "POST", {
      idempotency_key: "preview-key-0003",
      input: INVOICE,
    });
    expect(lost.status).toBe(502);
    const again = await cara(`/api/customer/offers/${p.offerId}/prepare`, "POST", {
      idempotency_key: "preview-key-0003",
      input: INVOICE,
    });
    expect(again.status).toBe(200); // the same request, found again
    p.controls.authorizer(false);
    expect(
      (
        await cara("/__preview/sign", "POST", {
          hold_message_hex: "00".repeat(32),
          use_message_hex: "00".repeat(32),
        })
      ).status,
    ).toBe(503);
  });
});

describe("003r preview: founder setup → customer use → retire → own history → sale", () => {
  it("runs the whole journey through the preview site, as the browser would", async () => {
    const p = await customerPreview();
    expect(p.offerId).toBeNull();
    const ava = await browser(p, p.people.ava);
    const cara = await browser(p, p.people.cara);
    const biz = `/api/businesses/${p.w.f.business}`;
    // Nothing is offered yet: the public page has no product.
    expect((await cara("/api/public/businesses/ledgerline/customer-offers")).body.offers).toEqual(
      [],
    );
    const ready = await ava(`${biz}/customer-offer-readiness?project=${p.projectId}`);
    expect(ready.body.readiness.items.find((i: Json) => i.key === "plan").state).toBe("unknown");
    // Inspect, then a lost create answer, recovered with the same request: one offer.
    const terms = { release_id: p.w.release, plan_id: 1, retention_days: 30 };
    const insp = await ava(`${biz}/customer-offer-inspections`, "POST", terms);
    expect(insp.status).toBe(200);
    const body = {
      ...terms,
      idempotency_key: "preview-offer-0001",
      reviewed_terms: insp.body.inspection.terms_digest,
    };
    p.controls.lose("offer");
    expect((await ava(`${biz}/customer-offers`, "POST", body)).status).toBe(502);
    const made = await ava(`${biz}/customer-offers`, "POST", body);
    expect(made.status).toBe(200); // found again, not made twice
    const offerId = made.body.offer.id as string;
    expect(p.controls.summary().offers).toHaveLength(1);
    // A price change after review needs a fresh review.
    p.controls.planPrice("70000");
    const stale = await ava(`${biz}/customer-offers`, "POST", {
      ...body,
      idempotency_key: "preview-offer-0002",
    });
    expect(stale.body.code).toBe("terms_changed");
    p.controls.planPrice("50000");
    // The customer finds it and uses it once.
    const pub = await cara("/api/public/businesses/ledgerline/customer-offers");
    expect(pub.body.offers.map((o: Json) => o.offer_id)).toEqual([offerId]);
    const id = await oneUse(p, cara, "preview-key-0101", offerId);
    // Retired: no new uses, the customer's own history remains.
    p.controls.lose("retire");
    expect((await ava(`${biz}/customer-offers/${offerId}/retire`, "POST")).status).toBe(502);
    expect((await ava(`${biz}/customer-offers/${offerId}/retire`, "POST")).body.offer.state).toBe(
      "retired",
    );
    const refused = await cara(`/api/customer/offers/${offerId}/prepare`, "POST", {
      idempotency_key: "preview-key-0102",
      input: INVOICE,
    });
    expect(refused.body.code).toBe("offer_retired");
    expect((await cara("/api/customer/uses")).body.uses.map((u: Json) => u.id)).toContain(id);
    expect((await cara(`/api/customer/requests/by-key/preview-key-0101`)).body.use.id).toBe(id);
    expect((await cara(`/api/customer/uses/${id}/result`)).status).toBe(200);
    // A simulated sale: the buyer manages the offers, the seller is out, nobody reads customers.
    p.controls.sale();
    const noah = await browser(p, p.people.noah);
    expect((await noah(`${biz}/customer-offers`)).body.offers).toHaveLength(1);
    expect((await ava(`${biz}/customer-offers`)).status).toBe(404);
    for (const who of [ava, noah])
      expect((await who(`/api/customer/uses/${id}/result`)).status).toBe(404);
    expect((await cara(`/api/customer/uses/${id}/result`)).status).toBe(200);
  });
});
