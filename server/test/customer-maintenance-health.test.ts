// Job 002d1: truthful worker health and fairness across phases. Reproduces Astra's two
// independent failures at 7c9f683 with her exact recipes (a standby stopping made the active
// worker look stopped; a repeatedly slow settlement phase starved expired-result cleanup), plus
// overdue standby, takeover with a late finish, and a continuing backlog across passes. Controlled
// clock and inert timers; finite.

import { describe, expect, it } from "vitest";
import { maintenanceHealth } from "../src/maintenance.ts";
import { DAY, maintenanceWorld } from "./maintenance-world.ts";

const inert = { set: () => 1, clear: () => {} };

describe("002d1 health is written only by the active lease holder", () => {
  it("Astra's recipe: active A, standby B starts, passes and stops; A still reads running", async () => {
    const t = await maintenanceWorld();
    const db = t.w.state.store.db;
    const health = () => maintenanceHealth(db, t.w.f.business, t.w.clock.now).worker.state;
    const a = t.supervisor("worker-a", { timers: inert });
    const b = t.supervisor("worker-b", { timers: inert });
    a.start();
    await a.runPass();
    b.start();
    expect((await b.runPass()).outcome).toBe("standby");
    await b.stop();
    expect(health()).toBe("running");
    await a.stop();
    expect(health()).toBe("stopped");
  });

  it("starting proves nothing: no heartbeat until a holder finishes a pass", async () => {
    const t = await maintenanceWorld();
    const a = t.supervisor("worker-a", { timers: inert });
    a.start();
    expect(maintenanceHealth(t.w.state.store.db, t.w.f.business, t.w.clock.now).worker.state).toBe(
      "not_started",
    );
    await a.runPass();
    expect(
      maintenanceHealth(t.w.state.store.db, t.w.f.business, t.w.clock.now).worker,
    ).toMatchObject({ state: "running", last_outcome: "done" });
    await a.stop();
  });

  it("a standby starting again and again can't make an overdue holder look fresh; takeover can", async () => {
    const t = await maintenanceWorld();
    const db = t.w.state.store.db;
    const health = () => maintenanceHealth(db, t.w.f.business, t.w.clock.now).worker;
    const a = t.supervisor("worker-a", { timers: inert, intervalMs: 30_000, leaseMs: 600_000 });
    // 002d2: A is a scheduled worker (start), so its staleness reads as overdue.
    a.start();
    await a.runPass(); // A holds a long lease, then stalls
    const b = t.supervisor("worker-b", { timers: inert, intervalMs: 30_000, leaseMs: 600_000 });
    for (let i = 0; i < 5; i++) {
      t.advance(30_000);
      b.start();
      expect((await b.runPass()).outcome).toBe("standby");
      await b.stop();
    }
    expect(health().state).toBe("overdue");
    t.advance(500_000); // A's lease lapses
    b.start(); // a scheduled standby takes over
    expect((await b.runPass()).outcome).toBe("done");
    expect(health().state).toBe("running");
    // A comes back late: its pass is standby and its stop changes nothing.
    expect((await a.runPass()).outcome).toBe("standby");
    await a.stop();
    expect(health().state).toBe("running");
  });

  it("a pass that loses its lease mid-way publishes neither its outcome nor its backoff", async () => {
    const t = await maintenanceWorld();
    const id = await t.reserve(t.w.cara, "late-key-0001");
    await t.execute(t.w.cara, id);
    const db = t.w.state.store.db;
    const uses = t.w.service();
    const a = t.supervisor("worker-a", { timers: inert, leaseMs: 1_000 }, uses);
    // While A's settlement is in flight, A's lease lapses and B takes over.
    let b: ReturnType<typeof t.supervisor> | null = null;
    uses.settleOne = async () => {
      t.advance(5_000);
      b = t.supervisor("worker-b", { timers: inert, leaseMs: 60_000 });
      await b.runPass();
      return "read_failed"; // A would back this off, if it still held the lease
    };
    const r = await a.runPass();
    expect(r.outcome).toBe("lease_lost");
    const backoff = db
      .prepare(
        "SELECT COUNT(*) AS n FROM maintenance_backoff WHERE subject = ? AND code = 'read_failed'",
      )
      .get(id) as { n: number };
    expect(backoff.n).toBe(0);
    const status = db.prepare("SELECT holder FROM maintenance_status").get() as { holder: string };
    expect(status.holder).toBe("worker-b");
  });
});

describe("002d1 fairness across phases, durably", () => {
  it("Astra's recipe: a repeatedly slow settlement phase doesn't starve expired-result cleanup", async () => {
    const t = await maintenanceWorld();
    const id = await t.reserve(t.w.cara, "slow-key-0001");
    await t.execute(t.w.cara, id);
    t.advance(31 * DAY);
    const uses = t.w.service();
    uses.settleOne = async () => {
      t.advance(21);
      return "not_decidable";
    };
    const s = t.supervisor(
      "worker-a",
      { passBudgetMs: 20, backoffBaseMs: 1, backoffMaxMs: 1, timers: inert },
      uses,
    );
    for (let i = 0; i < 4; i++) {
      await s.runPass();
      t.advance(2);
    }
    const st = t.w.state.store.db
      .prepare("SELECT result_state FROM customer_executions WHERE request_id = ?")
      .get(id) as { result_state: string };
    expect(st.result_state).toBe("deleted");
  });

  it("a phase that had work but no budget left goes first in the very next pass", async () => {
    const t = await maintenanceWorld();
    const id = await t.reserve(t.w.cara, "next-key-0001");
    await t.execute(t.w.cara, id);
    t.advance(31 * DAY);
    const uses = t.w.service();
    uses.settleOne = async () => {
      t.advance(21);
      return "not_decidable";
    };
    const s = t.supervisor(
      "worker-a",
      { passBudgetMs: 20, backoffBaseMs: 1, backoffMaxMs: 1, timers: inert },
      uses,
    );
    const first = await s.runPass();
    expect(first.skipped).toContain("result:budget");
    t.advance(2);
    const second = await s.runPass();
    expect(second.counts["result:deleted"]).toBe(1);
  });

  it("the rotation survives a restart: a new instance doesn't hand the busy early phase every pass", async () => {
    const t = await maintenanceWorld();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const who = t.customer(i);
      const id = await t.reserve(who, `rot-key-${i}000`);
      await t.execute(who, id);
      ids.push(id);
    }
    t.advance(31 * DAY);
    const slow = () => {
      const u = t.w.service();
      u.settleOne = async () => {
        t.advance(21);
        return "not_decidable";
      };
      return u;
    };
    const deleted = () =>
      (
        t.w.state.store.db
          .prepare("SELECT COUNT(*) AS n FROM customer_executions WHERE result_state = 'deleted'")
          .get() as { n: number }
      ).n;
    // Each pass is a fresh instance (a restart), batch 1, budget consumed by settlement.
    for (let i = 0; i < 9 && deleted() < 3; i++) {
      const s = t.supervisor(
        `worker-${i}`,
        {
          passBudgetMs: 20,
          backoffBaseMs: 1,
          backoffMaxMs: 1,
          batch: 1,
          timers: inert,
          leaseMs: 100,
        },
        slow(),
      );
      await s.runPass();
      t.advance(101); // that process is gone; its lease lapses before the next one starts
    }
    expect(deleted()).toBe(3);
  });
});
