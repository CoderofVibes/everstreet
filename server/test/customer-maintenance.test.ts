// Job 002d: the customer maintenance supervisor. It advances already-authorized obligations
// through the existing fenced operations and never prepares, signs, re-runs a provider call or
// grants itself authority. Real app on the labelled fixture chain, scripted runtime and synthetic
// protection; injected clock and timers. Finite: every wait is bounded by a deadline or a gate
// the test opens, and every fixture keeps its own ceilings.

import { describe, expect, it } from "vitest";
import { guardAdapters, maintenanceHealth, type Timers } from "../src/maintenance.ts";
import type { Json } from "./customer-world.ts";
import { DAY, maintenanceWorld } from "./maintenance-world.ts";

describe("002d it advances customer obligations without a customer click", () => {
  it("a completed use is charged; an unused reservation is returned; an unsigned preparation only expires", async () => {
    const t = await maintenanceWorld();
    const used = await t.reserve(t.w.cara, "auto-key-used");
    await t.execute(t.w.cara, used);
    const provider = t.w.provider.calls.length;
    const s = t.supervisor();
    for (let i = 0; i < 4 && t.unit(used) !== "charged"; i++) {
      t.sync();
      await s.runPass();
    }
    expect([t.unit(used), t.w.chain.charged, t.w.writer.settleCalls]).toEqual(["charged", 1, 1]);
    // A reservation that never ran: returned once its serving window has passed.
    const b = t.customer(0);
    const unused = await t.reserve(b, "auto-key-unused");
    // An unsigned preparation: it can only expire; nothing is ever submitted for it.
    const c = t.customer(1);
    const unsigned = await t.prepare(c, "auto-key-unsigned");
    const opens = t.w.writer.calls;
    t.advance(11 * 60_000);
    for (let i = 0; i < 4 && t.unit(unused) !== "returned"; i++) {
      t.sync();
      await s.runPass();
    }
    expect(t.unit(unused)).toBe("returned");
    expect(t.requestState(unsigned.id)).toBe("expired");
    expect(t.w.writer.calls - opens).toBe(1); // the one release; no open_hold for the unsigned
    expect(t.w.provider.calls.length).toBe(provider); // nothing re-run, ever
    // The customer sees the outcome from the records, not from the worker.
    const v = (await t.w.cara(`/api/customer/uses/${used}`)).body.use;
    expect(v.units).toMatchObject({ unit: "charged", source: { observed: { consumed: "1" } } });
  });

  it("an uncertain provider run is never re-run: its unit is released, never charged", async () => {
    const t = await maintenanceWorld();
    const id = await t.reserve(t.w.cara, "unk-key-0001");
    t.w.provider.script = async () => {
      throw new Error("synthetic: the provider's answer was lost");
    };
    t.sync();
    await t.w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    const calls = t.w.provider.calls.length;
    const s = t.supervisor();
    for (let i = 0; i < 4 && t.unit(id) !== "returned"; i++) {
      t.sync();
      await s.runPass();
    }
    expect(t.unit(id)).toBe("returned");
    expect(t.w.chain.charged).toBe(0);
    expect(t.w.provider.calls.length).toBe(calls);
  });
});

describe("002d coordination: one active supervisor, fenced work, restart", () => {
  it("a second instance stands by while the first holds the lease, and takes over when it lapses", async () => {
    const t = await maintenanceWorld();
    const a = t.supervisor("worker-a", { leaseMs: 60_000 });
    const b = t.supervisor("worker-b", { leaseMs: 60_000 });
    expect((await a.runPass()).outcome).toBe("done");
    expect((await b.runPass()).outcome).toBe("standby");
    expect((await a.runPass()).outcome).toBe("done"); // renewal
    t.advance(61_000); // worker-a stopped renewing (a crash)
    expect((await b.runPass()).outcome).toBe("done");
    expect((await a.runPass()).outcome).toBe("standby");
  });

  it("two uncoordinated workers racing on one unit still settle it once", async () => {
    const t = await maintenanceWorld();
    const id = await t.reserve(t.w.cara, "race-key-0001");
    await t.execute(t.w.cara, id);
    // Different coordination names: no shared lease, only the per-request fencing.
    const a = t.supervisor("worker-a", { name: "x" }, t.w.service());
    const b = t.supervisor("worker-b", { name: "y" }, t.w.service());
    for (let i = 0; i < 3; i++) {
      t.sync();
      await Promise.all([a.runPass(), b.runPass()]);
    }
    expect([t.unit(id), t.w.chain.charged, t.w.writer.settleCalls]).toEqual(["charged", 1, 1]);
  });

  it("a stalled worker's late answer records nothing; the next worker finishes the unit once", async () => {
    const t = await maintenanceWorld();
    const id = await t.reserve(t.w.cara, "stale-key-0001");
    await t.execute(t.w.cara, id);
    const gate = t.w.writer.holdNextUnit(); // worker-a's settle waits inside the writer
    const a = t.supervisor("worker-a", { opDeadlineMs: 30, leaseMs: 1_000 });
    t.sync();
    const pa = await a.runPass();
    expect(pa.counts["settle:timeout"]).toBe(1);
    // worker-a is gone; its per-request and supervisor leases lapse.
    t.advance(31_000);
    const b = t.supervisor("worker-b", { leaseMs: 1_000 }, t.w.service());
    for (let i = 0; i < 4 && t.unit(id) !== "charged"; i++) {
      t.advance(11_000); // past any backoff
      await b.runPass();
    }
    expect(t.unit(id)).toBe("charged");
    gate.open(); // worker-a's call returns at last
    await new Promise((r) => setTimeout(r, 20));
    expect(t.w.chain.charged).toBe(1);
    const late = t.w.state.store.db
      .prepare(
        "SELECT COUNT(*) AS n FROM customer_request_events WHERE request_id = ? AND kind = 'unit_writer_answer' AND lease_gen = 1",
      )
      .get(id) as { n: number };
    expect(late.n).toBe(0); // the stale lease's answer was never recorded
  });

  it("a restarted process (new instances, same database) resumes the work", async () => {
    const t = await maintenanceWorld();
    const id = await t.reserve(t.w.cara, "restart-key-01");
    await t.execute(t.w.cara, id);
    const gate = t.w.writer.holdNextUnit();
    const before = t.supervisor("process-1", { opDeadlineMs: 30, leaseMs: 1_000 });
    t.sync();
    await before.runPass(); // dies mid-call
    t.advance(31_000);
    const after = t.supervisor("process-2", { leaseMs: 1_000 }, t.w.service());
    for (let i = 0; i < 4 && t.unit(id) !== "charged"; i++) {
      t.advance(11_000);
      await after.runPass();
    }
    expect(t.unit(id)).toBe("charged");
    gate.open();
    await new Promise((r) => setTimeout(r, 20));
    expect(t.w.chain.charged).toBe(1);
  });
});

describe("002d lifecycle and resource bounds", () => {
  /** Manual timers: the test decides when a scheduled callback runs. */
  function manualTimers() {
    const q: { fn: () => void; ms: number; id: number }[] = [];
    let n = 0;
    const timers: Timers = {
      set: (fn, ms) => {
        const id = ++n;
        q.push({ fn, ms, id });
        return id;
      },
      clear: (h) => {
        const i = q.findIndex((x) => x.id === h);
        if (i >= 0) q.splice(i, 1);
      },
    };
    /** Runs the earliest scheduled callback (passes use their own deadlines separately). */
    const fire = () => {
      q.sort((a, b) => a.ms - b.ms);
      const next = q.shift();
      next?.fn();
      return Boolean(next);
    };
    return { timers, q, fire };
  }

  it("start schedules passes without overlap; stop drains and ends scheduling", async () => {
    const t = await maintenanceWorld();
    const m = manualTimers();
    const s = t.supervisor("worker-a", { timers: m.timers, intervalMs: 30_000 });
    expect(maintenanceHealth(t.w.state.store.db, t.w.f.business, t.w.clock.now).worker.state).toBe(
      "not_started",
    );
    s.start();
    s.start(); // idempotent
    // 002d1: starting proves nothing; health appears only once a holder's pass runs.
    expect(maintenanceHealth(t.w.state.store.db, t.w.f.business, t.w.clock.now).worker.state).toBe(
      "not_started",
    );
    const passTimer = m.q.find((x) => x.ms === 0);
    expect(passTimer).toBeDefined();
    m.fire(); // the first pass starts
    expect((await s.runPass()).outcome).toBe("busy"); // no overlap with the scheduled one
    expect(maintenanceHealth(t.w.state.store.db, t.w.f.business, t.w.clock.now).worker.state).toBe(
      "running",
    );
    await s.stop();
    expect(m.q.filter((x) => x.ms === 30_000)).toHaveLength(0); // nothing more scheduled
    expect(maintenanceHealth(t.w.state.store.db, t.w.f.business, t.w.clock.now).worker.state).toBe(
      "stopped",
    );
  });

  it("stop during a hanging operation resolves by its deadline, not when the adapter returns", async () => {
    const t = await maintenanceWorld();
    const id = await t.reserve(t.w.cara, "stop-key-0001");
    await t.execute(t.w.cara, id);
    const gate = t.w.writer.holdNextUnit();
    const s = t.supervisor("worker-a", { opDeadlineMs: 40 });
    t.sync();
    const pass = s.runPass();
    await gate.entered;
    const began = Date.now();
    await s.stop();
    expect(Date.now() - began).toBeLessThan(2_000);
    expect((await pass).outcome).toMatch(/stopped|done/);
    gate.open();
  });

  it("an uncooperative adapter that never answers can't accumulate calls beyond its cap", async () => {
    const t = await maintenanceWorld({ customer: { writeTimeoutMs: 20 } });
    for (let i = 0; i < 4; i++) {
      const who = t.customer(i);
      const id = await t.reserve(who, `hang-key-${i}000`);
      await t.execute(who, id);
    }
    // A writer whose settle never settles and ignores its abort signal.
    t.w.writer.settleHold = () => new Promise(() => {});
    const g = guardAdapters(
      { reader: t.w.reader, writer: t.w.writer, operatorAccount: "meter.near" },
      2,
    );
    const uses = t.w.service((o) => ({ ...o, reader: g.options.reader, writer: g.options.writer }));
    const s = t.supervisor("worker-a", { opDeadlineMs: 50, batch: 2 }, uses, g.guards);
    let saturated = 0;
    for (let i = 0; i < 6; i++) {
      t.advance(31_000); // per-request leases and backoff lapse: work is eligible again
      const r = await s.runPass();
      if (r.skipped.includes("settle:adapter_saturated")) saturated++;
      // The guard is checked before each phase: at most cap + batch − 1 calls are ever stuck.
      expect(g.guards.chain.outstanding).toBeLessThanOrEqual(2 + 2 - 1);
    }
    expect(saturated).toBeGreaterThan(0);
    expect(t.w.chain.charged).toBe(0);
  });
});

describe("002d cleanup, unavailable adapters and delivery timeout", () => {
  it("cleanup deletes only under this storage's scheme; a missing capability is reported, not faked", async () => {
    const t = await maintenanceWorld();
    const id = await t.reserve(t.w.cara, "scheme-key-01");
    await t.execute(t.w.cara, id);
    const b = t.customer(0);
    const other = await t.reserve(b, "scheme-key-02");
    await t.execute(b, other);
    t.w.state.store.db
      .prepare(
        "UPDATE customer_executions SET result_scheme = 'another-scheme' WHERE request_id = ?",
      )
      .run(other);
    t.advance(31 * DAY);
    const s = t.supervisor();
    await s.runPass();
    const st = (r: string) =>
      (
        t.w.state.store.db
          .prepare("SELECT result_state FROM customer_executions WHERE request_id = ?")
          .get(r) as { result_state: string }
      ).result_state;
    expect([st(id), st(other)]).toEqual(["deleted", "stored"]);
    // Retention refuses the read either way.
    expect((await b(`/api/customer/uses/${other}/result`)).body.code).toBe("result_expired");
    // Without deletion, the phases say so.
    const none = await maintenanceWorld({
      customer: { protection: { scheme: "none", protect: async () => "r" } as never },
    });
    const r = await none.supervisor().runPass();
    expect(r.skipped).toEqual(
      expect.arrayContaining(["result:deletion_unavailable", "input:deletion_unavailable"]),
    );
  });

  it("without a writer, the local work still runs and nothing breaks", async () => {
    const t = await maintenanceWorld({ noWriter: true });
    const u = await t.prepare(t.w.cara, "nowriter-key-1");
    t.advance(8 * 60_000); // past its sign-by time (serve window 10 min, less the margins)
    const r = await t.supervisor().runPass();
    expect(r.outcome).toBe("done");
    expect(t.requestState(u.id)).toBe("expired");
  });

  it("a result that never finishes protecting is released after the delivery timeout, never charged", async () => {
    const t = await maintenanceWorld({ customer: { deliveryTimeoutMs: 60_000 } });
    const id = await t.reserve(t.w.cara, "deliv-key-0001");
    const gate = t.protection.holdResults();
    t.sync();
    const running = t.w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
    await gate.entered;
    const s = t.supervisor();
    t.sync();
    await s.runPass();
    expect(t.unit(id)).toBeNull(); // still protecting: undecidable, nothing decided
    t.advance(61_000);
    for (let i = 0; i < 4 && t.unit(id) !== "returned"; i++) {
      t.advance(11_000);
      await s.runPass();
    }
    expect(t.unit(id)).toBe("returned");
    gate.open();
    await running;
    expect(t.w.chain.charged).toBe(0);
  });
});

describe("002d sale: authority pauses metering honestly; cleanup continues; re-appointment resumes once", () => {
  it("revoked platform metering pauses the charge, cleanup still runs, re-appointment charges once", async () => {
    const t = await maintenanceWorld();
    const id = await t.reserve(t.w.cara, "sale-key-0001");
    await t.execute(t.w.cara, id);
    const b = t.customer(0);
    const cancelled = await t.prepare(b, "sale-key-0002");
    await b(`/api/customer/uses/${cancelled.id}/cancel`, "POST");
    // A sale: the business changes hands; the contract granted METERING only to meter2.
    const buyer = t.w.person("Noah Fenn");
    t.w.rw.transfer(t.w.f.business, t.w.f.ava.id, buyer.id);
    t.w.chain.afterSale();
    const s = t.supervisor();
    t.sync();
    const r = await s.runPass();
    expect(r.counts["settle:operator_not_authorized"]).toBe(1);
    const input = t.w.state.store.db
      .prepare("SELECT input_ref FROM customer_requests WHERE id = ?")
      .get(cancelled.id) as { input_ref: string | null };
    expect(input.input_ref).toBeNull(); // cleanup didn't need metering
    expect(maintenanceHealth(t.w.state.store.db, t.w.f.business, t.w.clock.now).work).toMatchObject(
      {
        paused_by_authority: 1,
      },
    );
    t.w.chain.reappointPlatform(); // the new owner's appoint_operator, on the contract
    for (let i = 0; i < 5 && t.unit(id) !== "charged"; i++) {
      t.advance(21_000);
      await s.runPass();
    }
    expect([t.unit(id), t.w.chain.charged, t.w.writer.settleCalls]).toEqual(["charged", 1, 1]);
  });
});

describe("002d owner-safe health in readiness", () => {
  it("the owner sees worker state and this business's counts only; a former owner sees nothing", async () => {
    const t = await maintenanceWorld();
    const read = async (who = t.w.owner) =>
      who(`/api/businesses/${t.w.f.business}/customer-offer-readiness?project=${t.w.f.project}`);
    const item = async (key: string, who = t.w.owner) =>
      ((await read(who)).body.readiness.items as Json[]).find((i) => i.key === key);
    expect(await item("maintenance")).toMatchObject({ state: "unavailable" });
    const m = { set: () => 0, clear: () => {} };
    const s = t.supervisor("worker-a", { timers: m, intervalMs: 30_000 });
    s.start();
    await s.runPass();
    const running = (await item("maintenance")) as Json;
    expect(running.state).toBe("observed");
    expect(running.detail).toMatch(/A heartbeat doesn't show every connected service is healthy/);
    expect(await item("cleanup")).toMatchObject({ state: "observed" });
    t.advance(4 * 30_000); // no heartbeat for over three intervals
    expect(await item("maintenance")).toMatchObject({ state: "unknown" });
    expect(JSON.stringify((await read()).body)).not.toMatch(/ref-|input_ref|Stackline/);
    const buyer = t.w.person("Noah Fenn");
    t.w.rw.transfer(t.w.f.business, t.w.f.ava.id, buyer.id);
    expect((await read()).status).toBe(404);
    await s.stop();
    expect(await item("maintenance", buyer)).toMatchObject({ state: "unavailable" });
  });
});
