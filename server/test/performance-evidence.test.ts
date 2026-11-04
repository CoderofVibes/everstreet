// Job 003u: digital performance evidence for an acquirer. A new, explicitly requested and
// owner-granted scope (wording 4); the one aggregation projected through an allowlist with
// coherent small-group suppression; room and export the same; old, narrow, expired, revoked and
// sold-away grants show none, including when access changes while a read is in flight. Real routes;
// fictional people; labelled fixtures; finite.

import { describe, expect, it } from "vitest";
import { PERFORMANCE_MONTHS, WITHHELD } from "../src/performanceEvidence.ts";
import type { Json } from "./customer-world.ts";
import { gate, world } from "./deal-world.ts";
import { maintenanceWorld } from "./maintenance-world.ts";
import { FixtureV3Transport, V3_CLOSED, V3_DIGEST } from "./v3-fixture-transport.ts";

const inert = { set: () => 1, clear: () => {} };
const UNSUPPORTED = "A fictional shopping list: oat milk, rye bread, two lemons";
const PURPOSE = "Check how the invoice service is used before we talk price";

/**
 * A digital business with recorded uses (charged, returned, reserved-not-run), listed privately
 * to one buying team. Defaults: 4 charged, 1 returned, 1 reserved.
 */
async function listed(
  opts: {
    charged?: number;
    returned?: number;
    reserved?: number;
    v3Transport?: FixtureV3Transport;
  } = {},
) {
  const t = await maintenanceWorld({ v3Transport: opts.v3Transport });
  const s = t.supervisor("worker-a", { timers: inert });
  const ids: string[] = [];
  for (let i = 0; i < (opts.charged ?? 4); i++) {
    const who = i === 0 ? t.w.cara : t.customer(i);
    const id = await t.reserve(who, `perf-key-${i}`);
    await t.execute(who, id);
    ids.push(id);
  }
  const returnedIds: string[] = [];
  for (let i = 0; i < (opts.returned ?? 1); i++) {
    const r = t.customer(20 + i);
    const id = await t.reserve(r, `perf-key-returned-${i}`, UNSUPPORTED);
    t.sync();
    await r(`/api/customer/uses/${id}/execute`, "POST", {});
    returnedIds.push(id);
  }
  // Passes until every run use is settled (bounded: at most 12).
  for (let i = 0; i < 12; i++) {
    if (
      ids.every((id) => t.unit(id) === "charged") &&
      returnedIds.every((id) => t.unit(id) === "returned")
    )
      break;
    t.sync();
    await s.runPass();
  }
  for (let i = 0; i < (opts.reserved ?? 1); i++)
    await t.reserve(t.customer(40 + i), `perf-key-reserved-${i}`);
  const biz = t.w.f.business;
  const noah = t.w.person("Noah Fenn");
  const team = (
    await noah("/api/acquire/buyers", "POST", {
      name: "Fenn Holdings",
      kind: "individual",
      intent: "operate",
    })
  ).body.buyer.id as string;
  // Publishing still asks for the page's (legacy) offering title; set through its own route.
  await t.w.owner(`/api/businesses/${biz}`, "PATCH", { name: "Ledgerline Invoice Reader" });
  await t.w.owner(`/api/businesses/${biz}/offer`, "PATCH", {
    title: "Invoice rows from fictional supplier invoices",
  });
  const pub = await t.w.owner(`/api/businesses/${biz}/publish`, "POST");
  if (pub.status !== 200) throw new Error(`publish ${pub.status} ${pub.body.error}`);
  const listing = await t.w.owner(`/api/businesses/${biz}/listing`, "PATCH", {
    mode: "private",
    invites: [team],
  });
  if (listing.status !== 200) throw new Error(`listing ${listing.status} ${listing.body.error}`);
  const listingId = (
    t.w.state.store.db.prepare("SELECT id FROM listings WHERE business_id = ?").get(biz) as {
      id: string;
    }
  ).id;
  const ask = async (categories: string[], who = noah, buyer = team) =>
    who(`/api/acquire/listings/${listingId}/requests`, "POST", {
      buyer_id: buyer,
      categories,
      purpose: PURPOSE,
      days: 7,
    });
  const decide = (req: string, body: Json) =>
    t.w.owner(`/api/acquire/requests/${req}/decide`, "POST", body);
  const room = (req: string, who = noah) => who(`/api/acquire/rooms/${req}`);
  return { t, biz, noah, team, listingId, ask, decide, room, ids };
}

// 003u1: the suppression rule itself is tested in performance-disclosure.test.ts against complete
// public outputs; these tests check the projection over real records.

const ALLOWED = [
  "as_of",
  "state",
  "period",
  "withheld",
  "usage",
  "months",
  "execution",
  "current",
  "cost",
  "basis",
  "suppression",
  "limits",
];

describe("003u a buyer who asked and was granted sees only the allowlisted aggregate", () => {
  it("requested explicitly, granted deliberately; figures agree with the owner's; nothing private", async () => {
    // 4 charged, 3 returned, none reserved: no group of 1 or 2 anywhere, so everything shows.
    const x = await listed({ charged: 4, returned: 3, reserved: 0 });
    const req = (await x.ask(["financials", "digital_performance"])).body.request.id as string;
    // Before the owner decides: nothing.
    expect((await x.room(req)).status).toBe(403);
    expect((await x.decide(req, { action: "grant" })).status).toBe(200);
    const r = await x.room(req);
    expect(r.status).toBe(200);
    const p = r.body.digital_performance as Json;
    expect(Object.keys(p).sort()).toEqual([...ALLOWED].sort());
    expect(p.period.months).toBe(PERFORMANCE_MONTHS);
    expect(p.state).toBe("recorded");
    expect(p.withheld).toBe(false);
    expect(p.usage.requested).toBe(7);
    expect(Object.fromEntries(p.usage.split.map((s: Json) => [s.key, s.value]))).toEqual({
      charged: 4,
      returned: 3,
      settling: 0,
      needs_attention: 0,
      reserved: 0,
      never_reserved: 0,
    });
    // The same aggregation as the owner's books (no second model).
    const books = (await x.t.w.owner(`/api/businesses/${x.biz}/books?months=12`)).body
      .operations as Json;
    expect(p.cost.customers.microcents).toBe(books.totals.cost.customers.microcents);
    expect(p.cost.founder.microcents).toBe(books.totals.cost.founder.microcents);
    expect(p.cost.customers.calls).toBe(books.totals.cost.customers.calls);
    expect(p.months.at(-1).requested).toBe(7);
    // Nothing private or owner-only: ids, links, documents, results, worker or holder facts.
    const text = JSON.stringify(p);
    for (const secret of [
      x.t.w.f.project,
      x.t.offer,
      x.t.w.cara.id,
      ...x.ids,
      "Stackline",
      "oat milk",
      "/build/",
      "customer-offers",
      "worker-a",
      "heartbeat",
      "project_id",
    ])
      expect(text).not.toContain(secret);
  });

  it("room and export carry the same allowlisted section", async () => {
    const x = await listed();
    const req = (await x.ask(["digital_performance"])).body.request.id as string;
    await x.decide(req, { action: "grant" });
    const room = (await x.room(req)).body.digital_performance as Json;
    const exp = (await x.noah(`/api/acquire/rooms/${req}/export`)).body.digital_performance as Json;
    const strip = ({ as_of: _, ...rest }: Json) => rest;
    expect(strip(exp)).toEqual(strip(room));
    expect(Object.keys(exp).sort()).toEqual([...ALLOWED].sort());
  });

  it("a group of 1 or 2 anywhere withholds every breakdown, with no size claimed", async () => {
    // 4 charged, 1 returned, 1 reserved: small groups exist, so only the total requested shows.
    const x = await listed();
    const req = (await x.ask(["digital_performance"])).body.request.id as string;
    await x.decide(req, { action: "grant" });
    const p = (await x.room(req)).body.digital_performance as Json;
    expect(p.withheld).toBe(true);
    expect(p.usage.requested).toBe(6);
    for (const s of p.usage.split) expect(s.value).toBe(WITHHELD);
    expect(p.execution).toEqual({
      ran: WITHHELD,
      usable_result: WITHHELD,
      not_usable: WITHHELD,
      undecided_or_unknown: WITHHELD,
    });
    expect(p.current.total).toBe(WITHHELD);
    expect(p.cost.customers).toMatchObject({ calls: WITHHELD, microcents: WITHHELD });
    for (const m of p.months) {
      expect(m.requested).toBe(WITHHELD);
      expect(m.customers).toEqual({ calls: WITHHELD, microcents: WITHHELD });
    }
    // The founder's own testing isn't about customers: exact, never withheld.
    expect(p.cost.founder.microcents).toMatch(/^[0-9]+$/);
    // No number is hiding in the text, and no bound is claimed.
    expect(JSON.stringify(p)).not.toMatch(/fewer_than_3|"Fewer/);
  });

  it("small totals: 1 charged, 1 returned, 1 reserved shows only the total of 3", async () => {
    const x = await listed({ charged: 1 });
    const req = (await x.ask(["digital_performance"])).body.request.id as string;
    await x.decide(req, { action: "grant" });
    const p = (await x.room(req)).body.digital_performance as Json;
    expect(p.usage.requested).toBe(3);
    expect(p.withheld).toBe(true);
    expect(p.cost.customers.microcents).toBe(WITHHELD);
  });
});

describe("003u nothing widens silently", () => {
  it("a grant without the new category, a narrowed grant, and an old-wording row show none", async () => {
    const x = await listed();
    const plain = (await x.ask(["financials", "operations"])).body.request.id as string;
    await x.decide(plain, { action: "grant" });
    const r = await x.room(plain);
    expect(r.status).toBe(200);
    expect("digital_performance" in r.body).toBe(false);
    // Synthetic, labelled: the team's first request closed so it may ask again (one open per team).
    const db = x.t.w.state.store.db;
    db.prepare("UPDATE access_requests SET status = 'withdrawn' WHERE id = ?").run(plain);
    const narrow = (await x.ask(["financials", "digital_performance"])).body.request.id as string;
    expect(
      (await x.decide(narrow, { action: "grant", categories: ["financials"] })).body.request
        .granted,
    ).toEqual(["financials"]);
    expect("digital_performance" in (await x.room(narrow)).body).toBe(false);
    // Synthetic, labelled: a row granted under wording 3 that somehow lists the new key.
    db.prepare(
      "UPDATE access_requests SET granted = ?, scope_version = 3, access_version = access_version + 1 WHERE id = ?",
    ).run(JSON.stringify(["financials", "digital_performance"]), narrow);
    expect("digital_performance" in (await x.room(narrow)).body).toBe(false);
  });

  it("asking for something not asked can't be granted, and the request default doesn't include it", async () => {
    const x = await listed();
    const req = (await x.ask(["financials"])).body.request.id as string;
    const r = await x.decide(req, {
      action: "grant",
      categories: ["financials", "digital_performance"],
    });
    expect(r.status).toBe(400);
    expect(
      (
        x.t.w.state.store.db
          .prepare("SELECT granted FROM access_requests WHERE id = ?")
          .get(req) as {
          granted: string | null;
        }
      ).granted,
    ).toBeNull();
  });
});

describe("003u access ends: revoked, expired, sold", () => {
  it("revoked and expired grants show nothing", async () => {
    const x = await listed();
    const req = (await x.ask(["digital_performance"])).body.request.id as string;
    await x.decide(req, { action: "grant" });
    expect((await x.room(req)).status).toBe(200);
    await x.t.w.owner(`/api/acquire/requests/${req}/revoke`, "POST");
    const r = await x.room(req);
    expect(r.status).toBe(403);
    expect("digital_performance" in r.body).toBe(false);
    expect((await x.noah(`/api/acquire/rooms/${req}/export`)).status).toBe(403);
  });

  it("after the actual sale reconciliation the old grant shows nothing", async () => {
    const transport = new FixtureV3Transport();
    const x = await listed({ v3Transport: transport });
    const req = (await x.ask(["digital_performance"])).body.request.id as string;
    await x.decide(req, { action: "grant" });
    expect((await x.room(req)).status).toBe(200);
    const buyer = x.t.w.person("Iris Vale");
    x.t.w.link(x.t.w.f.ava.id, "founder.near");
    x.t.w.link(buyer.id, "buyer.near");
    const biz = `/api/businesses/${x.biz}`;
    await x.t.w.owner(`${biz}/v3/refresh`, "POST", {});
    const intent = (
      await x.t.w.owner(`${biz}/v3/intents`, "POST", {
        idempotency_key: "perf-intent-0001",
        deal_seq: "1",
        version: 1,
        digest: V3_DIGEST,
      })
    ).body.intent.id as string;
    transport.next(V3_CLOSED);
    x.t.w.chain.afterSale();
    expect((await buyer(`${biz}/v3/intents/${intent}/reconcile`, "POST")).body.state).toBe(
      "applied",
    );
    const r = await x.room(req);
    expect(r.status).toBe(403);
    expect("digital_performance" in r.body).toBe(false);
  });
});

/** The deal world holds the room's monthly reads on a gate while access changes. */
async function heldRoom() {
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
  await mara(`/api/businesses/${id}/payments/activate`, "POST", {
    refund_hours: 24,
    reserve_cents: 0,
  });
  const ana = await w.join("Ana Ruiz");
  const ben = await w.join("Ben Okafor");
  const coop = (
    await ana("/api/acquire/buyers", "POST", {
      name: "Alder Lane Makers Co-op",
      kind: "cooperative",
      intent: "team",
    })
  ).body.buyer.id as string;
  await ana(`/api/acquire/buyers/${coop}/members`, "POST", { person_id: ben.id, role: "evidence" });
  await mara(`/api/businesses/${id}/listing`, "PATCH", { mode: "private", invites: [coop] });
  const listing = (await ana("/api/acquire/search", "POST", { buyer_id: coop })).body.results[0]
    .listing_id as string;
  const req = (
    await ana(`/api/acquire/listings/${listing}/requests`, "POST", {
      buyer_id: coop,
      categories: ["digital_performance"],
      purpose: PURPOSE,
      days: 7,
    })
  ).body.request.id as string;
  await mara(`/api/acquire/requests/${req}/decide`, "POST", { action: "grant" });
  const held = async (path: string, change: () => unknown, who = ana) => {
    const g = gate();
    w.chain.periodEntered = gate();
    w.chain.periodGate = g.opened;
    const pending = who(path);
    await w.chain.periodEntered.opened;
    await change();
    w.chain.periodGate = null;
    g.open();
    return pending;
  };
  return { w, mara, ana, ben, coop, req, held };
}

describe("003u access changing while a read is in flight returns nothing", () => {
  it("the grant is legacy-free here: a class business with the new scope reads 'not started'", async () => {
    const s = await heldRoom();
    const r = await s.ana(`/api/acquire/rooms/${s.req}`);
    expect(r.status).toBe(200);
    expect(r.body.digital_performance.state).toBe("not_started");
    expect(r.body.digital_performance.usage.requested).toBe(0);
  });

  for (const path of ["", "/export"])
    it(`room${path}: revoked, expired, or the reader's role removed mid-read → 403, no section`, async () => {
      const revoked = await heldRoom();
      const a = await revoked.held(`/api/acquire/rooms/${revoked.req}${path}`, () =>
        revoked.mara(`/api/acquire/requests/${revoked.req}/revoke`, "POST"),
      );
      expect(a.status).toBe(403);
      expect("digital_performance" in a.body).toBe(false);

      const expired = await heldRoom();
      const b = await expired.held(`/api/acquire/rooms/${expired.req}${path}`, () =>
        expired.w.store.db
          .prepare("UPDATE access_requests SET expires_at = ? WHERE id = ?")
          .run("2000-01-01T00:00:00.000Z", expired.req),
      );
      expect(b.status).toBe(403);
      expect("digital_performance" in b.body).toBe(false);

      const role = await heldRoom();
      const c = await role.held(
        `/api/acquire/rooms/${role.req}${path}`,
        () => role.ana(`/api/acquire/buyers/${role.coop}/members/${role.ben.id}`, "DELETE"),
        role.ben,
      );
      expect(c.status).not.toBe(200);
      expect("digital_performance" in c.body).toBe(false);
    });
});
