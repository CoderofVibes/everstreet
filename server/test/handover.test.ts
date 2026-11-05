// Job 003wf3 (MANAGED_HANDOVER.md §10.3): the managed handover through the actual services in
// one process (handoverWorld.ts: the production composition with `handover` configured, synthetic
// RPC/model answered here). Each case drives the coordinator's passes itself.

import { afterEach, describe, expect, it } from "vitest";
import type { Json } from "./customer-world.ts";
import { BUYER, CLOSER, type HandoverWorld, handoverWorld, PRICE } from "./handoverWorld.ts";
import { FOUNDER, OP } from "./lifecycleWorld.ts";

const worlds: HandoverWorld[] = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.cleanup();
});
const world = async (o: Parameters<typeof handoverWorld>[0] = {}) => {
  const w = await handoverWorld(o);
  worlds.push(w);
  return w;
};

describe("003wf3 a managed Gated handover through the actual services", () => {
  it("propose, fund and accept through the participants' wallets; the coordinator issues the exact order, the contract closes, the existing reconciliation applies it, and the gate opens to the buyer", async () => {
    const w = await world();
    await w.toBuyerAccepted();
    const closing = await w.act(w.seller, FOUNDER, "accept");
    expect(
      closing.check?.body.resolution,
      JSON.stringify(closing.check?.body ?? closing.created?.body ?? closing.p.body),
    ).toMatchObject({ kind: "confirmed", result: "closing" });
    expect(w.sale.controlView().live_deal).toMatchObject({ state: "closing" });
    // Pass 1: arms, drains (nothing in flight), proves readiness, issues and sends order 1.
    const r1 = await w.coordinator.pass();
    expect(r1[w.biz]).toBe("dispatched:applied");
    const orders = w.rows("SELECT n, order_json FROM close_orders");
    expect(orders).toHaveLength(1);
    const order = JSON.parse(orders[0]?.order_json as string) as Json;
    const d = w.sale.outcomesView()[0] as Json;
    expect(order).toMatchObject({ deal_seq: "1", version: 1, expected_generation: 1 });
    expect(d).toMatchObject({ status: "closed", seq: "1", generation_after: 2 });
    expect(w.sale.controlView()).toMatchObject({ owner: BUYER, generation: 2 });
    // The attempt was durably recorded before broadcast, signed by the closer's FC key.
    const attempt = w.rows("SELECT method, signer, state FROM closer_tx_attempts")[0];
    expect(attempt).toMatchObject({ method: "close_sale", signer: CLOSER, state: "success" });
    // Pass 2: the close is observed, reconciled through V3Intents (system entry), released.
    const r2 = await w.coordinator.pass();
    expect(r2[w.biz]).toMatch(/^reconcile_(applied|already)$/);
    expect(w.handoverRow()).toMatchObject({ state: "released_to_buyer" });
    const owner = w.rows("SELECT owner_id FROM businesses WHERE id = ?", w.biz)[0];
    expect(owner?.owner_id).toBe("person-noah");
    const own = w.rows("SELECT v3_intent_id FROM ownership WHERE business_id = ?", w.biz);
    expect(own.some((x) => x.v3_intent_id)).toBe(true);
    const by = w.rows("SELECT actor FROM events WHERE type = 'v3.reconciled_by_handover'");
    expect(by[0]?.actor).toBe("system:handover");
    // The sale page shows the released handover and the real service readiness (D4).
    const setup = (await w.buyer(`/api/sales/${w.biz}`)).body;
    expect(setup.handover).toMatchObject({ state: "released_to_buyer", deal_seq: "1" });
    expect(setup.handover.service).toMatchObject({
      eligible: expect.any(Boolean),
      reasons: expect.any(Array),
    });
    expect(setup.control.operators.map((o: Json) => o.account)).toContain(OP);
    expect(PRICE).toBe(String(d.price));
  }, 60_000);
});
