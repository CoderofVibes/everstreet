// Hardening (Tony's agreed plan, item 1): the RESTART and CONCURRENCY matrix around the whole
// flagship journey. One installation; the server process is killed (SIGKILL, exit awaited) at
// each money- or access-critical moment and a new process continues on the same database:
//
//   K1 purchase:  the customer's payment landed on the chain; the check's chain read is cut.
//   K2 reserve:   the hold was applied on the chain; its answer is lost.
//   K3 settle:    the charge was applied on the chain; its answer is lost.
//   K4 close:     the seller's close landed on the chain; the check's chain read is cut.
//   K5a execute:  the model call is cut in transport BEFORE the provider double records it.
//   K5b execute:  the provider double ACCEPTS and records the call, and its answer is lost.
//   (Both under the buyer; each is never dispatched again, never charged, and its unit returns
//   after the delivery timeout. The Direct close is one contract transition, asserted exactly.)
//
// Concurrency, live: one idempotency key prepared 4 times at once, one use confirmed and run 3
// times at once, and a second purchase checked 3 times at once.
//
// What must hold after all of it: one confirmed purchase each; one hold per use; one charge per
// delivered use, never for an undelivered one; the interrupted execution is never dispatched
// twice and its unit comes back; the sale closes and reconciles once; the customer's results and
// remaining units are intact; the seller is not revived.
//
// SYNTHETIC chain, wallet and model (flagshipWorld.ts); fictional people; nothing external.

import { afterEach, describe, expect, it } from "vitest";
import { CUSTOMER, type Json } from "./customer-world.ts";
import {
  act,
  BUYER,
  type Call,
  type Cleanup,
  charged,
  check,
  foundAndOffer,
  installation,
  ok,
  people,
  prepareAndConfirm,
  purchase,
  SALE_TERMS,
  serveOneUse,
  until,
  useKey,
} from "./flagshipWorld.ts";
import { FOUNDER, sendMethodOf } from "./lifecycleWorld.ts";

const cleanups: Cleanup[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const methods = (i: { b: { rpc: { applied: readonly { method: string }[] } } }, m: string) =>
  i.b.rpc.applied.filter((t) => t.method === m).length;
const unitOf = async (who: Call, id: string) =>
  (await who(`/api/customer/uses/${id}`)).body?.use?.units?.unit as string | undefined;

describe("hardening: restart and concurrency matrix around the whole flagship journey (SYNTHETIC chain, wallet and model)", () => {
  it("K1-K5 kills and live concurrency: no double payment, hold or charge; nothing charged undelivered; sale closes once; customer keeps results and units", async () => {
    const i = await installation(cleanups);
    let armed = false;
    let app = await i.start({ cut: () => (armed ? "hold" : "answer") });
    const { ava, cara, noah } = await people(i);
    const { offer } = await foundAndOffer(i, ava);
    const offerId = offer.id as string;
    const key = useKey();

    // ---- K1: the payment is on the chain; the server dies while checking it.
    const { pid, hash } = await purchase(
      i,
      cara,
      offerId,
      100,
      [{ slot: 0, key }],
      "matrix-buy-000001",
    );
    armed = true;
    const lost = cara(`/api/customer/purchases/${pid}/check`, "POST", { tx_hash: hash }).catch(
      () => null,
    );
    await until(
      async () => app.state.cut,
      (v) => v,
      "K1 cut",
    );
    await app.kill();
    await lost;
    expect(i.read("SELECT state FROM customer_purchases WHERE id = ?", pid)[0]?.state).not.toBe(
      "confirmed",
    );
    app = await i.start();
    // Three checks at once after the restart: one confirmation, 100 units, not 300.
    const checks = await Promise.all(
      [1, 2, 3].map(() => cara(`/api/customer/purchases/${pid}/check`, "POST", { tx_hash: hash })),
    );
    for (const c of checks) expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(checks.map((c) => c.body.resolution)).toContainEqual({
      kind: "confirmed",
      units: 100,
      amount: "15000000",
    });
    expect(i.b.w.chain.ent(CUSTOMER)).toMatchObject({ free: "100", consumed: "0" });

    // Three ordinary uses on the new process.
    const delivered: string[] = [];
    for (let n = 1; n <= 3; n++) delivered.push(await serveOneUse(cara, offerId, n, key));
    expect(methods(i, "open_hold")).toBe(3);
    expect(methods(i, "settle_hold")).toBe(3);

    // ---- K2: the hold is applied on the chain and its answer lost; the server dies.
    await app.shutdown();
    app = await i.start({
      cut: (r) =>
        r.channel === "rpc" && sendMethodOf(r.body) === "open_hold" ? "lose_reply" : "answer",
    });
    const u4 = await prepareAndConfirm(cara, offerId, 4, key);
    const lostConfirm = cara(`/api/customer/uses/${u4.id}/confirm`, "POST", u4.body).catch(
      () => null,
    );
    await until(
      async () => app.state.cut,
      (v) => v,
      "K2 cut",
    );
    await app.kill();
    await lostConfirm;
    expect(methods(i, "open_hold")).toBe(4);
    app = await i.start();
    // The same signatures again: the same request, never a second hold.
    expect(
      ok(await cara(`/api/customer/uses/${u4.id}/confirm`, "POST", u4.body), 200, "K2 again").use
        .id,
    ).toBe(u4.id);
    await until(
      async () => (await cara(`/api/customer/uses/${u4.id}/reconcile`, "POST")).body,
      (v) => v.use?.state === "reserved",
      "K2 recovered as reserved",
    );
    expect(
      ok(await cara(`/api/customer/uses/${u4.id}/execute`, "POST", {}), 200, "K2 run").use.execution
        .fulfilled,
    ).toBe(true);
    await charged(cara, u4.id, 4);
    delivered.push(u4.id);
    expect(methods(i, "open_hold")).toBe(4);

    // ---- K3: the charge is applied on the chain and its answer lost; the server dies.
    await app.shutdown();
    app = await i.start({
      cut: (r) =>
        r.channel === "rpc" && sendMethodOf(r.body) === "settle_hold" ? "lose_reply" : "answer",
    });
    const u5 = await prepareAndConfirm(cara, offerId, 5, key);
    expect(
      ok(await cara(`/api/customer/uses/${u5.id}/confirm`, "POST", u5.body), 200, "K3 confirm").use
        .state,
    ).toBe("reserved");
    const lostRun = cara(`/api/customer/uses/${u5.id}/execute`, "POST", {})
      .then(() => cara(`/api/customer/uses/${u5.id}/units/reconcile`, "POST"))
      .catch(() => null);
    await until(
      async () => app.state.cut,
      (v) => v,
      "K3 cut",
    );
    await app.kill();
    await lostRun;
    expect(methods(i, "settle_hold")).toBe(5);
    app = await i.start();
    await charged(cara, u5.id, 5);
    delivered.push(u5.id);
    expect(methods(i, "settle_hold")).toBe(5); // recognised, never sent again
    expect(i.b.w.chain.ent(CUSTOMER)).toMatchObject({ free: "95", consumed: "5" });

    // ---- Live concurrency on the new process.
    const prepares = await Promise.all(
      [1, 2, 3, 4].map(() => prepareAndConfirm(cara, offerId, 6, key)),
    );
    expect(new Set(prepares.map((p) => p.id)).size).toBe(1);
    const u6 = prepares[0] as { id: string; body: Json };
    const confirms = await Promise.all(
      [1, 2, 3].map(() => cara(`/api/customer/uses/${u6.id}/confirm`, "POST", u6.body)),
    );
    for (const c of confirms) expect(c.status, JSON.stringify(c.body)).toBe(200);
    await until(
      async () => (await cara(`/api/customer/uses/${u6.id}/reconcile`, "POST")).body,
      (v) => v.use?.state === "reserved",
      "u6 reserved",
    );
    const modelBefore = i.b.model.calls.messages;
    const runs = await Promise.all(
      [1, 2, 3].map(() => cara(`/api/customer/uses/${u6.id}/execute`, "POST", {})),
    );
    expect(runs.some((r) => r.status === 200 && r.body.use?.execution?.fulfilled)).toBe(true);
    await charged(cara, u6.id, 6);
    delivered.push(u6.id);
    expect(i.b.model.calls.messages - modelBefore).toBe(1); // dispatched once
    expect(methods(i, "open_hold")).toBe(6);
    expect(methods(i, "settle_hold")).toBe(6);
    // A second purchase of 10, checked three times at once: 10 more units, once.
    const second = await purchase(i, cara, offerId, 10, [], "matrix-buy-000002");
    const checks2 = await Promise.all(
      [1, 2, 3].map(() =>
        cara(`/api/customer/purchases/${second.pid}/check`, "POST", { tx_hash: second.hash }),
      ),
    );
    for (const c of checks2) expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(i.b.w.chain.ent(CUSTOMER)).toMatchObject({ free: "104", consumed: "6" });
    expect(
      i.read("SELECT COUNT(*) AS n FROM customer_purchases WHERE customer_account = ?", CUSTOMER)[0]
        ?.n,
    ).toBe(2);

    // ---- K4: the Direct sale; the seller's close lands on the chain and the check is cut.
    const proposed = await act(i, ava, FOUNDER, "propose", SALE_TERMS, "matrix-propose-01");
    expect((await check(ava, proposed.id, "propose")).resolution.kind).toBe("confirmed");
    for (const k of ["register", "fund", "accept"]) {
      const a = await act(i, noah, BUYER, k, {}, `matrix-${k}-0001`);
      expect((await check(noah, a.id, k)).resolution.kind).toBe("confirmed");
    }
    await app.shutdown();
    // The Direct close is ONE contract transition: the seller's acceptance (no close_sale call);
    // the control generation moves by exactly one, and a repeated check doesn't move it again.
    const genBefore = i.b.w.chain.sale?.controlView().generation as number;
    let armedClose = false;
    app = await i.start({ cut: () => (armedClose ? "hold" : "answer") });
    const close = await act(i, ava, FOUNDER, "accept", {}, "matrix-close-0001");
    armedClose = true;
    const lostClose = check(ava, close.id, "close").catch(() => null);
    await until(
      async () => app.state.cut,
      (v) => v,
      "K4 cut",
    );
    await app.kill();
    await lostClose;
    app = await i.start();
    const closed = await check(ava, close.id, "close again");
    expect(closed.resolution).toMatchObject({ kind: "confirmed", result: "closed" });
    await until(
      async () => i.read("SELECT to_id FROM ownership WHERE business_id = ?", i.biz),
      (rows) => rows.length === 1,
      "one ownership change",
    );
    expect(i.read("SELECT to_id FROM ownership WHERE business_id = ?", i.biz)).toEqual([
      { to_id: "person-noah" },
    ]);
    expect(i.b.w.chain.sale?.controlView()).toMatchObject({ owner: BUYER });
    expect(methods(i, "close_sale")).toBe(0);
    expect(i.b.w.chain.sale?.controlView().generation).toBe(genBefore + 1);
    await check(ava, close.id, "close once more"); // a repeated check reads, it doesn't act
    expect(i.b.w.chain.sale?.controlView().generation).toBe(genBefore + 1);
    expect(i.b.w.chain.ent(CUSTOMER)).toMatchObject({ free: "104", consumed: "6" });
    // The seller isn't revived after the restart.
    expect((await ava(`/api/sales/${i.biz}`)).body.local_owner).toBe(false);
    expect(ok(await noah(`/api/sales/${i.biz}`), 200, "buyer").local_owner).toBe(true);
    // The buyer serves the next use.
    delivered.push(await serveOneUse(cara, offerId, 7, key));

    // ---- K5a: the model call is cut in transport before the provider double records it.
    await app.shutdown();
    app = await i.start({ cut: (r) => (r.channel === "model" ? "hold" : "answer") });
    const u8 = await prepareAndConfirm(cara, offerId, 8, key);
    expect(
      ok(await cara(`/api/customer/uses/${u8.id}/confirm`, "POST", u8.body), 200, "K5 confirm").use
        .state,
    ).toBe("reserved");
    const before = i.b.model.calls.messages;
    const lostExec = cara(`/api/customer/uses/${u8.id}/execute`, "POST", {}).catch(() => null);
    await until(
      async () => app.state.cut,
      (v) => v,
      "K5 cut",
    );
    await app.kill();
    await lostExec;
    app = await i.start();
    const again = ok(
      await cara(`/api/customer/uses/${u8.id}/execute`, "POST", {}),
      200,
      "K5 again",
    );
    expect(again.use.execution?.fulfilled).not.toBe(true);
    // The provider double never recorded it (cut before it), and nothing was resent.
    expect(i.b.model.calls.messages).toBe(before);
    expect(await unitOf(cara, u8.id)).not.toBe("charged");
    // Past the delivery timeout (a labelled test clock in the next process), recovery finalizes
    // it as not delivered and the unit comes back once.
    await app.shutdown();
    // The chain double's clock moves on by the same amount (a new block at the shifted time).
    const SKIP = 330_000;
    i.b.w.chain.wallClockOffsetMs = SKIP;
    i.b.w.chain.tick(BigInt(Date.now() + SKIP) - i.b.w.chain.ts);
    app = await i.start({}, { LIFECYCLE_CLOCK_OFFSET_MS: String(SKIP) });
    await until(
      async () => {
        await cara(`/api/customer/uses/${u8.id}/units/reconcile`, "POST");
        return unitOf(cara, u8.id);
      },
      (u) => u === "returned",
      "K5 unit returned",
      60_000,
    );
    expect(methods(i, "release_hold_for")).toBe(1);

    // ---- K5b: the provider double ACCEPTS the call (recorded, as an upstream that did the work)
    // and the answer is lost; the server dies. No second dispatch, no charge, its compute stays
    // unknown (never zero), and the unit returns after the delivery timeout.
    await app.shutdown();
    app = await i.start(
      {
        cut: (r) =>
          r.channel === "model" && r.url.endsWith("/v1/messages") ? "lose_reply" : "answer",
      },
      { LIFECYCLE_CLOCK_OFFSET_MS: String(SKIP) },
    );
    const u9 = await prepareAndConfirm(cara, offerId, 9, key);
    expect(
      ok(await cara(`/api/customer/uses/${u9.id}/confirm`, "POST", u9.body), 200, "K5b confirm").use
        .state,
    ).toBe("reserved");
    const accepted = i.b.model.calls.messages;
    const lostExec2 = cara(`/api/customer/uses/${u9.id}/execute`, "POST", {}).catch(() => null);
    await until(
      async () => app.state.cut,
      (v) => v,
      "K5b cut",
    );
    await app.kill();
    await lostExec2;
    expect(i.b.model.calls.messages).toBe(accepted + 1); // the provider did record it
    app = await i.start({}, { LIFECYCLE_CLOCK_OFFSET_MS: String(SKIP) });
    const again2 = ok(
      await cara(`/api/customer/uses/${u9.id}/execute`, "POST", {}),
      200,
      "K5b again",
    );
    expect(again2.use.execution?.fulfilled).not.toBe(true);
    expect(i.b.model.calls.messages).toBe(accepted + 1); // never dispatched twice
    expect(await unitOf(cara, u9.id)).not.toBe("charged");
    const usage = i.read(
      `SELECT ri.state, ri.usage_state, ri.charged_microcents FROM customer_executions ce
         JOIN runtime_invocations ri ON ri.id = ce.invocation_id WHERE ce.request_id = ?`,
      u9.id,
    );
    expect(usage, JSON.stringify(usage)).toHaveLength(1);
    // Unknown, not zero: the provider may have done the work, and nothing says what it cost.
    expect(usage[0]?.usage_state).not.toBe("final");
    await app.shutdown();
    const SKIP2 = 2 * SKIP;
    i.b.w.chain.wallClockOffsetMs = SKIP2;
    i.b.w.chain.tick(BigInt(Date.now() + SKIP2) - i.b.w.chain.ts);
    app = await i.start({}, { LIFECYCLE_CLOCK_OFFSET_MS: String(SKIP2) });
    await until(
      async () => {
        await cara(`/api/customer/uses/${u9.id}/units/reconcile`, "POST");
        return unitOf(cara, u9.id);
      },
      (u) => u === "returned",
      "K5b unit returned",
      60_000,
    );
    expect(methods(i, "release_hold_for")).toBe(2);
    expect(i.b.model.calls.messages).toBe(accepted + 1);

    // ---- The ledger after everything.
    const n = delivered.length; // 7 delivered uses
    expect(n).toBe(7);
    expect(methods(i, "settle_hold")).toBe(n);
    expect(methods(i, "open_hold")).toBe(n + 2); // + the two interrupted, returned uses
    expect(i.b.w.chain.charged).toBe(n);
    expect(i.b.w.chain.ent(CUSTOMER)).toMatchObject({ free: String(110 - n), consumed: String(n) });
    expect(
      i.read("SELECT COUNT(*) AS n FROM customer_settlements WHERE kind = 'charge'")[0]?.n,
    ).toBe(n);
    for (const id of delivered) {
      expect(await unitOf(cara, id)).toBe("charged");
      expect((await cara(`/api/customer/uses/${id}/result`)).status).toBe(200);
      expect((await ava(`/api/customer/uses/${id}/result`)).status).not.toBe(200);
    }
    expect(await app.shutdown()).toBe(0);
  }, 300_000);
});
