// Job 002d2: a completed pass is not a schedule. Only a current, generation-fenced holder whose
// passes are scheduled (start()) may be reported as running, so only it supports "settles by
// itself". A one-off pass is recorded as a recent pass; a pass in progress is in flight; a pass
// after stop() doesn't restart the schedule; an old health row (before 002d2) is read as not
// scheduled. Controlled clock and counting inert timers; finite.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { maintenanceHealth } from "../src/maintenance.ts";
import type { Json } from "./customer-world.ts";
import { maintenanceWorld } from "./maintenance-world.ts";

function countingTimers() {
  const t = { sets: 0, set: (_fn: () => void, _ms: number) => ++t.sets, clear: () => {} };
  return t;
}

describe("002d2 a one-off pass is not a scheduled worker", () => {
  it("Astra's recipe: runPass without start() promises nothing automatic, anywhere the owner looks", async () => {
    const t = await maintenanceWorld();
    const db = t.w.state.store.db;
    const id = await t.reserve(t.w.cara, "sched-key-0001");
    await t.execute(t.w.cara, id);
    const s = t.supervisor("worker-a", { timers: countingTimers() });
    t.sync();
    expect((await s.runPass()).outcome).toBe("done");
    const h = maintenanceHealth(db, t.w.f.business, t.w.clock.now).worker;
    expect(h.state).toBe("not_scheduled");
    expect(h.last_pass_at).not.toBeNull(); // the pass is still useful evidence
    expect(h.in_flight).toBe(false);
    // The owner's books and readiness say so too.
    const books = await t.w.owner(`/api/businesses/${t.w.f.business}/books?months=3`);
    expect((books.body.operations as Json).settlement.worker).toBe("not_scheduled");
    const ready = await t.w.owner(
      `/api/businesses/${t.w.f.business}/customer-offer-readiness?project=${t.w.f.project}`,
    );
    const item = (ready.body.readiness.items as Json[]).find((i) => i.key === "maintenance");
    expect(item?.state).not.toBe("observed");
    expect(item?.detail).toMatch(/not scheduled/i);
    const desk = await t.w.owner(`/api/businesses/${t.w.f.business}/digital-desk`);
    expect((desk.body as Json).settlement.worker).toBe("not_scheduled");
  });

  it("start() plus a pass is running; stop() ends it; a pass after stop doesn't restart the schedule", async () => {
    const t = await maintenanceWorld();
    const db = t.w.state.store.db;
    const timers = countingTimers();
    const health = () => maintenanceHealth(db, t.w.f.business, t.w.clock.now).worker;
    const s = t.supervisor("worker-a", { timers });
    s.start();
    expect(timers.sets).toBe(1);
    await s.runPass();
    expect(health().state).toBe("running");
    await s.stop();
    expect(health().state).toBe("stopped");
    const setsAfterStop = timers.sets;
    t.advance(1_000);
    expect((await s.runPass()).outcome).toBe("done");
    expect(health().state).toBe("not_scheduled");
    expect(timers.sets).toBe(setsAfterStop); // nothing re-armed
  });

  it("a pass in progress is in flight, and only then", async () => {
    const t = await maintenanceWorld();
    const db = t.w.state.store.db;
    const id = await t.reserve(t.w.cara, "sched-key-0002");
    await t.execute(t.w.cara, id);
    // Synthetic: settle submissions are held until released (then the writer answers normally).
    const held: (() => void)[] = [];
    const original = t.w.writer.settleHold.bind(t.w.writer);
    t.w.writer.settleHold = (...a: Parameters<typeof original>) =>
      new Promise((ok) => {
        held.push(() => ok(original(...a)));
      }) as ReturnType<typeof original>;
    const release = () => {
      t.w.writer.settleHold = original;
      for (const go of held.splice(0)) go();
    };
    const s = t.supervisor("worker-a", { timers: countingTimers() });
    t.sync();
    const pass = s.runPass();
    for (
      let i = 0;
      i < 50 && !maintenanceHealth(db, t.w.f.business, t.w.clock.now).worker.in_flight;
      i++
    )
      await new Promise((ok) => setTimeout(ok, 1));
    expect(maintenanceHealth(db, t.w.f.business, t.w.clock.now).worker).toMatchObject({
      in_flight: true,
      state: "not_scheduled",
    });
    release();
    await pass;
    expect(maintenanceHealth(db, t.w.f.business, t.w.clock.now).worker.in_flight).toBe(false);
  });

  it("an old health row (no schedule fact) is read as not scheduled, and the migration adds none", () => {
    const now = Date.now();
    // A throwaway file database with the pre-002d2 table and a fresh "running" row from an old build.
    const dir = mkdtempSync(join(tmpdir(), "everstreet-002d2-"));
    const path = join(dir, "old.db");
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE maintenance_status (
      name TEXT PRIMARY KEY, holder TEXT, state TEXT NOT NULL CHECK (state IN ('running','stopped')),
      interval_ms INTEGER NOT NULL, started_ms INTEGER, heartbeat_ms INTEGER, last_pass_ms INTEGER,
      last_pass TEXT) STRICT`);
    old
      .prepare(
        "INSERT INTO maintenance_status (name, holder, state, interval_ms, started_ms, heartbeat_ms, last_pass_ms, last_pass) VALUES ('customer-maintenance', 'old', 'running', 30000, ?, ?, ?, '{\"outcome\":\"done\"}')",
      )
      .run(now, now, now);
    old.close();
    const migrated = openDb(path);
    try {
      const h = maintenanceHealth(migrated, "no-such-business", now).worker;
      expect(h.state).toBe("not_scheduled");
      expect(h.last_pass_at).toBe(new Date(now).toISOString());
      expect(h.in_flight).toBe(false);
    } finally {
      migrated.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
