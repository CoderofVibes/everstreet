// Phase 6: exact terms accepted by both people on the business's contract, revisions that clear
// acceptances, a close that happens once, the buyer in control while customers keep their
// rights, the former owner refused by the contract, proceeds that wait until claimed, and a
// competing deal voided with its hold returned.

import { describe, expect, it } from "vitest";
import { TestDoubleAuthority } from "../../services/openseat/src/authority.ts";
import { openSeatApp } from "../../services/openseat/src/http.ts";
import { OpenSeat } from "../../services/openseat/src/service.ts";
import { everstreetApi } from "../src/app.ts";
import { openSeatProvider } from "../src/bookings.ts";
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
  const chain = new FakeChain();
  const store = new Store(openDb(":memory:"));
  const app = everstreetApi(store, {
    localPreview: true,
    environment: "test",
    bookingProvider: openSeatProvider((p, i) => Promise.resolve(http.request(p, i))),
    chain,
  });
  const as =
    (cookie: string) =>
    async (path: string, method = "GET", body?: unknown) => {
      const res = await app.request(path, {
        method,
        headers: { cookie, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as Json };
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
  return { chain, store, join, anon: as("") };
}

type Caller = Awaited<ReturnType<ReturnType<typeof world>["join"]>>;

/** Juniper with payments on and one paid order from Theo before any sale; the co-op has asked. */
async function juniperForSale() {
  const w = world();
  const mara = await w.join("Mara Solis");
  const p = (
    await mara("/api/projects", "POST", { route: "started", name: "Juniper Print Studio" })
  ).body;
  const id = p.business.id as string;
  await mara(`/api/projects/${p.id}/answers`, "PATCH", {
    audience: "Adults new to printmaking",
    outcome: "Three linocut prints",
    deliverable: "90 minutes",
    price: "$35",
    when: "Saturdays",
    where: "14 Alder Lane",
    capacity: "6",
    confirmed: true,
  });
  await mara(`/api/businesses/${id}`, "PATCH", { family: "class" });
  await mara(`/api/businesses/${id}/publish`, "POST");
  const act = await mara(`/api/businesses/${id}/payments/activate`, "POST", {
    refund_hours: 24,
    reserve_cents: 0,
  });
  expect(act.status).toBe(201);
  await mara(`/api/businesses/${id}/sessions`, "POST", {
    starts_at: new Date(Date.now() + 72 * 3_600_000).toISOString(),
    duration_minutes: 90,
    capacity: 6,
  });
  const page = (await w.anon(`/api/public/businesses/${p.business.slug}`)).body;
  const theo = await w.join("Theo Park");
  const order = (
    await theo(`/api/public/sessions/${page.sessions[0].id}/pay`, "POST", { source: "link" })
  ).body;
  expect(order.status).toBe("paid");

  const ana = await w.join("Ana Ruiz");
  const sam = await w.join("Sam Lee");
  const coop = (
    await ana("/api/acquire/buyers", "POST", {
      name: "Alder Lane Makers Co-op",
      kind: "cooperative",
      intent: "team",
    })
  ).body.buyer.id as string;
  await ana(`/api/acquire/buyers/${coop}/members`, "POST", { person_id: sam.id, role: "research" });
  await mara(`/api/businesses/${id}/listing`, "PATCH", { mode: "private", invites: [coop] });
  const listing = (await ana("/api/acquire/search", "POST", { buyer_id: coop })).body.results[0]
    .listing_id;
  await ana(`/api/acquire/listings/${listing}/requests`, "POST", {
    buyer_id: coop,
    categories: ["financials"],
    purpose: "Could our co-op keep these classes running?",
    days: 7,
  });
  return { w, mara, theo, ana, sam, id, slug: p.business.slug as string, coop, listing, order };
}

const propose = (m: Caller, businessId: string, buyerId: string, price = 300_000) =>
  m(`/api/businesses/${businessId}/deals`, "POST", {
    buyer_id: buyerId,
    price_cents: price,
    days: 7,
    handover: "Two Saturdays teaching alongside the new owner",
  });

async function closedSale() {
  const s = await juniperForSale();
  const deal = (await propose(s.mara, s.id, s.coop)).body.deal;
  await s.ana(`/api/deals/${deal.id}/test-dollars`, "POST");
  expect((await s.ana(`/api/deals/${deal.id}/fund`, "POST")).status).toBe(200);
  await s.ana(`/api/deals/${deal.id}/accept`, "POST", { digest: deal.digest });
  const closed = await s.mara(`/api/deals/${deal.id}/accept`, "POST", { digest: deal.digest });
  expect(closed.body.deal.status).toBe("closed");
  return { ...s, dealId: deal.id as string, closed: closed.body };
}

describe("agreeing exact terms", () => {
  it("only proposes to a team that asked, and only the parties act", async () => {
    const s = await juniperForSale();
    const owen = await s.w.join("Owen Hart");
    const northline = (
      await owen("/api/acquire/buyers", "POST", {
        name: "Northline",
        kind: "strategic",
        intent: "add",
      })
    ).body.buyer.id;
    expect((await propose(s.mara, s.id, northline)).status).toBe(409);
    const made = await propose(s.mara, s.id, s.coop);
    expect(made.status).toBe(201);
    const deal = made.body;
    expect(deal.deal).toMatchObject({ status: "open", version: 1, price_cents: 300_000 });
    expect(deal.chain.matches_terms).toBe(true);
    expect(deal.terms.buyer).toMatchObject({
      team: "Alder Lane Makers Co-op",
      representative: "Ana Ruiz",
    });
    expect(deal.terms.control[0]).toMatch(/^Owner role on the business's contract/);
    const id = deal.deal.id;
    expect((await s.sam(`/api/deals/${id}`)).body.you).toBe("team");
    expect(
      (await s.sam(`/api/deals/${id}/accept`, "POST", { digest: deal.deal.digest })).status,
    ).toBe(403);
    expect((await owen(`/api/deals/${id}`)).status).toBe(404);
    expect((await s.ana(`/api/deals/${id}/revise`, "POST", { price_cents: 1 })).status).toBe(404);
  });

  it("clears both acceptances when the terms change, and closes once", async () => {
    const s = await juniperForSale();
    const v1 = (await propose(s.mara, s.id, s.coop)).body.deal;
    const poor = await s.ana(`/api/deals/${v1.id}/fund`, "POST");
    expect(poor.status).toBe(409);
    expect(poor.body.error).toMatch(/Get test dollars first/);
    await s.ana(`/api/deals/${v1.id}/test-dollars`, "POST");
    expect((await s.ana(`/api/deals/${v1.id}/fund`, "POST")).body.chain.funded).toBe(true);
    expect(
      (await s.mara(`/api/deals/${v1.id}/accept`, "POST", { digest: v1.digest })).body.chain
        .seller_accepted,
    ).toBe(true);

    const v2 = (
      await s.mara(`/api/deals/${v1.id}/revise`, "POST", {
        price_cents: 280_000,
        days: 7,
        handover: "Two Saturdays teaching alongside the new owner",
      })
    ).body;
    expect(v2.deal.version).toBe(2);
    expect(v2.changes).toContain("Price: $3,000 → $2,800");
    expect(v2.chain).toMatchObject({
      seller_accepted: false,
      buyer_accepted: false,
      funded: false,
    });

    const stale = await s.ana(`/api/deals/${v1.id}/accept`, "POST", { digest: v1.digest });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatch(/aren't the current terms/);
    expect((await s.ana(`/api/deals/${v1.id}/fund`, "POST")).body.error).toMatch(
      /Take your hold back/,
    );
    expect((await s.ana(`/api/deals/${v1.id}/withdraw-hold`, "POST")).status).toBe(200);
    await s.ana(`/api/deals/${v1.id}/fund`, "POST");
    const half = await s.ana(`/api/deals/${v1.id}/accept`, "POST", { digest: v2.deal.digest });
    expect(half.body.deal.status).toBe("open");
    const done = await s.mara(`/api/deals/${v1.id}/accept`, "POST", { digest: v2.deal.digest });
    expect(done.body.deal).toMatchObject({ status: "closed", generation_after: 2 });
    // Accepting again (e.g. a retry after a lost response) reports the closed sale; it does
    // not say the sale failed, and it closes nothing twice (job 003b).
    const again = await s.mara(`/api/deals/${v1.id}/accept`, "POST", { digest: v2.deal.digest });
    expect(again.status).toBe(200);
    expect(again.body.deal).toMatchObject({ status: "closed", generation_after: 2 });
    expect(again.body.steps.filter((x: { kind: string }) => x.kind === "closed")).toHaveLength(1);
    expect(
      s.w.store.db.prepare("SELECT COUNT(*) AS n FROM ownership WHERE deal_id = ?").get(v1.id),
    ).toEqual({ n: 1 });
  });
});

describe("after the close", () => {
  it("hands the business to the buyer while customers keep what they paid for", async () => {
    const s = await juniperForSale();
    // Before: a helper, a private what-if, and customer money held for Theo.
    await s.mara(`/api/businesses/${s.id}/team`, "POST", { person_id: s.sam.id });
    await s.mara(`/api/businesses/${s.id}/value/scenarios`, "POST", {
      name: "Mara's what-if",
      overrides: { founder_hours_week: 2 },
    });
    const deal = (await propose(s.mara, s.id, s.coop)).body.deal;
    await s.ana(`/api/deals/${deal.id}/test-dollars`, "POST");
    await s.ana(`/api/deals/${deal.id}/fund`, "POST");
    await s.mara(`/api/deals/${deal.id}/accept`, "POST", { digest: deal.digest });
    const v = (await s.ana(`/api/deals/${deal.id}/accept`, "POST", { digest: deal.digest })).body;

    expect(v.first_shift.control).toMatchObject({ is_buyer: true, generation: 2, operators: 0 });
    expect(v.first_shift.customer_money).toMatchObject({ in_terms: "$35", now: "$35" });
    expect(v.first_shift.pre_sale_orders).toEqual([
      expect.objectContaining({ order_id: s.order.order_id, customer: "Theo", amount_cents: 3500 }),
    ]);
    expect(v.items.find((i: Json) => i.key === "booking_service").status).toBe("completed");

    // Everstreet follows the contract: Ana runs it; Mara and her helper don't.
    expect((await s.ana(`/api/businesses/${s.id}`)).status).toBe(200);
    expect((await s.mara(`/api/businesses/${s.id}`)).status).toBe(404);
    expect((await s.sam("/api/helping")).body.businesses).toEqual([]);
    // Job 005b: the former helper's direct URL shows ended access, not the business's orders.
    const old = await s.sam(`/api/helping/${s.id}`);
    expect(old.status).toBe(200);
    expect(old.body.access).toBe("ended");
    expect(JSON.stringify(old.body)).not.toContain("Theo");
    expect(old.body.orders ?? null).toBeNull();
    expect((await s.ana(`/api/businesses/${s.id}/value`)).body.scenarios).toEqual([]);
    expect((await s.ana("/api/acquire/search", "POST", { buyer_id: s.coop })).body.results).toEqual(
      [],
    );

    // The new owner serves the customer who paid before the sale.
    const delivered = await s.ana(`/api/payments/${s.order.order_id}/deliver`, "POST");
    expect(delivered.status).toBe(200);

    // The former owner tries a real owner action and the contract refuses.
    const check = (await s.mara(`/api/deals/${deal.id}/former-owner-check`, "POST")).body.check;
    expect(check.refused).toBe(true);
    expect(check.error).toMatch(/E_NOT_OWNER/);
    expect(check.operator_check.authorized).toBe(false);

    const page = (await s.w.anon(`/api/public/businesses/${s.slug}`)).body;
    expect(page.founder.display_name).toBe("Ana Ruiz");
    expect(page.history).toEqual([
      expect.objectContaining({
        from: "Mara Solis",
        to: "Ana Ruiz",
        team: "Alder Lane Makers Co-op",
        generation: 2,
      }),
    ]);
    expect((await s.theo("/api/activity")).body.bookings[0].status).toBe("confirmed");
  });

  it("keeps the seller's proceeds in the contract until claimed, through a failed payout", async () => {
    const s = await closedSale();
    expect(s.closed.proceeds.held_cents).toBe(300_000);
    s.w.chain.failNextPayout = true;
    const failed = (await s.mara(`/api/deals/${s.dealId}/claim`, "POST")).body;
    expect(failed.proceeds).toMatchObject({ held_cents: 300_000, claimed_at: null });
    expect(failed.proceeds.error).toMatch(/kept your proceeds/);
    const before = (await s.mara("/api/wallet")).body.wallet.balance_cents;
    const ok = (await s.mara(`/api/deals/${s.dealId}/claim`, "POST")).body;
    expect(ok.proceeds).toMatchObject({ held_cents: 0, error: null });
    expect((await s.mara("/api/wallet")).body.wallet.balance_cents).toBe(before + 300_000);
  });

  it("voids a competing deal at close and returns its hold", async () => {
    const s = await juniperForSale();
    const owen = await s.w.join("Owen Hart");
    const northline = (
      await owen("/api/acquire/buyers", "POST", {
        name: "Northline",
        kind: "strategic",
        intent: "add",
      })
    ).body.buyer.id;
    await s.mara(`/api/businesses/${s.id}/listing`, "PATCH", { invites: [s.coop, northline] });
    await owen(`/api/acquire/listings/${s.listing}/requests`, "POST", {
      buyer_id: northline,
      categories: ["financials"],
      purpose: "Studios are our customers too",
      days: 7,
    });
    const rival = (await propose(s.mara, s.id, northline, 250_000)).body.deal;
    await owen(`/api/deals/${rival.id}/test-dollars`, "POST");
    await owen(`/api/deals/${rival.id}/fund`, "POST");
    const funded = (await owen("/api/wallet")).body.wallet.balance_cents;

    const deal = (await propose(s.mara, s.id, s.coop)).body.deal;
    await s.ana(`/api/deals/${deal.id}/test-dollars`, "POST");
    await s.ana(`/api/deals/${deal.id}/fund`, "POST");
    await s.ana(`/api/deals/${deal.id}/accept`, "POST", { digest: deal.digest });
    await s.mara(`/api/deals/${deal.id}/accept`, "POST", { digest: deal.digest });

    const lost = (await owen(`/api/deals/${rival.id}`)).body;
    expect(lost.deal.status).toBe("void");
    expect(lost.chain.held_cents).toBe(250_000);
    await owen(`/api/deals/${rival.id}/withdraw-hold`, "POST");
    expect((await owen("/api/wallet")).body.wallet.balance_cents).toBe(funded + 250_000);
  });
});
