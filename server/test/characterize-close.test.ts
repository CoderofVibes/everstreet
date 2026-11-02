// Job 003a: characterization of the close and revocation boundaries as they behave today.
// These tests pass by asserting current behaviour; tests named "gap:" pin down behaviour the
// digital acquisition journey must not rely on. Nothing here changes v2, the server or
// OpenSeat. The chain is the in-memory FakeChain (a test double, not testnet evidence), and
// timing is forced with gates, not real network delays.
// See docs/astra/reports/2026-11-02_003a_characterize-credit-and-close.md.

import { describe, expect, it } from "vitest";
import { TestDoubleAuthority } from "../../services/openseat/src/authority.ts";
import { type OperatorIdentity, signCommand } from "../../services/openseat/src/command.ts";
import { JUNIPER_CLASS, seedJuniper } from "../../services/openseat/src/fixture.ts";
import { openSeatApp } from "../../services/openseat/src/http.ts";
import { generateKey } from "../../services/openseat/src/keys.ts";
import { OpenSeat } from "../../services/openseat/src/service.ts";
import { everstreetApi } from "../src/app.ts";
import { openSeatProvider } from "../src/bookings.ts";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";
import { FakeChain } from "./fake-chain.ts";

// biome-ignore lint/suspicious/noExplicitAny: tests read deep response fields
type Json = Record<string, any>;

function gate() {
  let open: () => void = () => {};
  const opened = new Promise<void>((r) => {
    open = r;
  });
  return { opened, open };
}

/** The fake chain, with a lost response and a held control read on demand. */
class GatedChain extends FakeChain {
  loseNextAcceptResponse = false;
  controlGate: Promise<void> | null = null;
  controlReads = 0;

  override async acceptSale(input: Parameters<FakeChain["acceptSale"]>[0]) {
    const result = await super.acceptSale(input);
    if (this.loseNextAcceptResponse) {
      this.loseNextAcceptResponse = false;
      // The transaction landed; the client never heard back.
      throw new Error("network: the response was lost");
    }
    return result;
  }

  override async control(business: string) {
    this.controlReads++;
    if (this.controlGate) await this.controlGate;
    return super.control(business);
  }
}

function world() {
  const openseat = new OpenSeat({
    dbPath: ":memory:",
    authority: new TestDoubleAuthority("o.test", "o.test"),
  });
  const http = openSeatApp(openseat);
  const chain = new GatedChain();
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
  return { chain, store, join };
}

/** A fictional business with payments on, a buying team with access, and an open, funded deal. */
async function fundedDeal() {
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
  expect(
    (
      await mara(`/api/businesses/${id}/payments/activate`, "POST", {
        refund_hours: 24,
        reserve_cents: 0,
      })
    ).status,
  ).toBe(201);
  const ana = await w.join("Ana Ruiz");
  const coop = (
    await ana("/api/acquire/buyers", "POST", {
      name: "Alder Lane Makers Co-op",
      kind: "cooperative",
      intent: "team",
    })
  ).body.buyer.id as string;
  await mara(`/api/businesses/${id}/listing`, "PATCH", { mode: "private", invites: [coop] });
  const listing = (await ana("/api/acquire/search", "POST", { buyer_id: coop })).body.results[0]
    .listing_id;
  await ana(`/api/acquire/listings/${listing}/requests`, "POST", {
    buyer_id: coop,
    categories: ["financials"],
    purpose: "Could our co-op keep these classes running?",
    days: 7,
  });
  const deal = (
    await mara(`/api/businesses/${id}/deals`, "POST", {
      buyer_id: coop,
      price_cents: 300_000,
      days: 7,
      handover: "Two Saturdays teaching alongside the new owner",
    })
  ).body.deal;
  await ana(`/api/deals/${deal.id}/test-dollars`, "POST");
  expect((await ana(`/api/deals/${deal.id}/fund`, "POST")).status).toBe(200);
  expect((await ana(`/api/deals/${deal.id}/accept`, "POST", { digest: deal.digest })).status).toBe(
    200,
  );
  return { ...w, mara, ana, id, deal };
}

const count = (w: { store: Store }, sql: string, ...args: string[]) =>
  (w.store.db.prepare(sql).get(...args) as { n: number }).n;

describe("characterize: closing a sale in the app", () => {
  it("a lost acceptance response leaves the chain closed and the app open; a retry is refused, not settled", async () => {
    const s = await fundedDeal();
    s.chain.loseNextAcceptResponse = true;
    const lost = await s.mara(`/api/deals/${s.deal.id}/accept`, "POST", { digest: s.deal.digest });
    expect(lost.status).toBe(500);
    // On chain the sale is final: the buyer owns the business.
    const business = s.store.db
      .prepare("SELECT business_account FROM deals WHERE id = ?")
      .get(s.deal.id) as { business_account: string };
    expect((await s.chain.control(business.business_account)).generation).toBe(2);
    // Locally nothing moved: the deal is open and the seller still owns the business.
    expect(
      (
        s.store.db.prepare("SELECT status FROM deals WHERE id = ?").get(s.deal.id) as {
          status: string;
        }
      ).status,
    ).toBe("open");
    expect(
      (
        s.store.db.prepare("SELECT owner_id FROM businesses WHERE id = ?").get(s.id) as {
          owner_id: string;
        }
      ).owner_id,
    ).toBe(s.mara.id);
    // Retrying the same acceptance is refused by the contract (the deal is no longer open). The
    // refusal is not evidence that the first attempt failed, and it does not reconcile.
    const retry = await s.mara(`/api/deals/${s.deal.id}/accept`, "POST", { digest: s.deal.digest });
    expect(retry.status).toBe(409);
    expect(count(s, "SELECT COUNT(*) AS n FROM ownership WHERE business_id = ?", s.id)).toBe(0);
    // Reading the deal is what reconciles it today.
    const viewed = await s.ana(`/api/deals/${s.deal.id}`);
    expect(viewed.body.deal.status).toBe("closed");
    expect(count(s, "SELECT COUNT(*) AS n FROM ownership WHERE business_id = ?", s.id)).toBe(1);
  });

  it("gap: two concurrent reads after a close both settle, duplicating the local records", async () => {
    const s = await fundedDeal();
    s.chain.loseNextAcceptResponse = true;
    await s.mara(`/api/deals/${s.deal.id}/accept`, "POST", { digest: s.deal.digest });
    // Hold the chain read inside settle() so both requests pass the "already closed?" check
    // before either writes: check, then await, then transaction.
    const g = gate();
    s.chain.controlGate = g.opened;
    const before = s.chain.controlReads;
    const both = Promise.all([s.ana(`/api/deals/${s.deal.id}`), s.mara(`/api/deals/${s.deal.id}`)]);
    for (let i = 0; i < 50 && s.chain.controlReads < before + 2; i++)
      await new Promise((r) => setTimeout(r, 1));
    expect(s.chain.controlReads).toBe(before + 2);
    g.open();
    s.chain.controlGate = null;
    await both;
    expect(count(s, "SELECT COUNT(*) AS n FROM ownership WHERE business_id = ?", s.id)).toBe(2);
    expect(
      count(
        s,
        "SELECT COUNT(*) AS n FROM events WHERE type = 'business.sold' AND subject = ?",
        s.id,
      ),
    ).toBe(2);
  });
});

describe("characterize: OpenSeat operator authority across a close", () => {
  const BUSINESS = "openseat.business.test";

  function identity(accountId: string, authority: TestDoubleAuthority): OperatorIdentity {
    const key = generateKey();
    authority.addKey(accountId, key.publicKey);
    return { accountId, secretKey: key.secretKey };
  }

  /** The authority double, with its answer computed at call time and delivered on a gate. */
  class GatedAuthority extends TestDoubleAuthority {
    hold: Promise<void> | null = null;
    asked = gate();
    override async operatorCheck(accountId: string, capability: string) {
      const answer = await super.operatorCheck(accountId, capability); // read now
      this.asked.open();
      if (this.hold) await this.hold; // ...used later
      return answer;
    }
  }

  it("gap: a command checked before the close runs after it, under the former owner", async () => {
    const authority = new GatedAuthority(BUSINESS, "founder.test");
    const service = new OpenSeat({ dbPath: ":memory:", authority });
    seedJuniper(service);
    const founder = identity("founder.test", authority);
    const g = gate();
    authority.hold = g.opened;
    const pending = service.execute(
      signCommand(founder, {
        business: BUSINESS,
        action: "set_capacity",
        args: { class_id: JUNIPER_CLASS.id, capacity: 9 },
        op_id: "cap-before-close",
        generation: 1,
      }),
    );
    await authority.asked.opened; // the check has read "owner, generation 1"
    authority.sell("northline.test"); // the close lands: new owner, generation 2
    g.open();
    const outcome = await pending;
    expect(outcome.accepted).toBe(true);
    expect(outcome.authority).toMatchObject({ owner: "founder.test", generation: 1 });
    expect(service.getClass(JUNIPER_CLASS.id).capacity).toBe(9);
    // A command checked after the close is refused.
    authority.hold = null;
    const after = await service.execute(
      signCommand(founder, {
        business: BUSINESS,
        action: "set_capacity",
        args: { class_id: JUNIPER_CLASS.id, capacity: 3 },
        op_id: "cap-after-close",
        generation: 1,
      }),
    );
    expect(after.accepted).toBe(false);
    expect(service.getClass(JUNIPER_CLASS.id).capacity).toBe(9);
  });
});
