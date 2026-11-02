// Phase 4: the books, the Everstreet valuation estimate, "what changed", private scenarios,
// numbers private until shared, and one scoped delegation enforced by the contract.

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TestDoubleAuthority } from "../../services/openseat/src/authority.ts";
import { openSeatApp } from "../../services/openseat/src/http.ts";
import { OpenSeat } from "../../services/openseat/src/service.ts";
import { everstreetApi } from "../src/app.ts";
import { openSeatProvider } from "../src/bookings.ts";
import { addMonths, ym } from "../src/books.ts";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";
import { estimate, type Inputs } from "../src/value.ts";
import { FakeChain } from "./fake-chain.ts";

// biome-ignore lint/suspicious/noExplicitAny: tests read deep response fields
type Json = Record<string, any>;

const paperfin: Inputs = {
  model: "scenario-v1",
  stage: "operating",
  months_used: [202608, 202609, 202610],
  revenue_cents: 3_600_000,
  costs_cents: 1_350_000,
  direct_cents: 1_080_000,
  overhead_cents: 270_000,
  labor_month_cents: 100_000,
  founder_hours_week: 20 * (12 / 52),
  hourly_rate_cents: 5000,
  labor_is_default: false,
  multiple_low: 2,
  multiple_high: 3,
  multiples_are_default: false,
  annualize_by: 4,
  plan_customers_month: null,
  price_cents: 1,
  revenue_sources: ["Seeded history · fictional"],
  cost_sources: ["Seeded history · fictional"],
};

describe("the valuation estimate", () => {
  it("reproduces Astra's worked example exactly", () => {
    const e = estimate(paperfin);
    expect(e.normalized_annual_cents).toBe(7_800_000);
    expect([e.low_cents, e.high_cents]).toEqual([15_600_000, 23_400_000]);
    expect(e.label).toBe("Estimate · scenario model · 3 complete months annualized");
  });

  it("moves for an understandable reason", () => {
    const e = estimate({ ...paperfin, labor_month_cents: 200_000 });
    expect([e.low_cents, e.high_cents]).toEqual([13_200_000, 19_800_000]);
  });

  it("gives no range when the business does not earn more than it costs", () => {
    const e = estimate({ ...paperfin, revenue_cents: 1_000_000 });
    expect([e.low_cents, e.high_cents]).toEqual([null, null]);
  });
});

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
  return { store, chain, join, anon: as("") };
}

async function business(w: ReturnType<typeof world>, family = "class") {
  const mara = await w.join("Mara Solis");
  const p = (
    await mara("/api/projects", "POST", { route: "started", name: "Juniper Print Studio" })
  ).body;
  await mara(`/api/projects/${p.id}/answers`, "PATCH", {
    audience: "Adults",
    outcome: "Three prints",
    deliverable: "90 minutes",
    price: "$35",
    when: "Saturdays",
    where: "Alder Lane",
    capacity: "6",
    confirmed: true,
  });
  await mara(`/api/businesses/${p.business.id}`, "PATCH", { family });
  await mara(`/api/businesses/${p.business.id}/publish`, "POST");
  return { mara, id: p.business.id as string, slug: p.business.slug as string };
}

function seedHistory(
  w: ReturnType<typeof world>,
  businessId: string,
  months: number,
  revenue: number,
  cost: number,
) {
  for (let i = months; i >= 1; i--) {
    const m = addMonths(ym(), -i);
    w.store.db
      .prepare(
        "INSERT INTO seeded_periods (business_id, yyyymm, revenue_cents, note) VALUES (?, ?, ?, 'Class tickets')",
      )
      .run(businessId, m, revenue);
    w.store.db
      .prepare(
        "INSERT INTO costs (id, business_id, yyyymm, category, kind, amount_cents, recurring, note, origin, created_at) VALUES (?, ?, ?, 'Materials', 'direct', ?, 0, '', 'seeded', ?)",
      )
      .run(randomUUID(), businessId, m, cost, new Date().toISOString());
  }
}

describe("books and value for a business", () => {
  it("starts as a value plan, not a valuation", async () => {
    const w = world();
    const b = await business(w);
    const v = (await b.mara(`/api/businesses/${b.id}/value`)).body;
    expect(v.estimate.inputs.stage).toBe("plan");
    expect(v.estimate.label).toMatch(/Value plan/);
    expect(v.estimate.inputs.revenue_cents).toBe(20 * 3500 * 12);
    expect(v.estimate.missing.join(" ")).toMatch(/Your own work uses a default/);
  });

  it("uses the last three complete months and says exactly what changed", async () => {
    const w = world();
    const b = await business(w);
    seedHistory(w, b.id, 4, 140_000, 20_000);
    const first = (await b.mara(`/api/businesses/${b.id}/value`)).body;
    expect(first.estimate.inputs).toMatchObject({
      stage: "operating",
      revenue_cents: 420_000,
      costs_cents: 60_000,
      annualize_by: 4,
    });
    expect(first.estimate.inputs.revenue_sources).toEqual(["Seeded history · fictional"]);

    await b.mara(`/api/businesses/${b.id}/costs`, "POST", {
      category: "Space or venue",
      amount_cents: 15_000,
      recurring: true,
      yyyymm: addMonths(ym(), -3),
      note: "Saturday room",
    });
    await b.mara(`/api/businesses/${b.id}/value/settings`, "PATCH", {
      founder_hours_week: 4,
      hourly_rate_cents: 3000,
    });
    const second = (await b.mara(`/api/businesses/${b.id}/value`)).body;
    expect(second.estimate.inputs.costs_cents).toBe(60_000 + 3 * 15_000);
    expect(second.estimate.inputs.cost_sources.sort()).toEqual([
      "Founder supplied",
      "Seeded history · fictional",
    ]);
    expect(second.what_changed.changes.some((c: string) => c.startsWith("Costs:"))).toBe(true);
    expect(
      second.what_changed.changes.some((c: string) => c.startsWith("Your own work per month")),
    ).toBe(true);

    const books = (await b.mara(`/api/businesses/${b.id}/books`)).body;
    const last = books.months.filter((m: Json) => m.complete).at(-1);
    expect(last).toMatchObject({
      revenue_cents: 140_000,
      direct_cents: 35_000,
      profit_cents: 105_000,
    });
  });

  it("keeps a what-if private and leaves the estimate alone", async () => {
    const w = world();
    const b = await business(w);
    seedHistory(w, b.id, 3, 140_000, 20_000);
    const before = (await b.mara(`/api/businesses/${b.id}/value`)).body.estimate;
    const t = (
      await b.mara(`/api/businesses/${b.id}/value/try`, "POST", { extra_customers_month: 5 })
    ).body;
    expect(t.scenario.inputs.revenue_cents).toBe(before.inputs.revenue_cents + 5 * 3500 * 3);
    await b.mara(`/api/businesses/${b.id}/value/scenarios`, "POST", {
      name: "Five more a month",
      overrides: { extra_customers_month: 5 },
    });
    const after = (await b.mara(`/api/businesses/${b.id}/value`)).body;
    expect(after.estimate.low_cents).toBe(before.low_cents);
    expect(after.scenarios[0].name).toBe("Five more a month");
    const sam = await w.join("Sam Lee");
    expect((await sam(`/api/businesses/${b.id}/value`)).status).toBe(404);
  });

  it("shows numbers on the public page only when the founder shares them", async () => {
    const w = world();
    const b = await business(w);
    seedHistory(w, b.id, 3, 140_000, 20_000);
    expect((await w.anon(`/api/public/businesses/${b.slug}`)).body.numbers).toBeNull();
    await b.mara(`/api/businesses/${b.id}/value/settings`, "PATCH", { share_numbers: true });
    const n = (await w.anon(`/api/public/businesses/${b.slug}`)).body.numbers;
    expect(n.month).toMatchObject({
      revenue_cents: 140_000,
      direct_cents: 20_000,
      profit_cents: 120_000,
    });
    expect(n.value.label).toMatch(/^Estimate/);
  });
});

describe("one scoped delegation", () => {
  it("lets a helper deliver and answer until the owner revokes them on the contract", async () => {
    const w = world();
    const b = await business(w);
    await b.mara(`/api/businesses/${b.id}/payments/activate`, "POST", { refund_hours: 0 });
    await b.mara(`/api/businesses/${b.id}/sessions`, "POST", {
      starts_at: new Date(Date.now() + 864e5 * 3).toISOString(),
      capacity: 4,
    });
    const session = (await w.anon(`/api/public/businesses/${b.slug}`)).body.sessions[0].id;
    const sam = await w.join("Sam Lee");
    const paid = (await sam(`/api/public/sessions/${session}/pay`, "POST")).body;
    await sam(`/api/public/businesses/${b.slug}/inquiries`, "POST", {
      kind: "question",
      message: "What should I bring?",
      share_contact: false,
    });

    const ellis = await w.join("Ellis Grant");
    expect((await ellis(`/api/payments/${paid.order_id}/deliver`, "POST")).status).toBe(404);
    const team = (await b.mara(`/api/businesses/${b.id}/team`, "POST", { person_id: ellis.id }))
      .body.team;
    expect(team[0]).toMatchObject({
      name: "Ellis Grant",
      active: true,
      capabilities: ["support", "fulfillment"],
    });
    expect((await ellis("/api/helping")).body.businesses[0].name).toBe("Juniper Print Studio");

    const desk = (await ellis(`/api/helping/${b.id}`)).body;
    expect(desk.chain_check.authorized).toBe(true);
    const inquiry = desk.inquiries[0].id;
    expect(
      (
        await ellis(`/api/helping/${b.id}/inquiries/${inquiry}/reply`, "POST", {
          text: "Just yourself!",
        })
      ).status,
    ).toBe(200);
    expect((await ellis(`/api/payments/${paid.order_id}/deliver`, "POST")).status).toBe(200);
    expect(w.chain.businesses.values().next().value?.orders.get(paid.order_id)?.status).toBe(
      "Delivered",
    );

    await b.mara(`/api/businesses/${b.id}/team/${ellis.id}`, "DELETE");
    const paid2 = (await (await w.join("Ana Ruiz"))(`/api/public/sessions/${session}/pay`, "POST"))
      .body;
    // Everstreet's record says revoked; even with a stale record, the contract would refuse.
    w.store.db.prepare("UPDATE team SET revoked_at = NULL").run();
    const refused = await ellis(`/api/payments/${paid2.order_id}/deliver`, "POST");
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatch(/contract refused/);
    const replyRefused = await ellis(`/api/helping/${b.id}/inquiries/${inquiry}/reply`, "POST", {
      text: "again",
    });
    expect(replyRefused.status).toBe(403);
  });
});
