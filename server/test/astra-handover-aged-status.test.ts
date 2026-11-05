// Astra review: a late authoritative answer can settle an old attempt without resending it.
// Real configured coordinator/writer/V3Intents over a synthetic chain. No ownership SQL.
import { describe, expect, it } from "vitest";
import { handoverWorld } from "./handoverWorld.ts";
import { FOUNDER } from "./lifecycleWorld.ts";

describe("Astra aged close-attempt evidence", () => {
  it("reads a recovered original transaction result after order expiry without another broadcast", async () => {
    const w = await handoverWorld();
    const answer = w.b.rpc.answer.bind(w.b.rpc);
    let hideStatus = true;
    let statusReads = 0;
    w.b.rpc.answer = async (raw) => {
      const req = JSON.parse(raw) as { method: string; id: unknown };
      if (req.method === "tx") {
        statusReads++;
        if (hideStatus)
          return JSON.stringify({
            jsonrpc: "2.0",
            id: req.id,
            error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_TRANSACTION", info: {} } },
          });
      }
      return answer(raw);
    };
    try {
      // Wallet action checks use their own synthetic sale view; hide only closer status once
      // the ordinary parties have started the closing.
      hideStatus = false;
      await w.toBuyerAccepted();
      expect((await w.act(w.seller, FOUNDER, "accept")).check?.body.resolution).toMatchObject({
        result: "closing",
      });
      hideStatus = true;
      w.b.rpc.loseNextSendAnswer("close_sale");
      await w.coordinator.pass(); // the original lands, its answer is lost
      w.b.rpc.dropSend = (method) => method === "close_sale";
      for (let i = 0; i < 8 && w.handoverRow()?.state !== "released_to_buyer"; i++)
        await w.coordinator.pass();
      expect(w.handoverRow()?.state).toBe("released_to_buyer");
      expect(w.rows("SELECT state FROM closer_tx_attempts")).toEqual([{ state: "signed" }]);
      expect(w.b.rpc.applied.filter((a) => a.method === "close_sale")).toHaveLength(1);
      w.b.w.chain.tick(21n * 60_000n);
      hideStatus = false; // the RPC can finally show this exact transaction's final result
      const reads = statusReads;
      const sends = w.b.rpc.sends;
      for (let i = 0; i < 4; i++) await w.coordinator.pass();
      expect(w.b.rpc.sends).toBe(sends);
      expect(statusReads).toBeGreaterThan(reads);
      expect(w.rows("SELECT state FROM closer_tx_attempts")).toEqual([{ state: "success" }]);
      expect(w.handoverRow()?.state).toBe("released_to_buyer");
      expect(w.rows("SELECT 1 FROM ownership WHERE business_id = ?", w.biz)).toHaveLength(1);
    } finally {
      w.b.rpc.answer = answer;
      await w.cleanup();
    }
  }, 60_000);
});
