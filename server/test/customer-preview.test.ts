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
) {
  const prep = await cara(`/api/customer/offers/${p.offerId}/prepare`, "POST", {
    idempotency_key: key,
    input: INVOICE,
  });
  expect(prep.status).toBe(201);
  const env = prep.body.use.envelope;
  const t = prep.body.use.offer.terms;
  // The page checks the envelope itself before the authorizer is asked.
  const check = await verifyEnvelope(env, {
    input: INVOICE,
    offerId: p.offerId,
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
    const p = await customerPreview();
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
    const p = await customerPreview();
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
