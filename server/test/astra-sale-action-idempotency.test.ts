// Astra: a retried action must retain its reviewed terms even when two create requests race.
// Actual in-process routes over the existing fictional sale world; no wallet call is made.
import { describe, expect, it } from "vitest";
import { proposal, saleWorld } from "./sale-world.ts";

describe("sale action idempotency across concurrent requests", () => {
  it("refuses a different reviewed price under the same key after concurrent reads", async () => {
    const s = await saleWorld();
    let gate: ReturnType<typeof s.w.reader.holdNextRead> | undefined;
    let pending: Promise<unknown> | undefined;
    try {
      const previews = await Promise.all(
        ["250000000", "300000000"].map((price) => s.prepare(s.ava, "propose", proposal({ price }))),
      );
      for (const p of previews) expect(p.status).toBe(200);
      const [firstPreview, secondPreview] = previews;
      if (!firstPreview || !secondPreview) throw new Error("Both reviewed previews are required");
      const create = (p: (typeof previews)[number]) =>
        s.ava(`/api/sales/${s.biz}/actions`, "POST", {
          kind: "propose",
          input: p.body.input,
          action_digest: p.body.action_digest,
          idempotency_key: "astra-concurrent-key-01",
        });
      // Force both initial lookups to miss, then let the second request commit first.
      gate = s.w.reader.holdNextRead();
      const first = create(firstPreview);
      pending = first;
      await gate.entered;
      const second = await create(secondPreview);
      gate.open();
      const loser = await first;
      expect(second.status).toBe(201);
      expect(loser.status).toBe(409);
      expect(loser.body.code).toBe("idempotency_conflict");
      expect(second.body.action.action_digest).toBe(previews[1]?.body.action_digest);
      const saved = s.w.state.store.db.prepare("SELECT state, asks FROM sale_actions").all();
      expect(saved).toEqual([{ state: "prepared", asks: 0 }]);
    } finally {
      gate?.open();
      await pending;
      s.w.state.store.db.close();
    }
  });

  it("recovers one unchanged action when identical requests use the same key concurrently", async () => {
    const s = await saleWorld();
    try {
      const p = await s.prepare(s.ava, "propose", proposal());
      expect(p.status).toBe(200);
      const body = {
        kind: "propose",
        input: p.body.input,
        action_digest: p.body.action_digest,
        idempotency_key: "astra-concurrent-key-02",
      };
      const results = await Promise.all([
        s.ava(`/api/sales/${s.biz}/actions`, "POST", body),
        s.ava(`/api/sales/${s.biz}/actions`, "POST", body),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
      expect(results[0]?.body.action.id).toBe(results[1]?.body.action.id);
      for (const r of results) expect(r.body.action.action_digest).toBe(p.body.action_digest);
      expect(s.w.state.store.db.prepare("SELECT COUNT(*) AS n FROM sale_actions").get()?.n).toBe(1);
    } finally {
      s.w.state.store.db.close();
    }
  });
});
