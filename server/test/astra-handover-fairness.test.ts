// Astra review: a bounded coordinator must eventually inspect every configured business,
// including one whose Closing state has not yet been observed locally. Scheduler-only proof:
// replace the business step, not the scheduler; no chain or ownership outcome is simulated.
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { type CloserKey, HandoverCoordinator } from "../src/handoverCoordinator.ts";

describe("Astra handover scheduling", () => {
  it("an idle prefix does not permanently starve configured businesses beyond the batch", async () => {
    const db = openDb(":memory:");
    const visited: string[] = [];
    const coordinator = new HandoverCoordinator(
      db,
      {} as never,
      {} as never,
      null,
      {} as never,
      new Map(["business-a", "business-b", "business-c"].map((id) => [id, {} as CloserKey])),
      {
        holder: "astra-fairness",
        intervalMs: 100,
        batch: 1,
        passBudgetMs: 100,
        opDeadlineMs: 50,
        dispatchMarginMs: 1000,
        maxOrders: 2,
      },
    );
    coordinator.step = async (id) => {
      visited.push(id);
      return "idle";
    };
    try {
      for (let pass = 0; pass < 6; pass++) {
        const before = visited.length;
        await coordinator.pass();
        expect(visited.length - before).toBeLessThanOrEqual(1);
      }
      expect([...new Set(visited)].sort(), visited.join(", ")).toEqual([
        "business-a",
        "business-b",
        "business-c",
      ]);
    } finally {
      await coordinator.stop();
      db.close();
    }
  });
});
