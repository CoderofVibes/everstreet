// Phase 5: buying profiles and teams, the seller's own choice of discovery, a separate
// acquisition index with honest unknowns, named access requests, narrowed time-boxed grants and
// an evidence room that stops the moment access ends.

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TestDoubleAuthority } from "../../services/openseat/src/authority.ts";
import { openSeatApp } from "../../services/openseat/src/http.ts";
import { OpenSeat } from "../../services/openseat/src/service.ts";
import { interpretAcquire } from "../src/acquire.ts";
import { everstreetApi } from "../src/app.ts";
import { openSeatProvider } from "../src/bookings.ts";
import { addMonths, ym } from "../src/books.ts";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";
import { FakeChain } from "./fake-chain.ts";

// biome-ignore lint/suspicious/noExplicitAny: tests read deep response fields
type Json = Record<string, any>;

function world() {
  const openseat = new OpenSeat({
    dbPath: ":memory:",
    authority: new TestDoubleAuthority("o.test", "o.test"),
  });
  const http = openSeatApp(openseat);
  const store = new Store(openDb(":memory:"));
  const app = everstreetApi(store, {
    localPreview: true,
    environment: "test",
    bookingProvider: openSeatProvider((p, i) => Promise.resolve(http.request(p, i))),
    chain: new FakeChain(),
  });
  const as =
    (cookie: string) =>
    async (path: string, method = "GET", body?: unknown) => {
      const res = await app.request(path, {
        method,
        headers: { cookie, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: JSON.parse(text) as Json, text };
    };
  const join = async (name: string) => {
    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const call = as((res.headers.get("set-cookie") ?? "").split(";")[0] ?? "");
    return Object.assign(call, { id: ((await res.clone().json()) as Json).person.id as string });
  };
  return { store, join, anon: as("") };
}

type Caller = Awaited<ReturnType<ReturnType<typeof world>["join"]>>;

async function business(
  _w: ReturnType<typeof world>,
  founder: Caller,
  name: string,
  family: string,
) {
  const p = (await founder("/api/projects", "POST", { route: "started", name })).body;
  await founder(`/api/projects/${p.id}/answers`, "PATCH", {
    audience: "Small online shops",
    outcome: "A clean PDF receipt",
    deliverable: "A hosted API",
    price: "$10",
    when: "Available now",
    where: "Online",
    capacity: "100",
    confirmed: true,
  });
  await founder(`/api/businesses/${p.business.id}`, "PATCH", { family });
  await founder(`/api/businesses/${p.business.id}/publish`, "POST");
  return { id: p.business.id as string, slug: p.business.slug as string };
}

function history(w: ReturnType<typeof world>, businessId: string, revenue: number, cost: number) {
  for (let i = 3; i >= 1; i--) {
    const m = addMonths(ym(), -i);
    w.store.db
      .prepare(
        "INSERT INTO seeded_periods (business_id, yyyymm, revenue_cents, note) VALUES (?, ?, ?, 'Renders')",
      )
      .run(businessId, m, revenue);
    w.store.db
      .prepare(
        "INSERT INTO costs (id, business_id, yyyymm, category, kind, amount_cents, recurring, note, origin, created_at) VALUES (?, ?, ?, 'Hosting and compute', 'direct', ?, 0, '', 'seeded', ?)",
      )
      .run(randomUUID(), businessId, m, cost, new Date().toISOString());
  }
}

/** Nadia's Paperfin, listed by name at $195,000 with Astra's numbers; Owen's Northline team. */
async function market() {
  const w = world();
  const nadia = await w.join("Nadia Vale");
  const paperfin = await business(w, nadia, "Paperfin API", "software");
  history(w, paperfin.id, 1_200_000, 450_000);
  await nadia(`/api/businesses/${paperfin.id}/value/settings`, "PATCH", {
    founder_hours_week: 4.62,
    hourly_rate_cents: 5000,
    multiple_low: 2,
    multiple_high: 3,
  });
  const owen = await w.join("Owen Hart");
  const sam = await w.join("Sam Lee");
  const northline = (
    await owen("/api/acquire/buyers", "POST", {
      name: "Northline Studio Tools",
      kind: "strategic",
      intent: "add",
      about: "We build tools for independent studios.",
    })
  ).body;
  await owen(`/api/acquire/buyers/${northline.buyer.id}/members`, "POST", {
    person_id: sam.id,
    role: "research",
  });
  return { w, nadia, owen, sam, paperfin, buyerId: northline.buyer.id as string };
}

async function list(m: Awaited<ReturnType<typeof market>>, patch: Json = {}) {
  const r = await m.nadia(`/api/businesses/${m.paperfin.id}/listing`, "PATCH", {
    mode: "named",
    openness: "open",
    asking_cents: 19_500_000,
    reason: "I want to go back to building.",
    disclose: ["revenue", "profit", "value", "founder_hours", "history"],
    ...patch,
  });
  expect(r.status).toBe(200);
  return r.body;
}

const search = (who: Caller, buyerId: string, criteria: Json = {}) =>
  who("/api/acquire/search", "POST", { criteria, buyer_id: buyerId });

describe("a buying profile and its team", () => {
  it("gives each member only what their role allows", async () => {
    const m = await market();
    await list(m);
    const ws = (await m.sam(`/api/acquire/buyers/${m.buyerId}`)).body;
    expect(ws.role).toBe("research");
    expect(ws.members.map((x: Json) => [x.name, x.role])).toEqual([
      ["Owen Hart", "approve"],
      ["Sam Lee", "research"],
    ]);
    const found = (await search(m.sam, m.buyerId)).body.results;
    expect(found).toHaveLength(1);
    const listingId = found[0].listing_id;
    expect(
      (await m.sam(`/api/acquire/buyers/${m.buyerId}/shortlist`, "POST", { listing_id: listingId }))
        .status,
    ).toBe(200);
    const asked = await m.sam(`/api/acquire/listings/${listingId}/requests`, "POST", {
      buyer_id: m.buyerId,
      categories: ["financials"],
      purpose: "Check the monthly numbers",
      days: 7,
    });
    expect(asked.status).toBe(403);
    const stranger = await m.w.join("Iris Moss");
    expect((await stranger(`/api/acquire/buyers/${m.buyerId}`)).status).toBe(404);
  });
});

describe("the seller decides who may discover the business", () => {
  it("keeps acquisition status out of customer search and the public page", async () => {
    const m = await market();
    await m.nadia(`/api/businesses/${m.paperfin.id}/value/settings`, "PATCH", {
      share_numbers: true,
    });
    // Sharing numbers publicly does not list the business.
    expect((await search(m.owen, m.buyerId)).body.results).toHaveLength(0);
    await list(m);
    const page = await m.w.anon(`/api/public/businesses/${m.paperfin.slug}`);
    const customerSearch = await m.w.anon("/api/public/search?q=receipt");
    for (const text of [page.text, customerSearch.text]) {
      expect(text).not.toMatch(/asking|listing|open to offers|195,000|19500000/i);
    }
    expect((await search(m.owen, m.buyerId)).body.results).toHaveLength(1);
    await list(m, { mode: "closed" });
    expect((await search(m.owen, m.buyerId)).body.results).toHaveLength(0);
  });

  it("shows an anonymous teaser only in bands, and a private listing only to invited teams", async () => {
    const m = await market();
    await list(m, { mode: "anonymous" });
    const r = await search(m.owen, m.buyerId, { value_max_cents: 12_000_000 });
    expect(r.text).not.toMatch(/Paperfin|paperfin|Nadia/);
    const teaser = r.body.results[0];
    expect(teaser.title).toMatch(/^Software or API · ES-/);
    expect(teaser.value.text).toBe("$100k–$250k (band)");
    expect(teaser.value.low_cents).toBeUndefined();
    // Filtered by its band: the exact range ($156k–$234k) would not overlap $120k.
    expect(r.body.results).toHaveLength(1);

    await list(m, { mode: "private", invites: [] });
    expect((await search(m.owen, m.buyerId)).body.results).toHaveLength(0);
    await list(m, { mode: "private", invites: [m.buyerId] });
    expect((await search(m.owen, m.buyerId)).body.results).toHaveLength(1);
    expect((await m.w.anon("/api/acquire/search", "POST", {})).body.results).toHaveLength(0);
  });
});

describe("searching the acquisition index", () => {
  it("explains every match, keeps asking price and estimate apart, and never hides unknowns silently", async () => {
    const m = await market();
    await list(m);
    const ana = await m.w.join("Ana Ruiz");
    const candles = await business(m.w, ana, "Small Hours Candles", "product");
    await ana(`/api/businesses/${candles.id}/listing`, "PATCH", { mode: "named" });

    const fit = (
      await search(m.owen, m.buyerId, { families: ["software"], max_asking_cents: 20_000_000 })
    ).body;
    expect(fit.results.map((x: Json) => x.title)).toEqual(["Paperfin API"]);
    expect(fit.results[0].reasons).toEqual(["Software or API", "Asking $195,000, within $200,000"]);
    expect(fit.results[0].asking.text).toBe("$195,000");
    expect(fit.results[0].value.text).toBe("$156,000–$234,000");

    const tight = (await search(m.owen, m.buyerId, { max_asking_cents: 15_000_000 })).body;
    expect(tight.results.map((x: Json) => x.title)).toEqual(["Small Hours Candles"]);
    expect(tight.results[0].unknowns).toContain("No asking price set");
    expect(tight.ruled_out).toEqual([{ filter: "asking price", count: 1 }]);

    const overlap = (await search(m.owen, m.buyerId, { value_max_cents: 20_000_000 })).body;
    expect(overlap.results.map((x: Json) => x.title)).toEqual(["Paperfin API"]);
    expect(overlap.hidden[0].relax).toEqual({ include_unestimated: true });
    const within = (
      await search(m.owen, m.buyerId, { value_max_cents: 20_000_000, value_mode: "within" })
    ).body;
    expect(within.results).toHaveLength(0);
    const all = (
      await search(m.owen, m.buyerId, { value_max_cents: 20_000_000, include_unestimated: true })
    ).body;
    expect(all.results).toHaveLength(2);
  });

  it("turns a written brief into the same visible filters", () => {
    expect(
      interpretAcquire(
        "Software or services for independent studios, remote, up to $200k asking, under 10 hours a week",
      ),
    ).toEqual({
      families: ["software", "service"],
      remote: true,
      max_founder_hours: 10,
      max_asking_cents: 20_000_000,
    });
  });
});

describe("access to evidence", () => {
  async function granted() {
    const m = await market();
    await list(m);
    const listingId = (await search(m.owen, m.buyerId)).body.results[0].listing_id;
    const asked = await m.owen(`/api/acquire/listings/${listingId}/requests`, "POST", {
      buyer_id: m.buyerId,
      categories: ["financials", "customers", "operations"],
      purpose: "Check the numbers behind the estimate before we talk price",
      days: 7,
    });
    expect(asked.status).toBe(201);
    const id = asked.body.request.id as string;
    const seller = (await m.nadia(`/api/businesses/${m.paperfin.id}/listing`)).body;
    expect(seller.requests[0].buyer.name).toBe("Northline Studio Tools");
    expect(seller.requests[0].buyer.members).toHaveLength(2);
    expect((await m.owen(`/api/acquire/rooms/${id}`)).status).toBe(403);
    return { ...m, id, listingId };
  }

  it("lets the seller narrow a grant, and the room shows only what was granted", async () => {
    const g = await granted();
    const widen = await g.nadia(`/api/acquire/requests/${g.id}/decide`, "POST", {
      action: "grant",
      categories: ["financials", "costs"],
    });
    expect(widen.status).toBe(400);
    const ok = await g.nadia(`/api/acquire/requests/${g.id}/decide`, "POST", {
      action: "grant",
      categories: ["financials", "operations"],
      days: 3,
    });
    expect(ok.body.request.status).toBe("granted");
    const room = (await g.owen(`/api/acquire/rooms/${g.id}`)).body;
    expect(room.business.name).toBe("Paperfin API");
    expect(room.financials.estimate.low_cents).toBe(15_600_000);
    expect(room.customers).toBeUndefined();
    expect(room.costs).toBeUndefined();
    expect(room.operations.manifest.receive[0].status).toBe("Blocked");

    // Reproduce the headline number from the rows the room gives.
    const r = room.financials.reproduce;
    const profit = r.months.reduce(
      (a: number, x: Json) => a + x.revenue_cents - x.direct_cents - x.overhead_cents,
      0,
    );
    const annual = Math.round((profit - r.labor_month_cents * r.months.length) * r.annualize_by);
    expect(Math.round((annual * r.multiple_low) / 10000) * 10000).toBe(15_600_000);

    // A research member can't open the room; the buyer's own scenario leaves the founder's alone.
    expect((await g.sam(`/api/acquire/rooms/${g.id}`)).status).toBe(403);
    const mine = await g.owen(`/api/acquire/rooms/${g.id}/scenarios`, "POST", {
      name: "Our hourly cost",
      overrides: { hourly_rate_cents: 8000 },
    });
    expect(mine.body.scenarios[0].low_cents).toBeLessThan(15_600_000);
    expect((await g.nadia(`/api/businesses/${g.paperfin.id}/value`)).body.estimate.low_cents).toBe(
      15_600_000,
    );
    const log = (await g.nadia(`/api/businesses/${g.paperfin.id}/listing`)).body.requests[0];
    expect(log.opened.count).toBeGreaterThanOrEqual(1);
  });

  it("ends access when the seller revokes it or the grant expires", async () => {
    const g = await granted();
    await g.nadia(`/api/acquire/requests/${g.id}/decide`, "POST", { action: "grant" });
    expect((await g.owen(`/api/acquire/rooms/${g.id}`)).status).toBe(200);
    g.w.store.db
      .prepare("UPDATE access_requests SET expires_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), g.id);
    const expired = await g.owen(`/api/acquire/rooms/${g.id}`);
    expect(expired.status).toBe(403);
    expect(expired.body.error).toMatch(/This access ended/);
    expect((await g.owen(`/api/acquire/rooms/${g.id}/export`)).status).toBe(403);

    // A new request, granted then revoked.
    const again = await g.owen(`/api/acquire/listings/${g.listingId}/requests`, "POST", {
      buyer_id: g.buyerId,
      categories: ["financials"],
      purpose: "One more look at October",
      days: 2,
    });
    const id = again.body.request.id as string;
    await g.nadia(`/api/acquire/requests/${id}/decide`, "POST", { action: "grant" });
    expect((await g.owen(`/api/acquire/rooms/${id}`)).status).toBe(200);
    await g.nadia(`/api/acquire/requests/${id}/revoke`, "POST");
    const revoked = await g.owen(`/api/acquire/rooms/${id}`);
    expect(revoked.status).toBe(403);
    expect(revoked.body.error).toMatch(/The seller ended this access/);
  });

  it("refuses a team that was never granted anything", async () => {
    const g = await granted();
    await g.nadia(`/api/acquire/requests/${g.id}/decide`, "POST", { action: "grant" });
    const other = await g.w.join("Iris Moss");
    await other("/api/acquire/buyers", "POST", {
      name: "Moss Capital",
      kind: "fund",
      intent: "team",
    });
    expect((await other(`/api/acquire/rooms/${g.id}`)).status).toBe(404);
    expect((await g.w.anon(`/api/acquire/rooms/${g.id}`)).status).toBe(401);
  });
});

describe("plan step 6: a buying team's representative, positions and history", () => {
  const link = (m: Awaited<ReturnType<typeof market>>, personId: string, account: string) =>
    m.w.store.db
      .prepare(
        "INSERT INTO chain_accounts (owner_kind, owner_id, account_id, tx, created_at) VALUES ('person', ?, ?, 'fixture', ?)",
      )
      .run(personId, account, new Date().toISOString());

  it("the lead names who signs; members record positions that bind nobody; every change is recorded", async () => {
    const m = await market();
    await list(m);
    const listingId = (await search(m.owen, m.buyerId)).body.results[0].listing_id as string;
    // Sam can't sign until a NEAR account is linked to him; only the lead names the signer.
    const none = await m.owen(`/api/acquire/buyers/${m.buyerId}/representative`, "POST", {
      person_id: m.sam.id,
    });
    expect([none.status, none.body.code]).toEqual([409, "no_account"]);
    link(m, m.sam.id, "sam.near");
    await m.owen(`/api/acquire/buyers/${m.buyerId}/members`, "POST", {
      person_id: m.sam.id,
      role: "approve",
    });
    const bySam = await m.sam(`/api/acquire/buyers/${m.buyerId}/representative`, "POST", {
      person_id: m.sam.id,
    });
    expect([bySam.status, bySam.body.code]).toEqual([403, "not_lead"]);
    const set = await m.owen(`/api/acquire/buyers/${m.buyerId}/representative`, "POST", {
      person_id: m.sam.id,
    });
    expect(set.body.representative).toMatchObject({ name: "Sam Lee", account: "sam.near" });
    expect(set.body.team_is_not).toMatch(/isn't a joint owner or a fund/);
    // Positions: the approve role records one; it's shown to the team as a record only.
    const pos = await m.sam(`/api/acquire/buyers/${m.buyerId}/positions/${listingId}`, "POST", {
      position: "support",
      note: "The numbers hold up.",
    });
    expect(pos.body.positions[listingId]).toEqual([
      expect.objectContaining({
        name: "Sam Lee",
        position: "support",
        note: "The numbers hold up.",
      }),
    ]);
    expect(
      (
        await m.owen(`/api/acquire/buyers/${m.buyerId}/positions/${listingId}`, "POST", {
          position: "maybe",
        })
      ).body.code,
    ).toBe("bad_position");
    // The seller sees which account will sign for the team when it asks for access.
    await m.owen(`/api/acquire/listings/${listingId}/requests`, "POST", {
      buyer_id: m.buyerId,
      categories: ["financials"],
      purpose: "Check the numbers",
      days: 7,
    });
    const seller = (await m.nadia(`/api/businesses/${m.paperfin.id}/listing`)).body;
    expect(seller.requests[0].buyer.representative).toEqual({
      name: "Sam Lee",
      account: "sam.near",
    });
    // Removing Sam clears the signer and his position; the history keeps all of it.
    const out = await m.owen(`/api/acquire/buyers/${m.buyerId}/members/${m.sam.id}`, "DELETE");
    expect(out.body.representative).toBeNull();
    expect(out.body.positions[listingId]).toBeUndefined();
    expect(out.body.team_history.map((e: Json) => e.kind).reverse()).toEqual([
      "added",
      "role_changed",
      "representative",
      "removed",
      "representative_cleared",
    ]);
    expect((await m.sam(`/api/acquire/buyers/${m.buyerId}`)).status).toBe(404);
    expect(() => m.w.store.db.prepare("DELETE FROM buyer_member_events").run()).toThrow(
      /append-only/,
    );
  });
});
