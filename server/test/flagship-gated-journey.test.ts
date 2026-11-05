// Hardening (Tony's agreed plan, item 1): the flagship journey with a GATED close, in one actual
// configured child (entryChild.ts -> serve.ts -> composeApplication with `handover`). The founder
// makes the product through routes; a fresh customer buys 100 and uses 5; one more use is
// reserved but not run when the seller accepts; the coordinator gates the business, returns that
// unit, orders and sends the close with the closer's function-call key, reconciles and releases
// the business to the buyer. Afterwards the customer keeps 95 units and every result, the buyer
// serves the next use and the buyer's reviewed update reaches the same customer.
//
// SYNTHETIC chain, wallet, closer and model (flagshipWorld.ts, handoverWorld.ts); fictional people.

import { afterEach, describe, expect, it } from "vitest";
import { CUSTOMER, type Json } from "./customer-world.ts";
import {
  act,
  BUYER,
  type Cleanup,
  check,
  foundAndOffer,
  installation,
  offerFor,
  ok,
  people,
  prepareAndConfirm,
  purchase,
  SALE_TERMS,
  serveOneUse,
  until,
  useKey,
} from "./flagshipWorld.ts";
import { FOUNDER } from "./lifecycleWorld.ts";

const cleanups: Cleanup[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

describe("hardening: the flagship journey with a Gated close (SYNTHETIC chain, wallet, closer and model)", () => {
  it("found, buy 100, use 5, one reserved at acceptance; gate, return, close once, reconcile, release; 95 kept, results kept, buyer serves and updates", async () => {
    const i = await installation(cleanups, { gated: true });
    const app = await i.start();
    const { ava, cara, noah } = await people(i);
    const { offer, jobId } = await foundAndOffer(i, ava);
    const offerId = offer.id as string;
    const key = useKey();
    const p = await purchase(i, cara, offerId, 100, [{ slot: 0, key }], "gated-buy-0000001");
    expect(
      ok(
        await cara(`/api/customer/purchases/${p.pid}/check`, "POST", { tx_hash: p.hash }),
        200,
        "check",
      ).resolution,
    ).toMatchObject({ kind: "confirmed", units: 100 });
    const delivered: string[] = [];
    for (let n = 1; n <= 5; n++) delivered.push(await serveOneUse(cara, offerId, n, key));
    const first = ok(await cara(`/api/customer/uses/${delivered[0]}/result`), 200, "result 1");

    // One use reserved, not yet run, when the seller accepts.
    const pending = await prepareAndConfirm(cara, offerId, 6, key);
    expect(
      ok(await cara(`/api/customer/uses/${pending.id}/confirm`, "POST", pending.body), 200, "c6")
        .use.state,
    ).toBe("reserved");

    // The Gated sale through the routes and the wallet; the coordinator does the close.
    const proposed = await act(i, ava, FOUNDER, "propose", SALE_TERMS, "gated-propose-001");
    expect((await check(ava, proposed.id, "propose")).resolution.kind).toBe("confirmed");
    for (const k of ["register", "fund", "accept"]) {
      const a = await act(i, noah, BUYER, k, {}, `gated-${k}-00001`);
      expect((await check(noah, a.id, k)).resolution.kind).toBe("confirmed");
    }
    await act(i, ava, FOUNDER, "accept", {}, "gated-close-00001");
    await until(
      async () => i.read("SELECT state FROM business_handovers WHERE business_id = ?", i.biz),
      (rows) => rows[0]?.state === "released_to_buyer",
      "the handover released to the buyer",
      90_000,
    );
    const closes = i.b.rpc.applied.filter((t) => t.method === "close_sale");
    expect(closes).toHaveLength(1);
    expect(i.read("SELECT COUNT(*) AS n FROM close_orders")[0]?.n).toBe(1);
    expect(i.read("SELECT to_id FROM ownership WHERE business_id = ?", i.biz)).toEqual([
      { to_id: "person-noah" },
    ]);
    expect(i.b.w.chain.sale?.controlView()).toMatchObject({ owner: BUYER });
    // The reserved, unrun use: returned once, never charged.
    expect(i.b.rpc.applied.filter((t) => t.method === "release_hold_for")).toHaveLength(1);
    const u6 = ok(await cara(`/api/customer/uses/${pending.id}`), 200, "u6");
    expect(u6.use?.units?.unit).toBe("returned");
    expect(i.b.w.chain.ent(CUSTOMER)).toMatchObject({ free: "95", consumed: "5" });
    expect(ok(await cara(`/api/customer/uses/${delivered[0]}/result`), 200, "r1 after")).toEqual(
      first,
    );
    // The seller is out; the buyer manages.
    expect((await ava(`/api/sales/${i.biz}`)).body.local_owner).toBe(false);
    expect(ok(await noah(`/api/sales/${i.biz}`), 200, "buyer").local_owner).toBe(true);

    // The buyer serves the next use (94), then ships a reviewed update the customer receives.
    delivered.push(await serveOneUse(cara, offerId, 7, key));
    expect(i.b.w.chain.ent(CUSTOMER)).toMatchObject({ free: "94", consumed: "6" });
    const head = ok(await noah(`/api/product-projects/${i.project}`), 200, "project").head as Json;
    const rev = ok(
      await noah(`/api/product-projects/${i.project}/revisions`, "POST", {
        base_revision: head.number,
        brief: { ...(head.brief as Json), name: "Ledgerline Invoice Reader 2" },
        prototype: head.prototype,
        note: "Successor update under the new owner",
      }),
      [200, 201],
      "buyer revision",
    );
    const job2 = ok(
      await noah(`/api/product-projects/${i.project}/builds`, "POST", {
        idempotency_key: "gated-build-00002",
        revision: rev.head.number,
        budget: {
          max_input_tokens: 10_000,
          max_output_tokens: 2_000,
          max_seconds: 60,
          max_cost_cents: 10,
        },
      }),
      [201, 202],
      "buyer build",
    ).job.id as string;
    expect(job2).not.toBe(jobId);
    await until(
      async () => (await noah(`/api/product-projects/${i.project}/builds`)).body,
      (v) => (v.jobs as Json[]).some((j: Json) => j.id === job2 && j.state === "succeeded"),
      "the buyer's build",
      60_000,
    );
    const run2 = ok(
      await noah(`/api/product-projects/${i.project}/evaluations`, "POST", { artifact_job: job2 }),
      202,
      "buyer evaluation",
    ).run as Json;
    const done2 = await until(
      async () => (await noah(`/api/evaluations/${run2.id}`)).body.run,
      (r) => r?.state !== "running",
      "the buyer's evaluation",
      60_000,
    );
    const rel2 = ok(
      await noah(`/api/product-projects/${i.project}/releases`, "POST", {
        artifact_job: job2,
        eval_run: done2.id,
      }),
      201,
      "buyer release",
    );
    const offer2 = await offerFor(i, noah, rel2.active.id as string, "gated-offer-00002");
    const updated = await serveOneUse(cara, offer2.id as string, 8, key);
    expect(ok(await cara(`/api/customer/uses/${updated}`), 200, "updated").use.offer_id).toBe(
      offer2.id,
    );
    expect(i.b.w.chain.ent(CUSTOMER)).toMatchObject({ free: "93", consumed: "7" });
    expect(
      i.read("SELECT COUNT(*) AS n FROM customer_settlements WHERE kind = 'charge'")[0]?.n,
    ).toBe(7);
    expect(await app.shutdown()).toBe(0);
  }, 300_000);
});
