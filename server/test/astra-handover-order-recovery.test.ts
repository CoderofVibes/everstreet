// Astra independent review: persist a close order, then interrupt immediately before the
// writer is called. This is a deterministic service-boundary cut, not a process-kill test.
// Real configured composition, coordinator, encoded synthetic chain and V3Intents thereafter.
import { describe, expect, it } from "vitest";
import { handoverWorld } from "./handoverWorld.ts";
import { FOUNDER } from "./lifecycleWorld.ts";

describe("Astra close-order recovery", () => {
  it("dispatches the original durable order after interruption before any writer attempt", async () => {
    const w = await handoverWorld();
    try {
      await w.toBuyerAccepted();
      const accepted = await w.act(w.seller, FOUNDER, "accept");
      expect(accepted.check?.body.resolution).toMatchObject({ result: "closing" });
      const seam = w.coordinator as unknown as {
        dispatch: (...args: unknown[]) => Promise<string>;
      };
      const dispatch = seam.dispatch;
      seam.dispatch = async () => "review_interruption_before_writer";
      try {
        expect((await w.coordinator.pass())[w.biz]).toBe("review_interruption_before_writer");
      } finally {
        seam.dispatch = dispatch;
      }
      expect(w.rows("SELECT n FROM close_orders")).toEqual([{ n: 1 }]);
      expect(w.rows("SELECT state FROM closer_tx_attempts")).toEqual([]);
      const states: string[] = [];
      for (let i = 0; i < 6 && w.handoverRow()?.state !== "released_to_buyer"; i++) {
        states.push(String((await w.coordinator.pass())[w.biz]));
      }
      expect(w.handoverRow()?.state, states.join(", ")).toBe("released_to_buyer");
      expect(w.rows("SELECT n FROM close_orders")).toEqual([{ n: 1 }]);
      expect(w.b.rpc.applied.filter((x) => x.method === "close_sale")).toHaveLength(1);
      expect(w.rows("SELECT state FROM closer_tx_attempts")).toEqual([{ state: "success" }]);
    } finally {
      await w.cleanup();
    }
  }, 60_000);
});
