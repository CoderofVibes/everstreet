// Job 003u: the disposable evidence preview (scripts/lib/evidencePreview.ts), driven through its
// site's fetch (no listener, no network) as the browser would. SYNTHETIC throughout.

import { describe, expect, it } from "vitest";
import { evidencePreview } from "../../scripts/lib/evidencePreview.ts";
import type { Json } from "./customer-world.ts";

async function browser(p: Awaited<ReturnType<typeof evidencePreview>>, personId: string) {
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

describe("003u2 evidence preview: the customers summary, whole or withheld", () => {
  it("Astra's shape is withheld in room and export alike; the large shape is exact; no rows is zeros", async () => {
    const p = await evidencePreview();
    const ava = await browser(p, p.people.ava);
    const cole = await browser(p, p.people.marshBuyer);
    const room = `/api/acquire/rooms/${p.requests.marsh}`;
    expect((await cole(room)).status).toBe(403); // pending
    expect(
      (await ava(`/api/acquire/requests/${p.requests.marsh}/decide`, "POST", { action: "grant" }))
        .status,
    ).toBe(200);
    const values = (c: Json) =>
      Object.fromEntries((c.rows as Json[]).map((r) => [r.label, r.value]));
    const small = (await cole(room)).body.customers as Json;
    expect(small.withheld).toBe(true);
    expect(values(small).Refunded).toBe("Withheld");
    expect((await cole(`${room}/export`)).body.customers).toEqual(small);
    p.legacyPayments("large");
    const large = (await cole(room)).body.customers as Json;
    expect(large.withheld).toBe(false);
    expect(values(large)).toMatchObject({ "Paid orders": "9", Refunded: "3" });
    p.legacyPayments("none");
    expect(values((await cole(room)).body.customers as Json)["Paid orders"]).toBe("0");
    // The other teams' scopes are unchanged: no customers summary without that category.
    expect(
      (await ava(`/api/acquire/requests/${p.requests.ruiz}/decide`, "POST", { action: "grant" }))
        .status,
    ).toBe(200);
    const ruiz = await browser(p, p.people.ruizBuyer);
    expect("customers" in (await ruiz(`/api/acquire/rooms/${p.requests.ruiz}`)).body).toBe(false);
  });
});

describe("003u evidence preview: request, deliberate grant, scoped figures, sale ends access", () => {
  it("only the team that asked and was granted sees digital performance; a sale ends it", async () => {
    const p = await evidencePreview();
    const ava = await browser(p, p.people.ava);
    const fenn = await browser(p, p.people.fennBuyer);
    const ruiz = await browser(p, p.people.ruizBuyer);
    const room = (req: string) => `/api/acquire/rooms/${req}`;
    // Pending: nothing until the owner decides.
    expect((await fenn(room(p.requests.fenn))).status).toBe(403);
    expect(
      (await ava(`/api/acquire/requests/${p.requests.fenn}/decide`, "POST", { action: "grant" }))
        .status,
    ).toBe(200);
    expect(
      (await ava(`/api/acquire/requests/${p.requests.ruiz}/decide`, "POST", { action: "grant" }))
        .status,
    ).toBe(200);
    const f = (await fenn(room(p.requests.fenn))).body;
    expect(f.digital_performance.state).toBe("recorded");
    expect(f.digital_performance.usage.requested).toBe(8);
    const exported = (await fenn(`${room(p.requests.fenn)}/export`)).body;
    expect(exported.digital_performance.usage).toEqual(f.digital_performance.usage);
    const r = (await ruiz(room(p.requests.ruiz))).body;
    expect("digital_performance" in r).toBe(false);
    // The actual sale (to the fixture buyer) revokes every grant on the listing.
    const biz = `/api/businesses/${p.businessId}`;
    await ava(`${biz}/v3/refresh`, "POST", {});
    const d = (await ava(`${biz}/v3`)).body.control.live_deal;
    const intent = (
      await ava(`${biz}/v3/intents`, "POST", {
        idempotency_key: "evidence-preview-intent-0001",
        deal_seq: d.seq,
        version: d.version,
        digest: d.digest,
      })
    ).body.intent.id as string;
    p.controls.deal("closed");
    const noah = await browser(p, p.people.noah);
    expect((await noah(`${biz}/v3/intents/${intent}/reconcile`, "POST")).body.state).toBe(
      "applied",
    );
    const after = await fenn(room(p.requests.fenn));
    expect(after.status).toBe(403);
    expect("digital_performance" in after.body).toBe(false);
  });
});
