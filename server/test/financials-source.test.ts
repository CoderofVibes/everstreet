// Job 003f2: a month's revenue source follows how its revenue is known. An observed zero keeps
// its observation source; founder-entered costs keep theirs separately; unavailable,
// before-opening and fictional months never gain an observation badge. Fictional business,
// in-memory database, FakeChain double (its "observed" is the double's read, not testnet).

import { describe, expect, it } from "vitest";
import type { Month } from "../src/books.ts";
import type { Json } from "./deal-world.ts";
import { $, M1, M2, M3, M4, NOW, paidBusiness } from "./finance-world.ts";

const OBSERVED = "Verified on NEAR · testnet";
const SEEDED = "Seeded history · fictional";
const FOUNDER = "Founder supplied";

/** Opened two months ago: M4 and M3 are before opening, M2 observed zero, M1 observed revenue. */
async function fixture() {
  const b = await paidBusiness(2);
  b.chain.setPeriod(b.account, M1, { earned: $(120) });
  // M2: nothing earned on the ledger, but a founder-entered cost.
  await b.mara(`/api/businesses/${b.id}/costs`, "POST", {
    category: "Hosting and compute",
    amount_cents: 4_000,
    recurring: false,
    yyyymm: M2,
  });
  // M4: fictional example history before opening.
  b.store.db
    .prepare(
      "INSERT INTO seeded_periods (business_id, yyyymm, revenue_cents, note) VALUES (?, ?, ?, ?)",
    )
    .run(b.id, M4, 30_000, "Example history (fictional)");
  return b;
}

const by = (months: Json[] | Month[], m: number) =>
  (months as Json[]).find((x) => x.yyyymm === m) as Json;

describe("003f2 revenue source of each month", () => {
  it("an observed zero keeps the observation source; costs keep theirs", async () => {
    const b = await fixture();
    const months = (await b.books()).months as Month[];
    const zero = by(months, M2);
    expect(zero).toMatchObject({ revenue_cents: 0, revenue_basis: "observed", chain: "observed" });
    expect(zero.revenue_sources).toEqual([OBSERVED]);
    expect(zero.cost_sources).toEqual([FOUNDER]);
    // No invented revenue line for the zero; the provenance is the month's, not a line's.
    expect((zero.lines as Json[]).filter((l) => l.kind === "revenue")).toEqual([]);
    expect(by(months, M1).revenue_sources).toEqual([OBSERVED]);
    expect(by(months, M1).cost_sources).toEqual([]);
  });

  it("unavailable, before-opening and fictional months gain no observation badge", async () => {
    const b = await fixture();
    b.chain.failPeriods.add(M2);
    const months = (await b.books()).months as Month[];
    const down = by(months, M2);
    expect(down).toMatchObject({
      chain: "unavailable",
      revenue_cents: null,
      revenue_basis: "unknown",
    });
    expect(down.revenue_sources).toEqual([]);
    expect(down.cost_sources).toEqual([FOUNDER]);
    const before = by(months, M3);
    expect(before).toMatchObject({ coverage: "before_start", revenue_basis: "none" });
    expect(before.revenue_sources).toEqual([]);
    const seeded = by(months, M4);
    expect(seeded).toMatchObject({ revenue_basis: "seeded", revenue_cents: 30_000 });
    expect(seeded.revenue_sources).toEqual([SEEDED]);
    expect(months.filter((m) => m.revenue_sources.includes(OBSERVED)).map((m) => m.yyyymm)).toEqual(
      months.filter((m) => m.revenue_basis === "observed").map((m) => m.yyyymm),
    );
  });

  it("the same provenance reaches a buyer's evidence room", async () => {
    const b = await fixture();
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
    const room = (await ana(`/api/acquire/rooms/${req}`)).body.financials;
    const months = room.months as Json[];
    expect(by(months, M2)).toMatchObject({ revenue_cents: 0, revenue_sources: [OBSERVED] });
    expect(by(months, M2).cost_sources).toEqual([FOUNDER]);
    expect(by(months, M3).revenue_sources).toEqual([]);
    expect(by(months, M4).revenue_sources).toEqual([SEEDED]);
    // The current partial month is observed too (nothing set: a zero read).
    expect(by(months, NOW).revenue_sources).toEqual([OBSERVED]);
  });
});
