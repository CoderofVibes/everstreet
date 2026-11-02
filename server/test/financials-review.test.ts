// Job 003f1: Astra's five independently reproduced financial defects as regressions through the
// actual API, with controls, plus the source-reviewed precision, disclosure and scope issues.
// Fictional business, in-memory database, FakeChain double with held and failing reads.

import { describe, expect, it } from "vitest";
import type { Month } from "../src/books.ts";
import { gate, type Json } from "./deal-world.ts";
import { $, M1, M2, M3, M4, paidBusiness } from "./finance-world.ts";

type B = Awaited<ReturnType<typeof paidBusiness>>;

/** Starts `call`, holds it inside its monthly reads, runs `change`, then lets it finish. */
async function held<T>(b: B, call: () => Promise<T>, change: () => void) {
  const g = gate();
  b.chain.periodEntered = gate();
  b.chain.periodGate = g.opened;
  const pending = call();
  await b.chain.periodEntered.opened;
  change();
  b.chain.periodGate = null;
  g.open();
  return pending;
}

const rows = (b: B, sql: string, ...a: string[]) =>
  (b.store.db.prepare(sql).get(...a) as { n: number }).n;

describe("1. an ended monthly cost stays ended", () => {
  it("ending it again can't move the end date and reopen closed months", async () => {
    const b = await paidBusiness(6);
    const cost = (
      await b.mara(`/api/businesses/${b.id}/costs`, "POST", {
        category: "Hosting and compute",
        amount_cents: 25_000,
        recurring: true,
        yyyymm: M4,
      })
    ).body.costs[0];
    await b.mara(`/api/businesses/${b.id}/costs/${cost.id}`, "DELETE");
    // As if it had been ended two months ago (M3), before this month.
    b.store.db.prepare("UPDATE costs SET until_yyyymm = ? WHERE id = ?").run(M3, cost.id);
    expect((await b.month(M2)).direct_cents).toBe(0);
    const again = await b.mara(`/api/businesses/${b.id}/costs/${cost.id}`, "DELETE");
    expect(again.status).toBe(200);
    const row = b.store.db
      .prepare("SELECT until_yyyymm FROM costs WHERE id = ?")
      .get(cost.id) as Json;
    expect(row.until_yyyymm).toBe(M3);
    expect([(await b.month(M2)).direct_cents, (await b.month(M1)).direct_cents]).toEqual([0, 0]);
    expect((await b.month(M3)).direct_cents).toBe(25_000);
    // Each real end or correction is its own audit event.
    expect(
      rows(
        b,
        "SELECT COUNT(*) AS n FROM events WHERE type = 'cost.ended' AND subject = ?",
        cost.id,
      ),
    ).toBe(1);
  });
});

describe("2. months before opening aren't a zero baseline", () => {
  it("before the account opened, a month without records isn't a whole month to compare", async () => {
    const b = await paidBusiness(2, 15); // opened on the 15th of M2
    b.chain.setPeriod(b.account, M1, { earned: $(100) });
    const months = (await b.books()).months as Month[];
    const by = (m: number) => months.find((x) => x.yyyymm === m) as Month;
    expect([by(M3).coverage, by(M3).complete]).toEqual(["before_start", false]);
    expect([by(M2).coverage, by(M2).complete]).toEqual(["first_partial", false]);
    expect(by(M1).complete).toBe(true);
    expect(months.filter((m) => m.complete).map((m) => m.yyyymm)).toEqual([M1]);
  });

  it("control: seeded history before opening is still a whole (fictional) month", async () => {
    const b = await paidBusiness(1, 1);
    b.store.db
      .prepare(
        "INSERT INTO seeded_periods (business_id, yyyymm, revenue_cents, note) VALUES (?, ?, ?, ?)",
      )
      .run(b.id, M3, 40_000, "Example history (fictional)");
    const m3 = (await b.month(M3)) as Month;
    expect([m3.coverage, m3.complete, m3.revenue_basis]).toEqual(["before_start", true, "seeded"]);
  });
});

describe("3. an outage is unknown history, not no history", () => {
  async function listed() {
    const b = await paidBusiness(5);
    for (const m of [M3, M2, M1]) b.chain.setPeriod(b.account, m, { earned: $(5000) });
    await b.mara(`/api/businesses/${b.id}/listing`, "PATCH", { mode: "named" });
    const viewer = await b.join("Ivy Park");
    const search = (criteria: Json) =>
      viewer("/api/acquire/search", "POST", { criteria }).then((r) => r.body);
    return { b, search };
  }

  it("control: with readable books the listing matches min_months and shows its history", async () => {
    const { search } = await listed();
    const r = await search({ min_months: 1 });
    expect(r.results).toHaveLength(1);
    expect(r.results[0].history.months).toBe(3);
  });

  it("with a month unreadable it stays listed, labelled unknown, never 'no history'", async () => {
    const { b, search } = await listed();
    b.chain.failPeriods.add(M2);
    const r = await search({ min_months: 1 });
    expect(r.results).toHaveLength(1);
    const v = r.results[0];
    expect(v.unknowns.join()).toMatch(/History couldn't be read right now/);
    expect(v.history).toMatchObject({ status: "unknown", months: null, verified: null });
    expect(v.history.text).toMatch(/Unknown right now/);
    expect(v.revenue.text).toMatch(/Unknown right now/);
    expect(JSON.stringify(v)).not.toMatch(/No complete month/);
    // Verification can't come from missing records: set aside, and said why.
    const ver = await search({ verified_only: true });
    expect(ver.results).toHaveLength(0);
    expect(ver.hidden.map((h: Json) => h.text).join()).toMatch(
      /couldn't be read right now.*verified filter/,
    );
  });
});

describe("4. no late private answer after control changes", () => {
  it("money: a former owner gets nothing once the read finishes", async () => {
    const b = await paidBusiness();
    const ana = await b.join("Ana Ruiz");
    const r = await held(
      b,
      () => b.mara(`/api/businesses/${b.id}/money`),
      () => b.transfer(b.mara.id, ana.id),
    );
    expect(r.status).toBe(404);
    expect(r.body.treasury).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toMatch(/orders/);
  });

  it("money: owner away and back during the read also gets nothing", async () => {
    const b = await paidBusiness();
    const ana = await b.join("Ana Ruiz");
    const r = await held(
      b,
      () => b.mara(`/api/businesses/${b.id}/money`),
      () => {
        b.transfer(b.mara.id, ana.id);
        b.transfer(ana.id, b.mara.id);
      },
    );
    expect(r.status).toBe(409);
    expect(r.body.treasury).toBeUndefined();
  });

  it("control: with no change the money view is returned", async () => {
    const b = await paidBusiness();
    const r = await held(
      b,
      () => b.mara(`/api/businesses/${b.id}/money`),
      () => undefined,
    );
    expect([r.status, r.body.treasury_state]).toEqual([200, "observed"]);
  });

  it("books and value: same fence", async () => {
    const b = await paidBusiness();
    const ana = await b.join("Ana Ruiz");
    const books = await held(
      b,
      () => b.books(),
      () => b.transfer(b.mara.id, ana.id),
    );
    expect(books.months).toBeUndefined();
  });
});

describe("5. a denied scenario save writes nothing", () => {
  const save = (b: B) =>
    b.mara(`/api/businesses/${b.id}/value/scenarios`, "POST", {
      name: "Hire a helper",
      overrides: { extra_monthly_costs_cents: 50_000 },
    });
  const saved = (b: B) =>
    rows(b, "SELECT COUNT(*) AS n FROM value_scenarios WHERE business_id = ?", b.id);

  it("former owner: 404 and no row", async () => {
    const b = await paidBusiness();
    const ana = await b.join("Ana Ruiz");
    const r = await held(
      b,
      () => save(b),
      () => b.transfer(b.mara.id, ana.id),
    );
    expect([r.status, saved(b)]).toEqual([404, 0]);
  });

  it("owner away and back: 409 and no row", async () => {
    const b = await paidBusiness();
    const ana = await b.join("Ana Ruiz");
    const r = await held(
      b,
      () => save(b),
      () => {
        b.transfer(b.mara.id, ana.id);
        b.transfer(ana.id, b.mara.id);
      },
    );
    expect([r.status, saved(b)]).toEqual([409, 0]);
  });

  it("control: unchanged control saves exactly one row", async () => {
    const b = await paidBusiness();
    const r = await held(
      b,
      () => save(b),
      () => undefined,
    );
    expect([r.status, saved(b)]).toEqual([201, 1]);
  });
});

describe("disclosure and scope rechecked after the reads", () => {
  it("public numbers turned off while the page was being read show nothing", async () => {
    const b = await paidBusiness();
    b.chain.setPeriod(b.account, M1, { earned: $(500) });
    await b.mara(`/api/businesses/${b.id}/value/settings`, "PATCH", { share_numbers: true });
    const r = await held(
      b,
      async () => (await (await b.app.request(`/api/public/businesses/${b.slug}`)).json()) as Json,
      () =>
        b.store.db
          .prepare("UPDATE value_settings SET share_numbers = 0 WHERE business_id = ?")
          .run(b.id),
    );
    expect(r.numbers).toBeNull();
  });

  it("a listing made anonymous during a search shows its anonymous form", async () => {
    const b = await paidBusiness();
    await b.mara(`/api/businesses/${b.id}/listing`, "PATCH", { mode: "named" });
    const viewer = await b.join("Ivy Park");
    const r = await held(
      b,
      () => viewer("/api/acquire/search", "POST", { criteria: {} }),
      () =>
        b.store.db
          .prepare("UPDATE listings SET mode = 'anonymous' WHERE business_id = ?")
          .run(b.id),
    );
    expect(r.body.results[0].title).not.toMatch(/Ledgerline/);
    expect(r.body.results[0].mode).toBe("anonymous");
  });

  it("a grant made under earlier wording doesn't gain money-in/out detail; a new grant does", async () => {
    const b = await paidBusiness();
    b.chain.setPeriod(b.account, M1, { earned: $(100), owner_withdrawals: $(30) });
    const ana = await b.join("Ana Ruiz");
    const team = (
      await ana("/api/acquire/buyers", "POST", {
        name: "Northline Studio Tools",
        kind: "strategic",
        intent: "add",
      })
    ).body.buyer.id;
    await b.mara(`/api/businesses/${b.id}/listing`, "PATCH", { mode: "private", invites: [team] });
    const listing = (await ana("/api/acquire/search", "POST", { buyer_id: team })).body.results[0]
      .listing_id;
    const req = (
      await ana(`/api/acquire/listings/${listing}/requests`, "POST", {
        buyer_id: team,
        categories: ["financials"],
        purpose: "Could we run this alongside our tools?",
        days: 7,
      })
    ).body.request.id;
    await b.mara(`/api/acquire/requests/${req}/decide`, "POST", { action: "grant" });
    const fresh = (await ana(`/api/acquire/rooms/${req}`)).body.financials;
    const m1 = (fresh.months as Json[]).find((m) => m.yyyymm === M1) as Json;
    expect([fresh.cash_included, m1.cash.owner_withdrawals_cents]).toEqual([true, 3_000]);
    b.store.db.prepare("UPDATE access_requests SET scope_version = 2 WHERE id = ?").run(req);
    const older = (await ana(`/api/acquire/rooms/${req}`)).body.financials;
    expect(older.cash_included).toBe(false);
    expect((older.months as Json[]).every((m) => m.cash === null)).toBe(true);
    expect(older.cash_note).toMatch(/earlier wording/);
    // Zero months stay in the evidence, and the reproduction uses the owner's exact totals.
    expect((older.months as Json[]).some((m) => m.revenue_cents === 0)).toBe(true);
    const v = (await b.mara(`/api/businesses/${b.id}/value`)).body;
    expect(older.reproduce.revenue_cents).toBe(v.estimate.inputs.revenue_cents);
  });
});

describe("precision and bounds", () => {
  it("a total too large to compute exactly makes no estimate instead of 0", async () => {
    const b = await paidBusiness();
    // Each month is representable; together they exceed the safe range.
    const huge = String(4_000_000_000_000_000n * 10_000n);
    for (const m of [M3, M2, M1]) b.chain.setPeriod(b.account, m, { earned: huge });
    const v = (await b.mara(`/api/businesses/${b.id}/value`)).body;
    expect(v.estimate.inputs.stage).toBe("unavailable");
    expect(v.estimate.low_cents).toBeNull();
  });

  it("model spend separates the selected period from all time", async () => {
    const b = await paidBusiness();
    const spend = (await b.books("?months=3")).spend;
    for (const l of [spend.runtime, spend.build])
      expect(Object.keys(l)).toEqual(
        expect.arrayContaining([
          "period_microcents",
          "period_unknown_cost_requests",
          "total_microcents",
          "unknown_cost_requests",
        ]),
      );
  });
});
