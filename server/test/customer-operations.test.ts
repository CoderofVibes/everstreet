// Job 003t: customer operating performance in the owner's books. One aggregation over this app's
// own records, checked against those records: real customer API uses (charged, returned,
// settling, reserved, never reserved), automatic maintenance, runtime cost split by purpose, exact
// sums, actual zero vs unknown cost, period boundaries, two businesses, retired offers, and
// continuity through the actual acquisition reconciliation. Labelled fixtures; finite.

import { describe, expect, it } from "vitest";
import { addDecimal, customerOperations } from "../src/operations.ts";
import type { Json } from "./customer-world.ts";
import { maintenanceWorld } from "./maintenance-world.ts";
import { FixtureV3Transport, V3_CLOSED, V3_DIGEST } from "./v3-fixture-transport.ts";

const UNSUPPORTED = "A fictional shopping list: oat milk, rye bread, two lemons";
const inert = { set: () => 1, clear: () => {} };

async function scenario(v3Transport?: FixtureV3Transport) {
  const t = await maintenanceWorld({ v3Transport });
  const books = async (who = t.w.owner, months = 6) =>
    who(`/api/businesses/${t.w.f.business}/books?months=${months}`);
  const s = t.supervisor("worker-a", { timers: inert });
  // 1. A supported invoice: run, then charged by the background worker (no settle click).
  const charged = await t.reserve(t.w.cara, "ops-key-charged");
  await t.execute(t.w.cara, charged);
  // 2. An unsupported document: run, not usable, returned by the worker.
  const b = t.customer(0);
  const returned = await t.reserve(b, "ops-key-returned", UNSUPPORTED);
  t.sync();
  await b(`/api/customer/uses/${returned}/execute`, "POST", {});
  // A lost prepare reply retried with the same key: still one request.
  const c = t.customer(1);
  const settling = await t.reserve(c, "ops-key-settling");
  await t.execute(c, settling);
  for (let i = 0; i < 4; i++) {
    t.sync();
    await s.runPass();
  }
  // 3. Its settle submission is lost on the way: its outcome is "settling", not charged.
  const d = t.customer(2);
  const lost = await t.reserve(d, "ops-key-lost");
  await t.execute(d, lost);
  t.w.writer.unitModes.push("drop");
  t.sync();
  await s.runPass();
  // 4. Reserved, never run. 5. Prepared only. 6. Prepared and cancelled.
  await t.reserve(t.customer(3), "ops-key-reserved");
  await t.prepare(t.customer(4), "ops-key-prepared");
  const e = t.customer(5);
  const cancelled = await t.prepare(e, "ops-key-cancel");
  await e(`/api/customer/uses/${cancelled.id}/cancel`, "POST");
  return { t, books, s, ids: { charged, returned, settling, lost } };
}

describe("003t the owner's digital operations match the records", () => {
  it("usage by status, execution facts and purpose-split runtime cost, exactly", async () => {
    const { t, books, ids } = await scenario();
    expect(t.unit(ids.charged)).toBe("charged");
    expect(t.unit(ids.returned)).toBe("returned");
    expect(t.unit(ids.lost)).toBe("unknown");
    const r = await books();
    expect(r.status).toBe(200);
    const ops = r.body.operations as Json;
    const now = ops.months.at(-1);
    expect(now.so_far).toBe(true);
    expect(ops.totals.usage).toEqual({
      requested: 7,
      charged: 2, // the supported invoice and the one whose settlement was first in progress
      returned: 1,
      settling: 1,
      needs_attention: 0,
      reserved_unsettled: 1,
      awaiting_reservation: 0,
      never_reserved: 2,
    });
    expect(ops.totals.execution).toMatchObject({ ran: 4, usable_result: 3, not_usable: 1 });
    // Cost: exactly the records, split by purpose; the split adds up to the runtime total.
    const db = t.w.state.store.db;
    const sum = (where: string) =>
      db
        .prepare(
          `SELECT CAST(COALESCE(SUM(charged_microcents), 0) AS TEXT) AS s, COUNT(*) AS n FROM runtime_invocations WHERE business_id = ? AND ${where}`,
        )
        .get(t.w.f.business) as { s: string; n: number };
    const customers = sum("purpose = 'customer_use'");
    const founder = sum("purpose <> 'customer_use'");
    expect(ops.totals.cost.customers).toMatchObject({
      microcents: customers.s,
      calls: customers.n,
    });
    expect(ops.totals.cost.founder).toMatchObject({ microcents: founder.s, calls: founder.n });
    expect(customers.n).toBe(4); // one provider call per run: nothing re-run by maintenance
    expect(addDecimal(customers.s, founder.s)).toBe(String(r.body.spend.runtime.period_microcents));
    expect(ops.current).toEqual({ settling: 1, needs_attention: 0 });
    expect(ops.state).toBe("recorded");
    // Owner-safe: no identity, document, result or reference.
    const text = JSON.stringify(ops);
    for (const secret of ["Stackline", "oat milk", "ref-", "cara.near", t.w.cara.id])
      expect(text).not.toContain(secret);
  });

  it("repeated passes and re-reads add no usage or cost", async () => {
    const { t, books, s } = await scenario();
    const before = (await books()).body.operations;
    for (let i = 0; i < 3; i++) {
      t.advance(31_000);
      await s.runPass();
    }
    const after = (await books()).body.operations as Json;
    expect(after.totals.usage.requested).toBe((before as Json).totals.usage.requested);
    expect(after.totals.cost.customers.calls).toBe((before as Json).totals.cost.customers.calls);
  });
});

describe("003t periods, zero and unknown, exact sums", () => {
  it("a request stays in the month it was requested, whenever it settles; future rows can't enter", async () => {
    const t = await maintenanceWorld();
    const id = await t.reserve(t.w.cara, "month-key-0001");
    await t.execute(t.w.cara, id);
    const db = t.w.state.store.db;
    // Synthetic, labelled: this request was made last month (its own immutable timestamp).
    const last = new Date();
    last.setUTCDate(1);
    last.setUTCMonth(last.getUTCMonth() - 1);
    db.prepare("UPDATE customer_requests SET created_at = ? WHERE id = ?").run(
      last.toISOString(),
      id,
    );
    const s = t.supervisor("worker-a", { timers: inert });
    for (let i = 0; i < 3 && t.unit(id) !== "charged"; i++) {
      t.sync();
      await s.runPass();
    }
    const ops = customerOperations(db, t.w.f.business, 3);
    const [, prev, cur] = ops.months;
    expect(prev?.usage).toMatchObject({ requested: 1, charged: 1 });
    expect(cur?.usage.requested).toBe(0);
    // A future-dated row (synthetic) is outside the period, not in any month.
    db.prepare("UPDATE customer_requests SET created_at = ? WHERE id = ?").run(
      "2099-01-01T00:00:00.000Z",
      id,
    );
    expect(customerOperations(db, t.w.f.business, 3).totals.usage.requested).toBe(0);
  });

  it("no offer and no use is 'not started'; a month without records is an actual zero; unknown cost is never zero", async () => {
    const t = await maintenanceWorld();
    const db = t.w.state.store.db;
    const other = await t.w.rw.founder("Bea Fictional"); // another business, with a build
    await t.w.rw.check(other); // its release checks: founder-purpose runtime calls
    const empty = customerOperations(db, other.business, 3);
    expect(empty.state).toBe("not_started");
    expect(empty.months.every((m) => m.usage.requested === 0)).toBe(true);
    // Synthetic, labelled: one founder trial whose usage was never reported.
    const inv = db
      .prepare("SELECT id FROM runtime_invocations WHERE business_id = ? LIMIT 1")
      .get(other.business) as { id: string };
    db.prepare(
      "UPDATE runtime_invocations SET usage_state = 'unknown', state = 'unknown', reserved_cents = 3, charged_microcents = 0 WHERE id = ?",
    ).run(inv.id);
    const ops = customerOperations(db, other.business, 3);
    expect(ops.totals.cost.founder).toMatchObject({ unknown_cost_calls: 1, unknown_held_cents: 3 });
    expect(ops.totals.cost.customers).toEqual({
      microcents: "0",
      calls: 0,
      unknown_cost_calls: 0,
      unknown_held_cents: 0,
    });
  });

  it("tiny and huge costs sum exactly, past the safe-integer limit", async () => {
    const t = await maintenanceWorld();
    const db = t.w.state.store.db;
    const bea = await t.w.rw.founder("Bea Fictional");
    await t.w.rw.check(bea);
    const one = db
      .prepare("SELECT * FROM runtime_invocations WHERE business_id = ? LIMIT 1")
      .get(bea.business) as Json;
    const cols = Object.keys(one).filter(
      (k) => k !== "id" && k !== "idempotency_key" && k !== "charged_microcents",
    );
    // Synthetic, labelled: Bea's real calls set to zero cost, plus copies of one real record
    // with chosen exact costs (one millionth of a cent up to past the safe-integer limit).
    db.prepare("UPDATE runtime_invocations SET charged_microcents = 0 WHERE business_id = ?").run(
      bea.business,
    );
    // An odd total above 2^53: a float can't hold it (it would round to an even neighbour).
    const values = ["1", "2", "9007199254740991", "11"];
    const copy = db.prepare(
      `INSERT INTO runtime_invocations (id, idempotency_key, charged_microcents, ${cols.join(", ")})
       SELECT ?, ?, ?, ${cols.join(", ")} FROM runtime_invocations WHERE id = ?`,
    );
    for (const [i, v] of values.entries()) copy.run(`syn-${i}`, `syn-key-${i}`, BigInt(v), one.id);
    const ops = customerOperations(db, bea.business, 2);
    expect(ops.totals.cost.founder.microcents).toBe("9007199254741005");
    expect(addDecimal("9007199254740993", "2")).toBe("9007199254740995");
  });
});

describe("003t ownership: two businesses, retired offers, actual acquisition", () => {
  it("each owner sees only their business; another person sees nothing; a retired offer keeps its history", async () => {
    const { t, books } = await scenario();
    const bea = await t.w.rw.founder("Bea Fictional");
    expect((await bea.ava(`/api/businesses/${t.w.f.business}/books`)).status).toBe(404);
    expect((await books(t.w.cara)).status).toBe(404);
    const offer = t.offer;
    await t.w.owner(`/api/businesses/${t.w.f.business}/customer-offers/${offer}/retire`, "POST");
    const ops = (await books()).body.operations as Json;
    expect(ops.totals.usage.requested).toBe(7);
    expect(ops.products[0]).toMatchObject({ active_offers: 0, retired_offers: 1 });
  });

  it("after the actual app reconciliation the buyer sees the same history; the former owner is out; customers keep theirs", async () => {
    const transport = new FixtureV3Transport();
    const { t, books, ids } = await scenario(transport);
    const before = (await books()).body.operations as Json;
    const buyer = t.w.person("Noah Fenn");
    t.w.link(t.w.f.ava.id, "founder.near");
    t.w.link(buyer.id, "buyer.near");
    const biz = `/api/businesses/${t.w.f.business}`;
    expect((await t.w.owner(`${biz}/v3/refresh`, "POST", {})).body.outcome).toBe("accepted");
    const intent = (
      await t.w.owner(`${biz}/v3/intents`, "POST", {
        idempotency_key: "ops-intent-0001",
        deal_seq: "1",
        version: 1,
        digest: V3_DIGEST,
      })
    ).body.intent.id as string;
    transport.next(V3_CLOSED);
    t.w.chain.afterSale();
    expect((await buyer(`${biz}/v3/intents/${intent}/reconcile`, "POST")).body.state).toBe(
      "applied",
    );
    expect((await books()).status).toBe(404);
    const theirs = await books(buyer);
    expect(theirs.status).toBe(200);
    const after = theirs.body.operations as Json;
    expect(after.totals).toEqual(before.totals);
    expect((await t.w.cara(`/api/customer/uses/${ids.charged}/result`)).status).toBe(200);
    expect((await buyer(`/api/customer/uses/${ids.charged}/result`)).status).toBe(404);
  });
});
