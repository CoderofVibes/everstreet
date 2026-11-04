// Job 002d: fairness of the maintenance supervisor, proved with bounded passes (not by repeating
// its SQL). Undecidable, failing or not-yet-deletable work older than eligible work must not
// starve it. These failed against a first version that drove the existing batch methods
// (reconcileDue/settleDue/expireResults/expireInputs) and pass with fair selection and backoff.

import { describe, expect, it } from "vitest";
import { DAY, maintenanceWorld } from "./maintenance-world.ts";

describe("002d fair selection: older stuck work never starves eligible work", () => {
  it("undecidable reservations older than a decidable one: it settles within bounded passes", async () => {
    const t = await maintenanceWorld();
    // Four reserved, never-run requests (undecidable while their serve window is open)...
    for (let i = 0; i < 4; i++) await t.reserve(t.customer(i), `fair-key-${i}000`);
    // ...then the newest, which ran and was delivered (decidable: charge).
    const id = await t.reserve(t.w.cara, "fair-key-cara");
    await t.execute(t.w.cara, id);
    const s = t.supervisor();
    for (let i = 0; i < 5 && t.unit(id) !== "charged"; i++) {
      t.sync();
      await s.runPass();
    }
    expect(t.unit(id)).toBe("charged");
    expect(t.w.chain.charged).toBe(1);
  });

  it("result deletions that keep failing don't fill every batch", async () => {
    const t = await maintenanceWorld();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const who = t.customer(i);
      const id = await t.reserve(who, `res-key-${i}000`);
      await t.execute(who, id);
      ids.push(id);
    }
    const refs = ids.map(
      (id) =>
        (
          t.w.state.store.db
            .prepare("SELECT result_ref FROM customer_executions WHERE request_id = ?")
            .get(id) as { result_ref: string }
        ).result_ref,
    );
    // The three oldest results can't be deleted (a synthetic storage fault on those refs).
    const failing = new Set(refs.slice(0, 3));
    const del = t.protection.delete.bind(t.protection);
    t.protection.delete = async (ref: string) => {
      if (failing.has(ref)) throw new Error("synthetic delete failure");
      return del(ref);
    };
    t.w.clock.now += 31 * DAY;
    const s = t.supervisor();
    for (let i = 0; i < 4; i++) await s.runPass();
    const state = (id: string) =>
      (
        t.w.state.store.db
          .prepare("SELECT result_state FROM customer_executions WHERE request_id = ?")
          .get(id) as { result_state: string }
      ).result_state;
    expect(state(ids[3] as string)).toBe("deleted");
    // Failures are never counted as deletions.
    for (const id of ids.slice(0, 3)) expect(state(id)).toBe("stored");
  });

  it("a deletable input behind more than two hundred that can't be deleted yet is reached", async () => {
    const t = await maintenanceWorld();
    const first = await t.prepare(t.customer(0), "inp-key-0000");
    // Synthetic backlog: 205 copies of that real prepared request (new ids and keys, no
    // allocation, their own input references), all older and none deletable yet. Built in SQL
    // because the fixture reader's own read ceiling bounds how many real preparations a test makes.
    const db = t.w.state.store.db;
    const cols = (db.prepare("PRAGMA table_info(customer_requests)").all() as { name: string }[])
      .map((c) => c.name)
      .filter(
        (c) => !["id", "idempotency_key", "allocation", "input_ref", "created_at"].includes(c),
      );
    for (let i = 0; i < 205; i++)
      db.prepare(
        `INSERT INTO customer_requests (id, idempotency_key, allocation, input_ref, created_at, ${cols.join(", ")})
         SELECT ?, ?, NULL, ?, ?, ${cols.join(", ")} FROM customer_requests WHERE id = ?`,
      ).run(
        `synthetic-${i}`,
        `synthetic-key-${String(i).padStart(4, "0")}`,
        `synthetic-ref-${i}`,
        `2026-11-01T00:00:${String(i % 60).padStart(2, "0")}.${String(i).padStart(3, "0")}Z`,
        first.id,
      );
    const u = await t.prepare(t.w.cara, "inp-key-cara");
    await t.w.cara(`/api/customer/uses/${u.id}/cancel`, "POST");
    const s = t.supervisor();
    await s.runPass();
    const ref = db.prepare("SELECT input_ref FROM customer_requests WHERE id = ?").get(u.id) as {
      input_ref: string | null;
    };
    expect(ref.input_ref).toBeNull();
  });
});
