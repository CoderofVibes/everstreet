// Job 001b1: the studio status follows actual record changes. Reproduces Astra's finding (retire
// the active offer: the offer panel shows Retired while the summary still says 1 active) over the
// REAL API, then the event wiring; and the store's sequencing, coalescing, failure and access-loss
// rules with a controlled port. No browser, no network.

import { describe, expect, it } from "vitest";
import {
  type CustomerWorld,
  customerWorld,
  SyntheticProtection,
} from "../../server/test/customer-world.ts";
import { ApiError } from "../src/api.ts";
import { type OfferPort, OfferSetup, offerHttp } from "../src/offerSetup.ts";
import type { Releases } from "../src/runtimeApi.ts";
import {
  offersSignature,
  type RecordsPort,
  releasesSignature,
  StudioRecords,
} from "../src/studioRecords.ts";
import { projectStatus } from "../src/studioStatus.ts";

type Caller = CustomerWorld["owner"];
const go =
  (who: Caller) =>
  async (path: string, method = "GET", body?: unknown) => {
    const r = await who(path, method, body);
    if (r.status >= 400) throw new ApiError(r.status, r.body.error ?? "failed", r.body.code);
    return r.body;
  };
const offerPort = (who: Caller): OfferPort => {
  const g = go(who);
  const b = (id: string) => `/api/businesses/${id}`;
  return {
    readiness: (id, p) => g(`${b(id)}/customer-offer-readiness?project=${p}`),
    list: (id) => g(`${b(id)}/customer-offers`),
    inspect: (id, body) => g(`${b(id)}/customer-offer-inspections`, "POST", body),
    create: (id, body) => g(`${b(id)}/customer-offers`, "POST", body),
    retire: (id, o) => g(`${b(id)}/customer-offers/${o}/retire`, "POST"),
  };
};
const recordsPort = (who: Caller): RecordsPort => {
  const g = go(who);
  return {
    releases: (p) => g(`/api/product-projects/${p}/releases`) as Promise<Releases>,
    offers: (b) => g(`/api/businesses/${b}/customer-offers`),
  };
};
const customers = (s: StudioRecords) => {
  const r = s.getState().records;
  if (!r) return null;
  return projectStatus({
    head: 1,
    dirty: false,
    build: { available: true },
    businessId: "b",
    releases: r.releases,
    offers: r.offers,
  }).items.find((i) => i.key === "customers")?.value;
};

describe("001b1 the status follows an actual retirement", () => {
  it("retiring through the offer panel updates the studio status, and only then", async () => {
    const w = await customerWorld({ customer: { protection: new SyntheticProtection() } });
    const offer = await w.offer();
    const status = new StudioRecords(recordsPort(w.owner), {
      projectId: w.f.project,
      businessId: w.f.business,
    });
    await status.refresh();
    expect(customers(status)).toMatch(/^1 active/);
    const panel = new OfferSetup(offerPort(w.owner), {
      personId: w.f.ava.id,
      businessId: w.f.business,
      projectId: w.f.project,
    });
    // The panel's own load: its first report is not a change.
    await panel.start();
    status.notice("offers", offersSignature(panel.getState().offers));
    const reads = status.getState().reads;
    expect(reads).toBe(1);
    await panel.retireOffer(offer);
    await panel.retireOffer(offer);
    expect(panel.getState().offers[0]?.state).toBe("retired");
    // Astra's finding: without the event the summary is stale.
    expect(customers(status)).toMatch(/^1 active/);
    status.notice("offers", offersSignature(panel.getState().offers));
    await status.refresh(); // waits for the triggered read (coalesced into one)
    expect(customers(status)).toBe("None active (earlier offers retired)");
    expect(status.getState().reads).toBeLessThanOrEqual(reads + 2);
  });

  it("an unsuccessful retire changes no signature, so no read and no new status", async () => {
    const w = await customerWorld({ customer: { protection: new SyntheticProtection() } });
    const offer = await w.offer();
    const status = new StudioRecords(recordsPort(w.owner), {
      projectId: w.f.project,
      businessId: w.f.business,
    });
    await status.refresh();
    const panel = new OfferSetup(
      { ...offerPort(w.owner), retire: async () => Promise.reject(new ApiError(503, "down")) },
      { personId: w.f.ava.id, businessId: w.f.business, projectId: w.f.project },
    );
    await panel.start();
    status.notice("offers", offersSignature(panel.getState().offers));
    await panel.retireOffer(offer);
    await panel.retireOffer(offer);
    status.notice("offers", offersSignature(panel.getState().offers));
    expect(status.getState().reads).toBe(1);
    expect(customers(status)).toMatch(/^1 active/);
    void offerHttp; // the production port is the same shape
  });

  it("a release changes the service signature; the same records report no change", () => {
    const base = { active: null, candidates: [] } as unknown as Releases;
    const a = releasesSignature(base, undefined);
    expect(releasesSignature(base, undefined)).toBe(a);
    const checked = {
      active: null,
      candidates: [
        {
          artifact_job: "j1",
          status: "checked",
          latest_check: { id: "e1", release_ready: true },
        },
      ],
    } as unknown as Releases;
    expect(releasesSignature(checked, { id: "e1", state: "completed" })).not.toBe(a);
    const released = { ...checked, active: { id: "r1" } } as unknown as Releases;
    expect(releasesSignature(released, { id: "e1", state: "completed" })).not.toBe(
      releasesSignature(checked, { id: "e1", state: "completed" }),
    );
  });
});

/** A port whose answers the test releases one by one. */
function controlled() {
  const pending: { resolve: (v: unknown) => void; reject: (e: unknown) => void; kind: string }[] =
    [];
  let calls = 0;
  const port: RecordsPort = {
    releases: () =>
      new Promise((resolve, reject) => {
        calls++;
        pending.push({ resolve: resolve as never, reject, kind: "releases" });
      }),
    offers: () =>
      new Promise((resolve, reject) => {
        pending.push({ resolve, reject, kind: "offers" });
      }),
  };
  const answer = async (releases: unknown, offers: unknown) => {
    const r = pending.find((p) => p.kind === "releases");
    const o = pending.find((p) => p.kind === "offers");
    pending.splice(pending.indexOf(r as never), 1);
    pending.splice(pending.indexOf(o as never), 1);
    r?.resolve(releases);
    o?.resolve(offers);
    await new Promise((x) => setTimeout(x, 0));
  };
  const fail = async (e: unknown) => {
    for (const p of pending.splice(0)) p.reject(e);
    await new Promise((x) => setTimeout(x, 0));
  };
  return { port, answer, fail, calls: () => calls, pending };
}
const REL = (active: string | null) =>
  ({ active: active ? { id: active } : null, releases: [], candidates: [], note: "" }) as never;
const OFF = (states: string[]) => ({
  offers: states.map((s, i) => ({
    id: `o${i}`,
    state: s,
    release_id: "r",
    project_id: "p",
    artifact_digest: "d".repeat(64),
    product: { name: "x", revision: 1 },
    source: { network: "testnet", account: "a.near" },
    plan_id: 1,
    plan: {
      unit_price: "1",
      max_units_per_purchase: 1,
      max_units_outstanding: 1,
      max_hold_units: 1,
      hold_ttl_ms: "1",
      settle_grace_ms: "1",
      created_generation: 1,
    },
    asset: "t.near",
    read_block: { height: "1", hash: "h", timestamp_ms: "1" },
    retention_days: 30,
    created_at: "2026-11-04T00:00:00Z",
    retired_at: null,
  })),
});

describe("001b1 the records store: bounded, sequenced, honest", () => {
  it("many events during a read cost one more read, not one each", async () => {
    const c = controlled();
    const s = new StudioRecords(c.port, { projectId: "p", businessId: "b" });
    const first = s.refresh();
    for (let i = 0; i < 20; i++) void s.refresh();
    expect(c.calls()).toBe(1);
    await c.answer(REL(null), OFF(["active"]));
    expect(c.calls()).toBe(2); // the one queued read
    await c.answer(REL("r1"), OFF(["retired"]));
    await first;
    expect(c.calls()).toBe(2);
    expect(s.getState().records?.offers).toEqual({ active: 0, retired: 1 });
  });

  it("an answer after the page closed lands nowhere", async () => {
    const c = controlled();
    const s = new StudioRecords(c.port, { projectId: "p", businessId: "b" });
    const r = s.refresh();
    s.dispose();
    await c.answer(REL("r1"), OFF(["active"]));
    await r;
    expect(s.getState().records).toBeNull();
  });

  it("lost access clears the records and stops reading; other failures are unknown, not assumed", async () => {
    const c = controlled();
    const s = new StudioRecords(c.port, { projectId: "p", businessId: "b" });
    const r = s.refresh();
    await c.fail(new ApiError(503, "down"));
    await r;
    expect(s.getState().records).toEqual({ releases: "unknown", offers: "unknown" });
    const again = s.refresh();
    await c.fail(new ApiError(404, "gone"));
    await again;
    expect(s.getState()).toMatchObject({ gone: true, records: null });
    await s.refresh();
    expect(c.calls()).toBe(2);
  });
});
