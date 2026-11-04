// Job 003t1: operations are read AS OF one instant. A record created after that instant (even
// later the same UTC month) is in no figure: not the cohort, not execution facts, not cost, not
// the current work. Current work is split into exclusive buckets that say what they count, and
// the settlement claim follows the background worker's actual health. Synthetic timestamps are
// labelled; finite.

import { describe, expect, it } from "vitest";
import { maintenanceHealth } from "../src/maintenance.ts";
import { customerOperations } from "../src/operations.ts";
import { maintenanceWorld } from "./maintenance-world.ts";

const AS_OF = new Date("2026-11-04T13:45:00.000Z");
const inert = { set: () => 1, clear: () => {} };

/** Astra's recipe (003t1): one executed use, then its request and every call moved to `at`. */
async function moved(at: string) {
  const t = await maintenanceWorld();
  const id = await t.reserve(t.w.cara, "astra-future-0001");
  await t.execute(t.w.cara, id);
  const db = t.w.state.store.db;
  // Synthetic, labelled: the recorded instants are set to `at`.
  db.prepare("UPDATE customer_requests SET created_at = ? WHERE id = ?").run(at, id);
  db.prepare("UPDATE customer_executions SET created_at = ? WHERE request_id = ?").run(at, id);
  db.prepare("UPDATE runtime_invocations SET created_at = ? WHERE business_id = ?").run(
    at,
    t.w.f.business,
  );
  return { t, db, id };
}

const facts = (o: ReturnType<typeof customerOperations>) => [
  o.totals.usage.requested,
  o.totals.execution.ran,
  o.totals.cost.customers.calls,
  o.totals.cost.founder.calls,
];

describe("003t1 one as-of instant for every projection", () => {
  it("Astra's recipe: activity tomorrow in the same month is in no figure today", async () => {
    const { t, db } = await moved("2026-11-05T13:45:00.000Z");
    const o = customerOperations(db, t.w.f.business, 3, AS_OF);
    expect(facts(o)).toEqual([0, 0, 0, 0]);
    expect(o.current).toEqual({
      awaiting_settlement: 0,
      needs_attention: 0,
      reserved_not_settled: 0,
      awaiting_reservation: 0,
      awaiting_signature: 0,
    });
    expect(o.as_of).toBe(AS_OF.toISOString());
    // No worker has ever run here.
    const h = maintenanceHealth(db, t.w.f.business, t.w.clock.now);
    expect(
      customerOperations(db, t.w.f.business, 3, AS_OF, { nowMs: t.w.clock.now, health: h })
        .settlement.worker,
    ).toBe("not_started");
  });

  it("the exact instant is included; one millisecond later is not; earlier rows count", async () => {
    const at = await moved(AS_OF.toISOString());
    const o = customerOperations(at.db, at.t.w.f.business, 3, AS_OF);
    expect(facts(o)).toEqual([1, 1, 1, 8]);
    expect(o.current.reserved_not_settled).toBe(1);
    const later = await moved("2026-11-04T13:45:00.001Z");
    expect(facts(customerOperations(later.db, later.t.w.f.business, 3, AS_OF))).toEqual([
      0, 0, 0, 0,
    ]);
    const earlier = await moved("2026-11-03T09:00:00.000Z");
    const e = customerOperations(earlier.db, earlier.t.w.f.business, 3, AS_OF);
    expect(facts(e)).toEqual([1, 1, 1, 8]);
    expect(e.months.find((m) => m.yyyymm === 202611)?.usage.requested).toBe(1);
    // The source rows are read, never rewritten.
    expect(
      (
        earlier.db
          .prepare("SELECT created_at FROM customer_requests WHERE id = ?")
          .get(earlier.id) as { created_at: string }
      ).created_at,
    ).toBe("2026-11-03T09:00:00.000Z");
  });
});

describe("003t1 current work in exclusive buckets, and an honest settlement claim", () => {
  it("each request in one current bucket; prepared ones awaiting a signature are counted", async () => {
    const t = await maintenanceWorld();
    const s = t.supervisor("worker-a", { timers: inert });
    const settled = await t.reserve(t.w.cara, "cur-key-0001");
    await t.execute(t.w.cara, settled);
    for (let i = 0; i < 3; i++) {
      t.sync();
      await s.runPass();
    }
    const lost = t.customer(0);
    const lostId = await t.reserve(lost, "cur-key-0002");
    await t.execute(lost, lostId);
    t.w.writer.unitModes.push("drop");
    t.sync();
    await s.runPass();
    await t.reserve(t.customer(1), "cur-key-0003"); // reserved, not run
    await t.prepare(t.customer(2), "cur-key-0004"); // awaiting the customer's signature
    const c = t.customer(3);
    const cancelled = await t.prepare(c, "cur-key-0005");
    await c(`/api/customer/uses/${cancelled.id}/cancel`, "POST");
    const now = t.w.clock.now;
    const o = customerOperations(t.w.state.store.db, t.w.f.business, 3, new Date(), {
      nowMs: now,
      health: maintenanceHealth(t.w.state.store.db, t.w.f.business, now),
    });
    expect(o.current).toEqual({
      awaiting_settlement: 1,
      needs_attention: 0,
      reserved_not_settled: 1,
      awaiting_reservation: 0,
      awaiting_signature: 1,
    });
    // A preparation past its signing deadline is no longer waiting on anyone.
    const later = customerOperations(t.w.state.store.db, t.w.f.business, 3, new Date(), {
      nowMs: now + 24 * 3_600_000,
      health: null,
    });
    expect(later.current.awaiting_signature).toBe(0);
    // A pass just ran, so the worker reads as running; a day later with no pass it is overdue;
    // without a health reading it is unknown, never assumed.
    expect(o.settlement.worker).toBe("running");
    const dayLater = now + 24 * 3_600_000;
    expect(
      customerOperations(t.w.state.store.db, t.w.f.business, 3, new Date(), {
        nowMs: dayLater,
        health: maintenanceHealth(t.w.state.store.db, t.w.f.business, dayLater),
      }).settlement.worker,
    ).toBe("overdue");
    expect(later.settlement.worker).toBe("unknown");
  });

  it("a running worker is reported as running; stopped and overdue are not", async () => {
    const t = await maintenanceWorld();
    const s = t.supervisor("worker-a", { timers: inert, intervalMs: 1_000 });
    s.start();
    t.sync();
    await s.runPass();
    const db = t.w.state.store.db;
    const read = (ms: number) =>
      customerOperations(db, t.w.f.business, 3, new Date(), {
        nowMs: ms,
        health: maintenanceHealth(db, t.w.f.business, ms),
      }).settlement;
    expect(read(t.w.clock.now)).toMatchObject({ worker: "running" });
    expect(read(t.w.clock.now + 10_000).worker).toBe("overdue");
    await s.stop();
    expect(read(t.w.clock.now).worker).toBe("stopped");
  });
});
