// Job 003r1: after a request ends unconfirmed, say honestly when the next one may start, without
// loosening the barrier (an authorization prepared for it stays valid until its accept deadline,
// or until the contract shows its sequence used). Also: retention cleanup is described from
// evidence, and readiness names the binding a review depends on. Real app on the labelled
// fixture chain and synthetic adapters; finite.

import { describe, expect, it } from "vitest";
import {
  type CustomerWorld,
  customerWorld,
  type Json,
  SyntheticProtection,
} from "./customer-world.ts";

const INVOICE =
  "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD";
const sync = (w: CustomerWorld) => {
  w.clock.now = Number(w.chain.ts);
};
let n = 0;
const prepare = async (w: CustomerWorld, offer: string) => {
  sync(w);
  return w.cara(`/api/customer/offers/${offer}/prepare`, "POST", {
    idempotency_key: `next-key-${String(++n).padStart(4, "0")}`,
    input: INVOICE,
  });
};
const view = async (w: CustomerWorld, id: string) =>
  (await w.cara(`/api/customer/uses/${id}`)).body.use as Json;

describe("003r1 the next use after a stopped request", () => {
  it("cancelled: wait until the accept deadline by both clocks; at it exactly, still refused", async () => {
    const w = await customerWorld({ customer: { protection: new SyntheticProtection() } });
    const offer = await w.offer();
    const first = (await prepare(w, offer)).body.use as Json;
    const acceptBy = first.envelope.consent.accept_by_ms as string;
    await w.cara(`/api/customer/uses/${first.id}/cancel`, "POST");
    expect((await view(w, first.id)).next_use).toEqual({ state: "wait", until_ms: acceptBy });
    expect((await view(w, first.id)).explanation).not.toMatch(/start a new request/i);
    const refused = await prepare(w, offer);
    expect([refused.status, refused.body.code, refused.body.detail]).toEqual([
      409,
      "previous_window_open",
      { request_id: first.id, until_ms: acceptBy },
    ]);
    // Exactly at the deadline: a block may still accept it.
    w.chain.tick(BigInt(acceptBy) - w.chain.ts);
    sync(w);
    expect((await view(w, first.id)).next_use.state).toBe("wait");
    expect((await prepare(w, offer)).body.code).toBe("previous_window_open");
    // One millisecond later by the server clock the page says "check"; the contract decides.
    w.clock.now = Number(acceptBy) + 1;
    expect((await view(w, first.id)).next_use).toEqual({ state: "check", until_ms: null });
    w.chain.tick(1n);
    const next = await prepare(w, offer);
    expect([next.status, next.body.use.reservation.hold_seq]).toEqual([201, 1]);
    expect(w.writer.calls).toBe(0);
  });

  it("the contract showing the sequence used frees it before the deadline (skip_hold_seq)", async () => {
    const w = await customerWorld({ customer: { protection: new SyntheticProtection() } });
    const offer = await w.offer();
    const first = (await prepare(w, offer)).body.use as Json;
    await w.cara(`/api/customer/uses/${first.id}/cancel`, "POST");
    expect((await prepare(w, offer)).body.code).toBe("previous_window_open");
    w.chain.skip(); // the contract's skip_hold_seq: the old authorization can never open
    const next = await prepare(w, offer);
    expect([next.status, next.body.use.reservation.hold_seq]).toEqual([201, 2]);
  });

  it("expired preparations wait the same way; requests still open say in progress, not wait", async () => {
    const w = await customerWorld({ customer: { protection: new SyntheticProtection() } });
    const offer = await w.offer();
    const first = (await prepare(w, offer)).body.use as Json;
    w.clock.now = Number(first.envelope.consent.sign_by_ms) + 1;
    const ex = await view(w, first.id);
    expect([ex.state, ex.next_use]).toEqual([
      "expired",
      { state: "wait", until_ms: first.envelope.consent.accept_by_ms },
    ]);
    const v = await customerWorld({ customer: { protection: new SyntheticProtection() } });
    const o2 = await v.offer();
    const open = (await prepare(v, o2)).body.use as Json;
    expect(open.next_use).toBeNull();
    const again = await prepare(v, o2);
    expect([again.body.code, again.body.detail]).toEqual([
      "use_in_progress",
      { request_id: open.id, until_ms: null },
    ]);
  });
});

describe("003r1 readiness: retention cleanup from evidence, and the binding", () => {
  const items = async (w: CustomerWorld) =>
    (
      await w.owner(
        `/api/businesses/${w.f.business}/customer-offer-readiness?project=${w.f.project}`,
      )
    ).body.readiness as Json;

  it("deletion capable but unscheduled is unknown; recorded deletions are observed, not a schedule", async () => {
    const w = await customerWorld({ customer: { protection: new SyntheticProtection() } });
    const offer = await w.offer();
    const r = await items(w);
    expect(r.binding).toEqual({ network: "testnet", account: "studio.biz.near" });
    const cleanup = () => items(w).then((x) => x.items.find((i: Json) => i.key === "cleanup"));
    expect(await cleanup()).toMatchObject({ state: "unknown" });
    expect((await cleanup()).detail).toMatch(/no retention pass is scheduled/);
    // One delivered result, past its retention: overdue, then deleted by an explicit pass.
    const p = (await prepare(w, offer)).body.use as Json;
    await w.cara(`/api/customer/uses/${p.id}/confirm`, "POST", w.signed(p.envelope));
    sync(w);
    await w.cara(`/api/customer/uses/${p.id}/execute`, "POST", {});
    w.clock.now += 31 * 86_400_000;
    expect((await cleanup()).detail).toMatch(/1 past retention not yet deleted/);
    expect(await w.service().expireResults(5)).toEqual({ deleted: 1, failed: 0 });
    const done = await cleanup();
    expect(done.state).toBe("observed");
    expect(done.detail).toMatch(/deleted 1/);
    expect(done.detail).toMatch(/not that it runs on a schedule/);
  });

  it("without a deletion capability cleanup is unavailable", async () => {
    const w = await customerWorld();
    const c = (await items(w)).items.find((i: Json) => i.key === "cleanup");
    expect(c).toMatchObject({ state: "unavailable" });
    expect(c.detail).toMatch(/Every read refuses a result past its retention time/);
  });
});
