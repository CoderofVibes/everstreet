// Job 003f: the operating books. Fictional business, in-memory database, the FakeChain double
// with explicit per-month ledgers and failure injection (token decimals 6: 1 cent = 10,000
// base units). Covers prepay/consume/refund accounting, missing vs zero, partial outages,
// source separation, partial periods, precision, cost validation, closed-history corrections,
// the separate model-spend ledgers, and that buyers see the same scoped metrics.

import { describe, expect, it } from "vitest";
import { addMonths, Books, type Month, revenueOf, unitsToCents } from "../src/books.ts";
import type { Json } from "./deal-world.ts";
import { $, M1, M2, M3, NOW, paidBusiness } from "./finance-world.ts";
import { CLEAN, runtimeWorld, ScriptedRuntime } from "./runtime-world.ts";

describe("what each month's ledger means", () => {
  it("months are read separately: two months, two answers", async () => {
    const b = await paidBusiness();
    b.chain.setPeriod(b.account, M1, { earned: $(100) });
    b.chain.setPeriod(b.account, M2, { earned: $(40) });
    expect((await b.month(M1)).revenue_cents).toBe(10_000);
    expect((await b.month(M2)).revenue_cents).toBe(4_000);
  });

  it("100/20/80: a prepayment is cash in, used credit earns once, withdrawn credit is returned", async () => {
    const b = await paidBusiness();
    b.chain.setPeriod(b.account, M3, { prepaid_in: $(100) });
    // The contract's `earned` already includes used credit; credit_used is never added again.
    b.chain.setPeriod(b.account, M2, { credit_used: $(20), earned: $(20) });
    b.chain.setPeriod(b.account, M1, { credit_withdrawn: $(80) });
    const [m3, m2, m1] = [await b.month(M3), await b.month(M2), await b.month(M1)];
    expect([m3.revenue_cents, m3.cash?.cash_in_cents, m3.cash?.prepaid_in_cents]).toEqual([
      0, 10_000, 10_000,
    ]);
    expect([m2.revenue_cents, m2.cash?.credit_used_cents]).toEqual([2_000, 2_000]);
    expect([m1.revenue_cents, m1.cash?.returned_cents, m1.cash?.credit_withdrawn_cents]).toEqual([
      0, 8_000, 8_000,
    ]);
  });

  it("a refund before delivery is returned money, never subtracted from earned revenue", async () => {
    const b = await paidBusiness();
    b.chain.setPeriod(b.account, M1, { orders_in: $(35), refunds: $(35), earned: "0" });
    const m = await b.month(M1);
    expect([m.revenue_cents, m.cash?.returned_cents, m.cash?.cash_in_cents]).toEqual([
      0, 3_500, 3_500,
    ]);
    expect(m.profit_cents).toBe(0);
  });

  it("owner withdrawals and sale proceeds are never costs, earned revenue or contribution", async () => {
    const b = await paidBusiness();
    b.chain.setPeriod(b.account, M1, {
      earned: $(50),
      owner_withdrawals: $(30),
      sale_proceeds: $(3000),
    });
    const m = await b.month(M1);
    expect([m.revenue_cents, m.direct_cents + m.overhead_cents, m.profit_cents]).toEqual([
      5_000, 0, 5_000,
    ]);
    expect([m.cash?.owner_withdrawals_cents, m.cash?.sale_proceeds_cents]).toEqual([
      3_000, 300_000,
    ]);
  });
});

describe("missing is never zero", () => {
  it("a month that can't be read is unavailable, with no revenue, profit or cash, and says why", async () => {
    const b = await paidBusiness();
    b.chain.setPeriod(b.account, M1, { earned: $(100) });
    b.chain.setPeriod(b.account, M2, { earned: "0" });
    b.chain.failPeriods.add(M1);
    const data = await b.books();
    const m1 = (data.months as Month[]).find((x) => x.yyyymm === M1) as Month;
    expect(m1).toMatchObject({
      chain: "unavailable",
      revenue_cents: null,
      profit_cents: null,
      cash: null,
      revenue_basis: "unknown",
      complete: true,
    });
    expect(m1.chain_reason).toMatch(/could not be read/);
    expect(data.chain_error).toMatch(/could not be read/);
    // An observed zero stays an observed zero.
    const m2 = (data.months as Month[]).find((x) => x.yyyymm === M2) as Month;
    expect([m2.chain, m2.revenue_cents]).toEqual(["observed", 0]);
  });

  it("with no chain connected, an account's months are not connected; before it opened, not applicable", async () => {
    const b = await paidBusiness(2, 15);
    const offline = new Books(b.store.db, b.store, null);
    const { months } = await offline.months(b.id, 4);
    const by = (m: number) => months.find((x) => x.yyyymm === m) as Month;
    expect([by(M3).chain, by(M3).coverage]).toEqual(["not_applicable", "before_start"]);
    expect([by(M2).chain, by(M2).coverage, by(M2).complete]).toEqual([
      "not_connected",
      "first_partial",
      false,
    ]);
    expect([by(M1).chain, by(M1).revenue_cents]).toEqual(["not_connected", null]);
    expect(by(NOW).coverage).toBe("current_partial");
  });

  it("an outage makes no estimate and no snapshot, instead of a drop that never happened", async () => {
    const b = await paidBusiness();
    for (const m of [M3, M2, M1]) b.chain.setPeriod(b.account, m, { earned: $(5000) });
    const snapshots = () =>
      (b.store.db.prepare("SELECT COUNT(*) AS n FROM value_snapshots").get() as { n: number }).n;
    const ok = (await b.mara(`/api/businesses/${b.id}/value`)).body;
    expect(ok.estimate.low_cents).not.toBeNull();
    const before = snapshots();
    b.chain.failPeriods.add(M2);
    const down = (await b.mara(`/api/businesses/${b.id}/value`)).body;
    expect(down.estimate).toMatchObject({ low_cents: null, high_cents: null });
    expect(down.estimate.inputs.stage).toBe("unavailable");
    expect(down.estimate.explanation.join()).toMatch(/not counted as zero/);
    expect(snapshots()).toBe(before);
  });

  it("the public page never shows an unread month or a loss made of costs alone", async () => {
    const b = await paidBusiness();
    b.chain.setPeriod(b.account, M3, { earned: $(500) });
    b.chain.setPeriod(b.account, M2, { earned: "0" });
    await b.mara(`/api/businesses/${b.id}/costs`, "POST", {
      category: "Hosting and compute",
      amount_cents: 2_000,
      yyyymm: M2,
    });
    b.chain.failPeriods.add(M1);
    await b.mara(`/api/businesses/${b.id}/value/settings`, "PATCH", { share_numbers: true });
    const snapshots = () =>
      (b.store.db.prepare("SELECT COUNT(*) AS n FROM value_snapshots").get() as { n: number }).n;
    const before = snapshots();
    const page = (await b.app.request(`/api/public/businesses/${b.slug}`)).json() as Promise<Json>;
    const numbers = (await page).numbers;
    expect(numbers.month.revenue_cents).toBe(50_000);
    expect(numbers.month.profit_cents).toBe(50_000);
    expect(snapshots()).toBe(before); // an anonymous read writes no estimate history
  });
});

describe("periods, sources and precision", () => {
  it("the account's first partial month is never annualized", async () => {
    const b = await paidBusiness(3, 20); // opened on the 20th of M3
    for (const m of [M3, M2, M1]) b.chain.setPeriod(b.account, m, { earned: $(300) });
    const v = (await b.mara(`/api/businesses/${b.id}/value`)).body;
    expect(v.estimate.inputs.months_used).toEqual([M2, M1]);
    expect((await b.month(M3)).coverage).toBe("first_partial");
  });

  it("fictional seeded history is never added to observed months and can't count as verified", async () => {
    const b = await paidBusiness();
    b.chain.setPeriod(b.account, M1, { earned: $(100) });
    b.store.db
      .prepare(
        "INSERT INTO seeded_periods (business_id, yyyymm, revenue_cents, note) VALUES (?, ?, ?, ?)",
      )
      .run(b.id, M1, 50_000, "Example history (fictional)");
    const m = await b.month(M1);
    expect(m).toMatchObject({
      revenue_cents: 10_000,
      revenue_basis: "observed",
      seeded_cents: 50_000,
      mixed: true,
    });
    expect(m.revenue_sources).toEqual(["Verified on NEAR · testnet"]);
    // A buyer filtering for verified revenue doesn't see it as verified.
    await b.mara(`/api/businesses/${b.id}/listing`, "PATCH", { mode: "named" });
    const viewer = await b.join("Ivy Park");
    const r = (await viewer("/api/acquire/search", "POST", { criteria: { verified_only: true } }))
      .body;
    expect(r.results).toHaveLength(0);
  });

  it("exact conversion: sub-cent months add up, huge amounts stay exact or are refused, any decimals", () => {
    const month = (units: string): Month =>
      ({
        revenue_cents: unitsToCents(BigInt(units), 6)?.cents ?? 0,
        revenue_basis: "observed",
        earned_units: units,
      }) as Month;
    // Three months of 0.4¢: each rounds down to 0, but together they are 1.2¢.
    const three = [month("4000"), month("4000"), month("4000")];
    expect(three.map((m) => m.revenue_cents)).toEqual([0, 0, 0]);
    expect(revenueOf(three, 6)).toBe(1);
    const big = 2n ** 60n;
    expect(unitsToCents(big, 6)).toEqual({
      cents: Number((big * 100n) / 1_000_000n),
      subCent: true,
    });
    expect(unitsToCents(10n ** 30n, 6)).toBeNull();
    expect(unitsToCents(5n, 0)).toEqual({ cents: 500, subCent: false });
    expect(unitsToCents(5n, 1)).toEqual({ cents: 50, subCent: false });
  });

  it("an amount too large to show exactly makes that month unavailable, not wrong", async () => {
    const b = await paidBusiness();
    b.chain.setPeriod(b.account, M1, { earned: String(10n ** 30n) });
    const m = await b.month(M1);
    expect([m.chain, m.revenue_cents]).toEqual(["unavailable", null]);
    expect(m.chain_reason).toMatch(/too large to show exactly/);
  });
});

describe("costs", () => {
  it("accepts only real past or current months and bounded amounts", async () => {
    const b = await paidBusiness();
    const add = (yyyymm: number, amount_cents = 1_000) =>
      b.mara(`/api/businesses/${b.id}/costs`, "POST", {
        category: "AI model usage",
        amount_cents,
        yyyymm,
      });
    for (const bad of [202513, 202500, 199912, addMonths(NOW, 1)])
      expect([bad, (await add(bad)).status]).toEqual([bad, 400]);
    expect((await add(M1, 100_000_001)).status).toBe(400);
    expect((await add(M1, 12.5)).status).toBe(400);
    expect((await add(M1)).status).toBe(201);
  });

  it("removing a cost never rewrites a closed month; it is marked as a correction", async () => {
    const b = await paidBusiness();
    const one = (
      await b.mara(`/api/businesses/${b.id}/costs`, "POST", {
        category: "Online services and APIs",
        amount_cents: 4_200,
        yyyymm: M1,
        note: "Email API",
      })
    ).body.costs[0];
    expect((await b.month(M1)).direct_cents).toBe(4_200);
    await b.mara(`/api/businesses/${b.id}/costs/${one.id}?note=Entered twice`, "DELETE");
    const row = b.store.db.prepare("SELECT * FROM costs WHERE id = ?").get(one.id) as Json;
    expect(row).toMatchObject({ amount_cents: 4_200, void_note: "Entered twice" });
    expect(row.voided_at).toBeTruthy();
    expect((await b.month(M1)).direct_cents).toBe(0);
    // A cost only in the current (open) month can simply be removed.
    const cur = (
      await b.mara(`/api/businesses/${b.id}/costs`, "POST", {
        category: "Hosting and compute",
        amount_cents: 900,
        yyyymm: NOW,
      })
    ).body.costs[0];
    await b.mara(`/api/businesses/${b.id}/costs/${cur.id}`, "DELETE");
    expect(b.store.db.prepare("SELECT 1 FROM costs WHERE id = ?").get(cur.id)).toBeUndefined();
  });

  it("digital categories lead", async () => {
    const b = await paidBusiness();
    const cats = (await b.books()).categories.map((c: Json) => c.category);
    expect(cats.slice(0, 3)).toEqual([
      "AI model usage",
      "Hosting and compute",
      "Online services and APIs",
    ]);
  });
});

describe("balances, spend and evidence", () => {
  it("today's balances are a current stock with buyer escrow and proceeds apart; unreadable is null", async () => {
    const b = await paidBusiness();
    const now = (await b.books()).now;
    expect(now).toMatchObject({
      state: "observed",
      buyer_escrow_cents: 0,
      seller_proceeds_cents: 0,
    });
    b.chain.treasury = async () => {
      throw new Error("RPC down");
    };
    expect((await b.books()).now).toMatchObject({ state: "unavailable" });
    const money = (await b.mara(`/api/businesses/${b.id}/money`)).body;
    expect([money.treasury, money.treasury_state]).toEqual([null, "unavailable"]);
  });

  it("model spend comes from the platform's own ledgers, exact, with runtime and build apart", async () => {
    const w = runtimeWorld(new ScriptedRuntime());
    const f = await w.founder();
    await f.ava(`/api/product-projects/${f.project}/runtime/invocations`, "POST", {
      idempotency_key: "books-trial-01",
      artifact_job: f.job,
      text: `FICTIONAL EXAMPLE\nINVOICE ${CLEAN.invoice_number}`,
    });
    const spend = (await f.ava(`/api/businesses/${f.business}/books`)).body.spend;
    expect(spend.unit).toBe("USD");
    expect(spend.runtime.total_microcents).toBe(150_000); // 900 × 100 + 120 × 500
    expect(spend.build.total_microcents).toBeGreaterThan(0);
    expect(spend.runtime.months[0]).toMatchObject({
      yyyymm: NOW,
      requests: 1,
      unknown_cost_requests: 0,
    });
    expect(spend.basis).toMatch(/not an invoice/i);
  });

  it("a buyer with financials access sees the same metrics and states, without cost lines", async () => {
    const b = await paidBusiness();
    b.chain.setPeriod(b.account, M2, { earned: $(100) });
    b.chain.failPeriods.add(M1);
    const ana = await b.join("Ana Ruiz");
    const coop = (
      await ana("/api/acquire/buyers", "POST", {
        name: "Northline Studio Tools",
        kind: "strategic",
        intent: "add",
      })
    ).body.buyer.id;
    await b.mara(`/api/businesses/${b.id}/listing`, "PATCH", { mode: "private", invites: [coop] });
    const listing = (await ana("/api/acquire/search", "POST", { buyer_id: coop })).body.results[0]
      .listing_id;
    const req = (
      await ana(`/api/acquire/listings/${listing}/requests`, "POST", {
        buyer_id: coop,
        categories: ["financials"],
        purpose: "Could we run this alongside our tools?",
        days: 7,
      })
    ).body.request.id;
    await b.mara(`/api/acquire/requests/${req}/decide`, "POST", { action: "grant" });
    const room = (await ana(`/api/acquire/rooms/${req}`)).body;
    const owner = (await b.books()).months as Month[];
    const theirs = room.financials.months as Json[];
    const m1 = theirs.find((m) => m.yyyymm === M1) as Json;
    expect(m1).toMatchObject({ chain: "unavailable", revenue_cents: null, profit_cents: null });
    expect(theirs.find((m) => m.yyyymm === M2)?.revenue_cents).toBe(
      owner.find((m) => m.yyyymm === M2)?.revenue_cents,
    );
    expect("lines" in m1).toBe(false);
    expect(room.financials.basis).toMatch(/test dollars/);
    // Ending the grant ends the reads.
    await b.mara(`/api/acquire/requests/${req}/revoke`, "POST");
    expect((await ana(`/api/acquire/rooms/${req}`)).status).toBe(403);
  });
});
