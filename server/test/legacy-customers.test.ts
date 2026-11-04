// Job 003u2: the legacy "customers" evidence, protected as a whole summary.
//
// 1. Astra's reproduction through the real granted room and export (LegacyDisclosureReproduction):
//    four fictional payments by one customer, three delivered and one refunded. Before this job the
//    room showed Paid orders 4, Delivered 3, Refunded "Fewer than 3", so the refund was exactly 1.
// 2. A bounded feasible-set oracle: every legacy world up to 4 customers × 1..3 orders each × 4
//    statuses, × 0..4 bookings (369,075 worlds, a fixed count asserted before use), grouped by the
//    complete output. No group the summary describes may be pinned to 1 or 2 by any output. The
//    rule before this job fails the same oracle (the refund singleton). Pure; bounded in time.
// 3. Boundaries, zero vs withheld, provenance wording, room/export parity, and that the scope's
//    grant, revocation and fences are unchanged (existing evidence-access tests).

import { describe, expect, it } from "vitest";
import { discloseLegacy, type LegacyCounts, WITHHELD } from "../src/legacyCustomers.ts";
import { type Json, world } from "./deal-world.ts";

// ---------- the real routes ----------

/** A legacy business with a private listing, a buyer team, and a customers-only grant. */
async function grantedCustomers() {
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
  // The deal world's labelled chain double: no network.
  await mara(`/api/businesses/${id}/payments/activate`, "POST", {
    refund_hours: 24,
    reserve_cents: 0,
  });
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
    .listing_id as string;
  const req = (
    await ana(`/api/acquire/listings/${listing}/requests`, "POST", {
      buyer_id: coop,
      categories: ["customers"],
      purpose: "Could our co-op keep these classes running?",
      days: 7,
    })
  ).body.request.id as string;
  expect(
    (await mara(`/api/acquire/requests/${req}/decide`, "POST", { action: "grant" })).status,
  ).toBe(200);
  const db = w.store.db;
  let n = 0;
  /** Fictional stored payment rows (no chain, no money), as in Astra's probe. */
  const pay = (personId: string, status: string) => {
    n++;
    const t = new Date().toISOString();
    db.prepare(
      "INSERT INTO payments (order_id, person_id, business_id, session_id, amount_cents, status, cancel_before, created_at, updated_at) VALUES (?, ?, ?, 'fixture-session', 3500, ?, ?, ?, ?)",
    ).run(`fixture-order-${n}`, personId, id, status, t, t, t);
  };
  const customers = async () => {
    const room = (await ana(`/api/acquire/rooms/${req}`)).body as Json;
    const exp = (await ana(`/api/acquire/rooms/${req}/export`)).body as Json;
    return { room: room.customers as Json, exp: exp.customers as Json, room_body: room };
  };
  return { w, mara, ana, id, req, pay, customers, cara: await w.join("Cara Okafor") };
}

const value = (c: Json, label: string) =>
  (c.rows as { label: string; value: string }[]).find((r) => r.label === label)?.value;
const COUNT_LABELS = [
  "Paying customers",
  "Paid orders",
  "Delivered",
  "Refunded",
  "Customers with 2 or more orders",
  "Bookings",
];

describe("003u2 Astra's counterexample through the granted room and export", () => {
  it("4 orders, 3 delivered, 1 refunded: the whole summary is withheld, identically in both", async () => {
    const s = await grantedCustomers();
    for (const st of ["delivered", "delivered", "delivered", "refunded"]) s.pay(s.cara.id, st);
    const { room, exp } = await s.customers();
    expect(room).toEqual(exp);
    // No published count, so the refund can't be worked out: every count withheld together.
    for (const l of COUNT_LABELS) expect(value(room, l)).toBe(WITHHELD);
    expect(room.withheld).toBe(true);
    expect(JSON.stringify(room)).not.toMatch(/Fewer than|singled out/);
    // The schedule isn't a customer count, and stays.
    expect(value(room, "Upcoming sessions")).toBe("0");
  });

  it("provenance says what the stored records establish, not a chain re-read or a live service", async () => {
    const s = await grantedCustomers();
    for (const st of ["delivered", "delivered", "delivered", "refunded"]) s.pay(s.cara.id, st);
    const { room } = await s.customers();
    expect(room.source).toMatch(/payment records Everstreet stored/);
    expect(room.source).toMatch(/aren't re-read from the chain/);
    expect(room.source).toMatch(/whether that service is connected now isn't shown/);
    expect(room.source).not.toMatch(
      /OpenSeat \(connected service\)|records of NEAR testnet payments/,
    );
    expect(room.limits).toEqual(expect.arrayContaining([expect.stringMatching(/monthly money/)]));
  });

  it("enough of every group: exact counts shown, in both, with zero as zero", async () => {
    const s = await grantedCustomers();
    // 3 single-order customers and 3 with two orders: 9 orders, 6 delivered, 3 refunded.
    const people = await Promise.all(
      ["Dee", "Eli", "Fay", "Gus", "Hal", "Ivy"].map((n) => s.w.join(`${n} Fictional`)),
    );
    const [a, b, c, d, e, f] = people.map((p) => p.id);
    for (const [who, st] of [
      [a, "delivered"],
      [b, "delivered"],
      [c, "refunded"],
      [d, "delivered"],
      [d, "delivered"],
      [e, "delivered"],
      [e, "refunded"],
      [f, "delivered"],
      [f, "refunded"],
    ] as const)
      s.pay(who as string, st);
    // Orders without a booking: 9, a group of at least 3, so bookings 0 is safe to show.
    const { room, exp } = await s.customers();
    expect(room).toEqual(exp);
    expect(room.withheld).toBe(false);
    expect(Object.fromEntries((room.rows as Json[]).map((r) => [r.label, r.value]))).toEqual({
      "Paying customers": "6",
      "Paid orders": "9",
      Delivered: "6",
      Refunded: "3",
      "Customers with 2 or more orders": "3",
      Bookings: "0",
      "Upcoming sessions": "0",
    });
  });

  it("no records: zeros, not withheld, with the no-records source", async () => {
    const s = await grantedCustomers();
    const { room } = await s.customers();
    expect(room.withheld).toBe(false);
    for (const l of COUNT_LABELS) expect(value(room, l)).toBe("0");
    expect(room.source).toMatch(/No customer records through Everstreet yet/);
  });

  it("the grant still decides: no customers section without the category, nothing after revocation", async () => {
    const s = await grantedCustomers();
    s.pay(s.cara.id, "delivered");
    expect((await s.mara(`/api/acquire/requests/${s.req}/revoke`, "POST")).status).toBe(200);
    const after = await s.ana(`/api/acquire/rooms/${s.req}`);
    expect(after.status).toBe(403);
    expect(JSON.stringify(after.body)).not.toMatch(/Paying customers/);
  });
});

// ---------- the bounded feasible-set oracle ----------

type Status = "paid" | "delivered" | "kept" | "refunded";
const STATUSES: Status[] = ["paid", "delivered", "kept", "refunded"];
const MAX_CUSTOMERS = 4;
const MAX_ORDERS_EACH = 3;
const MAX_BOOKINGS = 4;
const EXPECTED_WORLDS = 369_075;

/** Each customer's orders as counts per status (a multiset of 1..MAX_ORDERS_EACH statuses). */
function profiles(): number[][] {
  const out: number[][] = [];
  const rec = (i: number, left: number, cur: number[]) => {
    if (i === STATUSES.length) {
      const n = cur.reduce((a, x) => a + x, 0);
      if (n >= 1) out.push([...cur]);
      return;
    }
    for (let k = 0; k <= left; k++) rec(i + 1, left - k, [...cur, k]);
  };
  rec(0, MAX_ORDERS_EACH, []);
  return out;
}

interface Groups {
  customers: number;
  orders: number;
  delivered: number;
  refunded: number;
  paid: number;
  kept: number;
  /** Orders neither delivered nor refunded. */
  other: number;
  repeat: number;
  single: number;
  extra: number;
  bookings: number;
}

/** Every world: an unordered set of customer profiles, × bookings. Calls `visit` for each. */
function eachWorld(visit: (counts: LegacyCounts, g: Groups) => void): number {
  const ps = profiles();
  let worlds = 0;
  const rec = (start: number, chosen: number[][]) => {
    const tot = [0, 0, 0, 0];
    let repeat = 0;
    for (const c of chosen) {
      let n = 0;
      for (let i = 0; i < 4; i++) {
        tot[i] = (tot[i] ?? 0) + (c[i] ?? 0);
        n += c[i] ?? 0;
      }
      if (n >= 2) repeat++;
    }
    const [paid = 0, delivered = 0, kept = 0, refunded = 0] = tot;
    const orders = paid + delivered + kept + refunded;
    for (let bookings = 0; bookings <= MAX_BOOKINGS; bookings++) {
      worlds++;
      if (worlds > EXPECTED_WORLDS) throw new Error("world bound exceeded");
      const counts = { customers: chosen.length, orders, delivered, refunded, repeat, bookings };
      visit(counts, {
        ...counts,
        paid,
        kept,
        other: paid + kept,
        single: chosen.length - repeat,
        extra: orders - chosen.length,
      });
    }
    if (chosen.length === MAX_CUSTOMERS) return;
    for (let i = start; i < ps.length; i++) rec(i, [...chosen, ps[i] as number[]]);
  };
  rec(0, []);
  return worlds;
}

/** Outputs pinning a group to sizes within {1, 2}: [output, group, feasible values]. */
function pinned(rule: (c: LegacyCounts) => unknown): [string, keyof Groups, number[]][] {
  const feasible = new Map<string, Map<keyof Groups, Set<number>>>();
  const n = eachWorld((counts, g) => {
    const key = JSON.stringify(rule(counts));
    let m = feasible.get(key);
    if (!m) {
      m = new Map();
      feasible.set(key, m);
    }
    for (const k of Object.keys(g) as (keyof Groups)[]) {
      let set = m.get(k);
      if (!set) {
        set = new Set();
        m.set(k, set);
      }
      set.add(g[k]);
    }
  });
  expect(n).toBe(EXPECTED_WORLDS);
  const out: [string, keyof Groups, number[]][] = [];
  for (const [key, m] of feasible)
    for (const [k, set] of m)
      if ([...set].every((v) => v === 1 || v === 2)) out.push([key, k, [...set].sort()]);
  return out;
}

/** The rule before this job (per-cell "Fewer than 3"), kept here only as the reproduction. */
const before = (c: LegacyCounts) => {
  const s = (n: number) => (n > 0 && n < 3 ? "Fewer than 3" : String(n));
  return [c.customers, c.orders, c.delivered, c.refunded, c.repeat, c.bookings].map(s);
};

describe("003u2 no complete output pins a small group (bounded oracle)", () => {
  it("the per-cell rule before this job pins Astra's refund to exactly 1", () => {
    const leaks = pinned(before);
    const astra = JSON.stringify(
      before({
        customers: 1,
        orders: 4,
        delivered: 3,
        refunded: 1,
        repeat: 1,
        bookings: 0,
      }),
    );
    expect(leaks).toContainEqual([astra, "refunded", [1]]);
  }, 60_000);

  it("the whole-summary rule pins nothing: every group could be 0 or 3+ for every output", () => {
    expect(pinned(discloseLegacy)).toEqual([]);
  }, 60_000);
});

describe("003u2 boundaries of the rule", () => {
  const base: LegacyCounts = {
    customers: 3,
    orders: 6,
    delivered: 3,
    refunded: 3,
    repeat: 3,
    bookings: 6,
  };
  it("0 and 3 are shown; 1 or 2 anywhere (published or derived) withholds everything", () => {
    expect(discloseLegacy(base).withheld).toBe(false);
    expect(
      discloseLegacy({ ...base, repeat: 0, orders: 3, refunded: 0, bookings: 3 }).withheld,
    ).toBe(false);
    const cases: Partial<LegacyCounts>[] = [
      { refunded: 2, delivered: 4 }, // a published cell of 2
      { delivered: 2, refunded: 2 }, // paid or kept = 2, derived only
      { repeat: 2 }, // and single-order customers = 1
      { orders: 7, delivered: 4 }, // orders beyond the first = 4, beyond the second = 1
      { bookings: 7 }, // bookings without an order = 1
      { bookings: 1 },
      // Withheld is all-or-nothing: zeros are withheld too, so which fields are zero isn't told.
      { customers: 1, orders: 2, delivered: 2, refunded: 0, repeat: 1, bookings: 0 },
    ];
    for (const c of cases) {
      const d = discloseLegacy({ ...base, ...c });
      expect(d.withheld, JSON.stringify(c)).toBe(true);
      expect(new Set(Object.values(d).filter((v) => typeof v === "string"))).toEqual(
        new Set([WITHHELD]),
      );
    }
  });
});
