// Job 003wf3 (Astra 03:18): the coordinator's bounded passes visit every configured business in
// turn, even when the first is always busy, always needs attention, or uses up the pass budget.
// Scheduler-only: the business step is replaced; no chain or ownership outcome is simulated.

import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { type CloserKey, HandoverCoordinator } from "../src/handoverCoordinator.ts";

const IDS = ["business-a", "business-b", "business-c", "business-d"];
function coordinator(o: { batch: number; passBudgetMs?: number }) {
  const db = openDb(":memory:");
  const c = new HandoverCoordinator(
    db,
    {} as never,
    {} as never,
    null,
    {} as never,
    new Map(IDS.map((id) => [id, {} as CloserKey])),
    {
      holder: "fairness",
      intervalMs: 100,
      batch: o.batch,
      passBudgetMs: o.passBudgetMs ?? 1_000,
      opDeadlineMs: o.passBudgetMs ?? 500,
      dispatchMarginMs: 1000,
      maxOrders: 2,
    },
  );
  return { c, db };
}

describe("003wf3 the coordinator visits every business in turn", () => {
  it("a first business that always needs attention doesn't hold the front", async () => {
    const { c, db } = coordinator({ batch: 2 });
    const seen: string[] = [];
    c.step = async (id) => {
      seen.push(id);
      return id === "business-a" ? "attention" : "idle";
    };
    for (let i = 0; i < 4; i++) await c.pass();
    expect([...new Set(seen)].sort()).toEqual(IDS);
    // Each business at most every other pass: a strict rotation.
    expect(seen).toEqual([...IDS, ...IDS]);
    await c.stop();
    db.close();
  });

  it("a first business whose step is still running is reported busy and the others are visited", async () => {
    const { c, db } = coordinator({ batch: 2 });
    const seen: string[] = [];
    const ops = (c as unknown as { ops: Map<string, unknown> }).ops;
    ops.set("business-a", { gen: 1, dead: true, done: new Promise(() => {}) });
    c.step = async (id) => {
      seen.push(id);
      return "idle";
    };
    const reports: Record<string, string>[] = [];
    for (let i = 0; i < 4; i++) reports.push(await c.pass());
    expect(reports.some((r) => r["business-a"] === "busy")).toBe(true);
    expect([...new Set(seen)].sort()).toEqual(["business-b", "business-c", "business-d"]);
    ops.delete("business-a");
    await c.stop();
    db.close();
  });

  it("when the pass budget is used up by the first step, the skipped businesses come first next time", async () => {
    const { c, db } = coordinator({ batch: 4, passBudgetMs: 30 });
    const seen: string[] = [];
    c.step = async (id) => {
      seen.push(id);
      await new Promise((r) => setTimeout(r, 40)); // longer than the whole pass budget
      return "idle";
    };
    const reports: Record<string, string>[] = [];
    for (let i = 0; i < 4; i++) reports.push(await c.pass());
    expect(reports[0]).toMatchObject({ "business-b": "budget" });
    expect(seen.slice(0, 4).sort()).toEqual(IDS);
    await c.stop();
    db.close();
  });
});
