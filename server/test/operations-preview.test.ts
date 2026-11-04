// Job 003t: the disposable operations preview (scripts/lib/operationsPreview.ts), driven through
// its site's fetch (no listener, no network) as the browser would. SYNTHETIC: fictional customers,
// the customer chain double, contract fixture sale views, synthetic keys. The sale is applied only
// through the app's reconciliation; no control writes ownership.

import { describe, expect, it } from "vitest";
import { operationsPreview } from "../../scripts/lib/operationsPreview.ts";
import type { Json } from "./customer-world.ts";

async function browser(p: Awaited<ReturnType<typeof operationsPreview>>, personId: string) {
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

describe("003t operations preview: recorded activity, an actual sale, the same history", () => {
  it("labels itself; the owner's books show the recorded uses; after the sale the buyer sees them", async () => {
    const p = await operationsPreview();
    const label = await (
      await p.site.fetch(new Request("http://preview/__preview/label.js"))
    ).text();
    expect(label).toMatch(/Preview only: synthetic customers, runtime, worker and sale evidence/);
    expect(label).toMatch(/earlier months are recorded zeros, not history/);
    const ava = await browser(p, p.people.ava);
    const noah = await browser(p, p.people.noah);
    const cara = await browser(p, p.people.cara);
    const biz = `/api/businesses/${p.businessId}`;
    const ops = (await ava(`${biz}/books?months=6`)).body.operations as Json;
    expect(ops.state).toBe("recorded");
    expect(ops.totals.usage).toEqual({
      requested: 8,
      charged: 3, // Cara's, and two charged by the worker
      returned: 1,
      settling: 1,
      needs_attention: 0,
      reserved_unsettled: 1,
      awaiting_reservation: 0,
      never_reserved: 2,
    });
    expect(ops.totals.cost.customers.calls).toBe(5);
    expect(ops.months.at(-1).so_far).toBe(true);
    expect(ops.months.slice(0, -1).every((m: Json) => m.usage.requested === 0)).toBe(true);
    // Noah isn't the owner yet.
    expect((await noah(`${biz}/books`)).status).toBe(404);
    // The actual sale, through the app's reconciliation.
    await ava(`${biz}/v3/refresh`, "POST", {});
    const d = (await ava(`${biz}/v3`)).body.control.live_deal;
    const intent = (
      await ava(`${biz}/v3/intents`, "POST", {
        idempotency_key: "ops-preview-intent-0001",
        deal_seq: d.seq,
        version: d.version,
        digest: d.digest,
      })
    ).body.intent.id as string;
    p.controls.deal("closed");
    expect((await noah(`${biz}/v3/intents/${intent}/reconcile`, "POST")).body.state).toBe(
      "applied",
    );
    expect((await ava(`${biz}/books`)).status).toBe(404);
    const theirs = (await noah(`${biz}/books?months=6`)).body.operations as Json;
    expect(theirs.totals).toEqual(ops.totals);
    expect((await cara(`/api/customer/uses/${p.useId}/result`)).status).toBe(200);
    // After metering is reappointed, a new use and passes: it is charged, and the lost settle
    // answer is read back as charged too. The total grows by exactly one; calls by one.
    p.controls.appointMetering();
    await p.controls.use();
    for (let i = 0; i < 3; i++) await p.controls.pass();
    const after = (await noah(`${biz}/books?months=6`)).body.operations as Json;
    expect(after.totals.usage).toMatchObject({ requested: 9, charged: 5, settling: 0 });
    expect(after.totals.cost.customers.calls).toBe(6);
    expect(p.controls.summary().operations.usage.requested).toBe(9);
  });
});
