// Shared fixture for close and reconciliation tests: the in-memory FakeChain with controls for
// lost responses, held reads and failing reads, and a fictional business with an open, funded
// deal the buyer has accepted. A test double only; nothing here is testnet evidence.

import { expect } from "vitest";
import { TestDoubleAuthority } from "../../services/openseat/src/authority.ts";
import { openSeatApp } from "../../services/openseat/src/http.ts";
import { OpenSeat } from "../../services/openseat/src/service.ts";
import { everstreetApi } from "../src/app.ts";
import { openSeatProvider } from "../src/bookings.ts";
import type { Control } from "../src/chain.ts";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";
import { FakeChain } from "./fake-chain.ts";

// biome-ignore lint/suspicious/noExplicitAny: tests read deep response fields
export type Json = Record<string, any>;

export function gate() {
  let open: () => void = () => {};
  const opened = new Promise<void>((r) => {
    open = r;
  });
  return { opened, open };
}

/** The fake chain, with lost responses, held reads, failing reads and stale reads on demand. */
export class GatedChain extends FakeChain {
  loseNextAcceptResponse = false;
  controlGate: Promise<void> | null = null;
  controlReads = 0;
  /** Reads (getDeal/control) fail while this is above zero, counting down. */
  failReads = 0;
  /** A lagging RPC: control answers with this snapshot instead of the current state. */
  staleControl: Control | null = null;

  /** The next acceptance is lost before it reaches the chain (nothing lands). */
  dropNextAccept = false;
  acceptCalls = 0;

  override async acceptSale(input: Parameters<FakeChain["acceptSale"]>[0]) {
    this.acceptCalls++;
    if (this.dropNextAccept) {
      this.dropNextAccept = false;
      throw new Error("network: the request never arrived");
    }
    const result = await super.acceptSale(input);
    if (this.loseNextAcceptResponse) {
      this.loseNextAcceptResponse = false;
      // The transaction landed; the client never heard back.
      throw new Error("network: the response was lost");
    }
    return result;
  }

  /** Only getDeal reads fail while this is above zero, counting down (control still answers). */
  failDealReads = 0;

  override async getDeal(business: string, dealId: string) {
    if (this.failDealReads > 0) {
      this.failDealReads--;
      throw new Error("RPC unavailable");
    }
    if (this.failReads > 0) {
      this.failReads--;
      throw new Error("RPC unavailable");
    }
    return super.getDeal(business, dealId);
  }

  /** Monthly reads (the books behind evidence) answer now but deliver when this opens. */
  periodGate: Promise<void> | null = null;
  /** Opens once a held monthly read has started. */
  periodEntered = gate();

  override async period(business: string) {
    const answer = await super.period(business); // read now...
    if (this.periodGate) {
      this.periodEntered.open();
      await this.periodGate; // ...delivered later
    }
    return answer;
  }

  override async control(business: string) {
    this.controlReads++;
    if (this.controlGate) await this.controlGate;
    if (this.failReads > 0) {
      this.failReads--;
      throw new Error("RPC unavailable");
    }
    return this.staleControl ?? super.control(business);
  }
}

export function world() {
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
      return { status: res.status, body: (await res.json()) as Json, headers: res.headers };
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
  return { chain, store, app, join };
}

/** A fictional business with payments on, a buying team with access, and an open, funded deal. */
export async function fundedDeal(w = world()) {
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
  const account = (
    w.store.db.prepare("SELECT business_account FROM deals WHERE id = ?").get(deal.id) as {
      business_account: string;
    }
  ).business_account;
  return { ...w, mara, ana, id, deal, coop, account };
}

export const count = (w: { store: Store }, sql: string, ...args: string[]) =>
  (w.store.db.prepare(sql).get(...args) as { n: number }).n;
