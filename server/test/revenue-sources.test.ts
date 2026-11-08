// Revenue a seller paid to their own business (server/src/revenueSources.ts): earned revenue split
// into independent customers and customers linked to the seller's side, each with its reason; a
// customer whose registration payer couldn't be read is never counted as independent.

import { describe, expect, it } from "vitest";
import { registrationPayers, revenueSources } from "../src/revenueSources.ts";
import { CUSTOMER } from "./customer-world.ts";
import { SELLER, saleWorld } from "./sale-world.ts";

const side = (
  accounts: [string, string][],
  owner: string | null = "p-owner",
  team: string[] = [],
) => ({
  accounts: new Map(accounts) as never,
  ownerPerson: owner,
  teamPersons: new Set(team),
});

describe("revenue by source (the classification)", () => {
  it("splits uses by customer and names each link", () => {
    const uses = [
      { customer_account: "ana.near", person_id: "p-ana" },
      { customer_account: "ana.near", person_id: "p-ana" },
      { customer_account: "own.near", person_id: "p-x" },
      { customer_account: "op.near", person_id: "p-y" },
      { customer_account: "alt.near", person_id: "p-owner" },
      { customer_account: "mate.near", person_id: "p-team" },
      { customer_account: "sponsored.near", person_id: "p-z" },
    ];
    const payers = new Map<string, string | null>([
      ["ana.near", "ana.near"],
      ["own.near", "own.near"],
      ["op.near", "op.near"],
      ["alt.near", "alt.near"],
      ["mate.near", "mate.near"],
      ["sponsored.near", "own.near"],
    ]);
    const r = revenueSources(
      uses,
      10n,
      side(
        [
          ["own.near", "owner_account"],
          ["op.near", "operator"],
        ],
        "p-owner",
        ["p-team"],
      ),
      payers,
    );
    expect(r.independent).toEqual({ customers: 1, uses: 2, revenue: "20" });
    expect(r.linked).toMatchObject({ customers: 5, uses: 5, revenue: "50" });
    // Named only for links readable on chain; a link only in Everstreet's records is unnamed.
    const named = Object.fromEntries(
      r.linked.accounts.filter((x) => x.account).map((x) => [x.account, x.reasons]),
    );
    expect(named).toEqual({
      "own.near": ["owner_account"],
      "op.near": ["operator"],
      "sponsored.near": ["registration_paid_by_seller"],
    });
    const unnamed = r.linked.accounts.filter((x) => x.account === null).map((x) => x.reasons);
    expect(unnamed.sort()).toEqual([["owner_here"], ["team_here"]]);
    expect(JSON.stringify(r)).not.toContain("alt.near");
    expect(JSON.stringify(r)).not.toContain("mate.near");
    expect(r.unchecked.customers).toBe(0);
    expect(r.not_checked).toEqual(["funding_through_other_accounts", "recruited_third_parties"]);
  });

  it("a customer whose registration payer wasn't read is unchecked, not independent", () => {
    const r = revenueSources(
      [{ customer_account: "ana.near", person_id: "p-ana" }],
      10n,
      side([]),
      new Map([["ana.near", null]]),
    );
    expect(r.independent.customers).toBe(0);
    expect(r.unchecked).toEqual({ customers: 1, uses: 1, revenue: "10" });
  });

  it("without a price the revenue is unknown, never zero", () => {
    const r = revenueSources(
      [{ customer_account: "ana.near", person_id: "p-ana" }],
      null,
      side([]),
      new Map([["ana.near", "ana.near"]]),
    );
    expect(r.independent).toEqual({ customers: 1, uses: 1, revenue: null });
  });
});

describe("revenue by source on the sale's economics (owner and buyer view)", () => {
  it("an independent customer's uses count as independent", async () => {
    const s = await saleWorld();
    expect((await s.customerUse()).unit).toBe("charged");
    const e = await s.ava(`/api/sales/${s.biz}/economics`);
    expect(e.status).toBe(200);
    expect(e.body.revenue_sources.independent).toMatchObject({ customers: 1, uses: 1 });
    expect(e.body.revenue_sources.linked.customers).toBe(0);
    expect(e.body.scenario.independent_uses_last_30_days).toBe(e.body.scenario.uses_last_30_days);
  });

  it("a customer whose registration the seller paid for is linked, with the contract's reason", async () => {
    const s = await saleWorld();
    expect((await s.customerUse()).unit).toBe("charged");
    // The contract records the seller as the registration's payer (sponsor_shell).
    const ent = s.w.chain.ents.get(CUSTOMER) as Record<string, unknown>;
    ent.storage_payer = SELLER;
    const e = await s.ava(`/api/sales/${s.biz}/economics`);
    expect(e.body.revenue_sources.independent.customers).toBe(0);
    // The buyer's projection doesn't start from revenue linked to the seller.
    expect(e.body.scenario.independent_uses_last_30_days).toBe(0);
    expect(e.body.revenue_sources.linked).toMatchObject({
      customers: 1,
      uses: 1,
      revenue: e.body.books.earned_revenue,
      accounts: [{ account: CUSTOMER, uses: 1, reasons: ["registration_paid_by_seller"] }],
    });
  });

  it("the seller's own second account here is linked, even with the customer's own registration", async () => {
    const s = await saleWorld();
    expect((await s.customerUse()).unit).toBe("charged");
    const owner = (
      s.w.state.store.db.prepare("SELECT owner_id FROM businesses WHERE id = ?").get(s.biz) as {
        owner_id: string;
      }
    ).owner_id;
    s.w.state.store.db
      .prepare(
        "INSERT OR REPLACE INTO person_accounts (account_id, person_id, network, created_at) VALUES (?, ?, 'testnet', ?)",
      )
      .run(CUSTOMER, owner, new Date().toISOString());
    const e = await s.ava(`/api/sales/${s.biz}/economics`);
    // Linked, but the tie is only in Everstreet's records: reason and count, never the account.
    expect(e.body.revenue_sources.linked.accounts).toEqual([
      { account: null, uses: 1, reasons: ["owner_here"] },
    ]);
    expect(JSON.stringify(e.body.revenue_sources)).not.toContain(CUSTOMER);
  });
});

// Nov 7 review (finding 11): a customer charged on two plans had only the last plan's registration
// payer read. One payer per customer now comes from every plan's read.
describe("one registration payer per customer, from every plan's read", () => {
  const sellerSide = (a: string) => a === "seller.testnet";
  it("is the seller's side if any plan's registration was paid there", () => {
    const p = registrationPayers(
      new Map([["c.testnet", ["c.testnet", "seller.testnet"]]]),
      sellerSide,
    );
    expect(p.get("c.testnet")).toBe("seller.testnet");
  });
  it("is unchecked (null) if any plan's read failed and none was the seller's", () => {
    const p = registrationPayers(new Map([["c.testnet", ["c.testnet", null]]]), sellerSide);
    expect(p.get("c.testnet")).toBeNull();
  });
  it("is the seller's side even when another plan's read failed", () => {
    const p = registrationPayers(new Map([["c.testnet", [null, "seller.testnet"]]]), sellerSide);
    expect(p.get("c.testnet")).toBe("seller.testnet");
  });
  it("is the first payer read when every plan was read and none was the seller's", () => {
    const p = registrationPayers(
      new Map([["c.testnet", ["c.testnet", "friend.testnet"]]]),
      sellerSide,
    );
    expect(p.get("c.testnet")).toBe("c.testnet");
  });
});
