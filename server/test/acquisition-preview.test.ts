// Job 003s: the disposable acquisition preview's scenario (scripts/lib/acquisitionPreview.ts),
// driven through its site's fetch (no listener, no network) as the browser would. SYNTHETIC:
// contract fixture views served in memory, the customer chain double, synthetic keys. The sale
// is applied only through the app's reconciliation; no control writes ownership.

import { describe, expect, it } from "vitest";
import { acquisitionPreview, FIXTURE_START_MS } from "../../scripts/lib/acquisitionPreview.ts";
import { customerPreview, labelScript } from "../../scripts/lib/customerPreview.ts";
import type { Json } from "./customer-world.ts";

const INVOICE =
  "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD";

async function browser(p: Awaited<ReturnType<typeof acquisitionPreview>>, personId: string) {
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

describe("003s1 the preview qualifies itself and reads on a coherent fixture clock", () => {
  it("serves an unmistakable label; the reading is before the deal's own deadline; terms unchanged", async () => {
    const p = await acquisitionPreview();
    const label = await (
      await p.site.fetch(new Request("http://preview/__preview/label.js"))
    ).text();
    expect(label).toContain("window.__everstreetPreview");
    expect(label).toMatch(/Preview only: synthetic sale evidence, customer chain and runtime/);
    expect(label).toMatch(/fixture clock that started at 2026-11-02T00:10:00\.000Z/);
    expect(label).not.toMatch(/sign|key|seed/i);
    const ava = await browser(p, p.people.ava);
    const biz = `/api/businesses/${p.businessId}`;
    await ava(`${biz}/v3/refresh`, "POST", {});
    const ev = (await ava(`${biz}/v3`)).body;
    const at = Date.parse(ev.observed_at);
    expect(at).toBeGreaterThanOrEqual(FIXTURE_START_MS);
    expect(at).toBeLessThan(Number(ev.control.live_deal.expires_at_ms));
    expect(ev.freshness).toBe("fresh");
    // The digest-covered terms are the contract fixture's own.
    expect(ev.control.live_deal).toMatchObject({
      digest: "aa53a9ad33a13ba3e609344b36591db8339482e852a6044a52d1cbda5b68dda4",
      expires_at_ms: "1793664000000",
      price: "300000000000000000000",
    });
    // The customer preview labels itself too.
    const c = await customerPreview();
    const cl = await (await c.site.fetch(new Request("http://preview/__preview/label.js"))).text();
    expect(cl).toMatch(/Preview only: synthetic customer chain, runtime and signer/);
    expect(labelScript({ label: "</script><b>", detail: "" })).not.toContain("</script><b>");
  });
});

describe("003s acquisition preview: record → outcome → actual reconciliation → first shift", () => {
  it("Direct: proposed, accepting, a lost record and a lost reconcile reply, closed, applied once", async () => {
    const p = await acquisitionPreview();
    const ava = await browser(p, p.people.ava);
    const noah = await browser(p, p.people.noah);
    const cara = await browser(p, p.people.cara);
    const biz = `/api/businesses/${p.businessId}`;
    const before = p.controls.summary();
    expect(before.ownership).toEqual([]);
    expect((await ava(`${biz}/v3/refresh`, "POST", {})).body.outcome).toBe("accepted");
    const ev = (await ava(`${biz}/v3`)).body;
    expect(ev.control.live_deal.state).toBe("proposed");
    // Recording a lost answer: the same key finds the same intent.
    const body = {
      idempotency_key: "preview-intent-0001",
      deal_seq: ev.control.live_deal.seq,
      version: ev.control.live_deal.version,
      digest: ev.control.live_deal.digest,
    };
    p.controls.lose("record");
    expect((await ava(`${biz}/v3/intents`, "POST", body)).status).toBe(502);
    const rec = await ava(`${biz}/v3/intents`, "POST", body);
    expect(rec.status).toBe(200);
    const intent = rec.body.intent.id as string;
    // Accepting: still pending; nothing applies.
    p.controls.deal("accepting");
    expect((await noah(`${biz}/v3/intents/${intent}/reconcile`, "POST")).body.state).toBe(
      "pending",
    );
    expect(p.controls.summary().ownership).toEqual([]);
    // Unavailable evidence grants nothing.
    p.controls.deal("unavailable");
    expect((await noah(`${biz}/v3/intents/${intent}/reconcile`, "POST")).body.state).toBe(
      "unavailable",
    );
    // Closed; the reply is lost after the app applied it; asking again answers "already".
    p.controls.deal("closed");
    p.controls.lose("reconcile");
    expect((await noah(`${biz}/v3/intents/${intent}/reconcile`, "POST")).status).toBe(502);
    expect((await noah(`${biz}/v3/intents/${intent}/reconcile`, "POST")).body.state).toBe(
      "already",
    );
    expect(p.controls.summary().ownership).toEqual([
      { from_id: p.people.ava, to_id: p.people.noah, generation: 2, v3_intent_id: intent },
    ]);
    // Receipts: both participants, minimal; the seller's owner links end, the buyer's work.
    expect((await ava("/api/me/v3/handovers")).body.handovers[0]).toMatchObject({
      you_own_it_now: false,
      receipt: { role: "seller", status: "applied" },
    });
    expect((await ava(`${biz}/customer-offers`)).status).toBe(404);
    expect((await noah(`${biz}/customer-offers`)).body.offers).toHaveLength(1);
    // The customer: same request and result; neither owner reads them.
    expect((await cara(`/api/customer/uses/${p.useId}/result`)).status).toBe(200);
    for (const who of [ava, noah])
      expect((await who(`/api/customer/uses/${p.useId}/result`)).status).toBe(404);
    // A next use waits for metering, then works (the preview's synthetic page signer).
    const go = (key: string) =>
      cara(`/api/customer/offers/${p.offerId}/prepare`, "POST", {
        idempotency_key: key,
        input: INVOICE,
      });
    expect((await go("acq-use-0002")).body.code).toBe("operator_not_authorized");
    p.controls.appointMetering();
    const next = await go("acq-use-0003");
    expect(next.status).toBe(201);
    const sig = await cara("/__preview/sign", "POST", {
      hold_message_hex: next.body.use.envelope.hold.message_hex,
      use_message_hex: next.body.use.envelope.use.message_hex,
    });
    const c = await cara(`/api/customer/uses/${next.body.use.id}/confirm`, "POST", {
      envelope_digest: next.body.use.envelope.envelope_digest,
      ...sig.body,
    });
    expect(c.body.use.state).toBe("reserved");
  });

  it("ended and conflicting evidence change no authority; Gated closes through closing", async () => {
    const e = await acquisitionPreview();
    const ava = await browser(e, e.people.ava);
    const biz = `/api/businesses/${e.businessId}`;
    await ava(`${biz}/v3/refresh`, "POST", {});
    const d = (await ava(`${biz}/v3`)).body.control.live_deal;
    const id = (
      await ava(`${biz}/v3/intents`, "POST", {
        idempotency_key: "preview-intent-0002",
        deal_seq: d.seq,
        version: d.version,
        digest: d.digest,
      })
    ).body.intent.id as string;
    e.controls.deal("conflict");
    expect((await ava(`${biz}/v3/intents/${id}/reconcile`, "POST")).body.state).toBe("conflict");
    expect(e.controls.summary().ownership).toEqual([]);
    const f = await acquisitionPreview();
    const fava = await browser(f, f.people.ava);
    const fb = `/api/businesses/${f.businessId}`;
    await fava(`${fb}/v3/refresh`, "POST", {});
    const fd = (await fava(`${fb}/v3`)).body.control.live_deal;
    const fid = (
      await fava(`${fb}/v3/intents`, "POST", {
        idempotency_key: "preview-intent-0003",
        deal_seq: fd.seq,
        version: fd.version,
        digest: fd.digest,
      })
    ).body.intent.id as string;
    f.controls.deal("cancelled");
    expect((await fava(`${fb}/v3/intents/${fid}/reconcile`, "POST")).body.state).toBe("ended");
    expect(f.controls.summary().ownership).toEqual([]);
    // Gated: closing, then closed by the closer (contract fixtures).
    const g = await acquisitionPreview({ gated: true });
    const gava = await browser(g, g.people.ava);
    const gnoah = await browser(g, g.people.noah);
    const gb = `/api/businesses/${g.businessId}`;
    expect(() => g.controls.deal("accepting")).toThrow(/closer/);
    await gava(`${gb}/v3/refresh`, "POST", {});
    const gd = (await gava(`${gb}/v3`)).body.control.live_deal;
    expect(gd.state).toBe("closing");
    const gid = (
      await gava(`${gb}/v3/intents`, "POST", {
        idempotency_key: "preview-intent-0004",
        deal_seq: gd.seq,
        version: gd.version,
        digest: gd.digest,
      })
    ).body.intent.id as string;
    expect((await gnoah(`${gb}/v3/intents/${gid}/reconcile`, "POST")).body).toMatchObject({
      state: "pending",
      code: "deal_closing",
    });
    g.controls.deal("closed");
    expect((await gnoah(`${gb}/v3/intents/${gid}/reconcile`, "POST")).body.state).toBe("applied");
  });
});
