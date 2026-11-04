// Job 003q1: the customer's statuses must tell the truth. A prepared request holds nothing; an
// unconfirmed reservation is pending; a completed charged request isn't "Reserved". Real app on the
// labelled fixture chain, scripted extractor and synthetic protection. Finite.

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
async function prepare(w: CustomerWorld, offer: string) {
  sync(w);
  const p = await w.cara(`/api/customer/offers/${offer}/prepare`, "POST", {
    idempotency_key: `status-key-${String(++n).padStart(4, "0")}`,
    input: INVOICE,
  });
  expect(p.status).toBe(201);
  return p.body.use as Json;
}

const listed = async (w: CustomerWorld, id: string) =>
  ((await w.cara("/api/customer/uses")).body.uses as Json[]).find((u) => u.id === id) as Json;

describe("003q1 unit and headline projections", () => {
  it("prepared and cancelled requests hold nothing; an unconfirmed reservation is pending", async () => {
    const w = await customerWorld({ customer: { protection: new SyntheticProtection() } });
    const offer = await w.offer();
    const u = await prepare(w, offer);
    expect(u.units.unit).toBe("not_held");
    expect(u.headline.title).toBe("Ready to review");
    expect((await listed(w, u.id)).unit).toBe("not_held");
    await w.cara(`/api/customer/uses/${u.id}/cancel`, "POST");
    expect((await w.cara(`/api/customer/uses/${u.id}`)).body.use.units.unit).toBe("not_held");
    // An authorization sent but not yet confirmed by the contract: pending, not reserved.
    sync(w);
    w.chain.tick(BigInt(u.envelope.consent.accept_by_ms) - w.chain.ts + 1n);
    sync(w);
    const v = await prepare(w, offer);
    w.writer.modes = ["drop", "drop"];
    const c = await w.cara(`/api/customer/uses/${v.id}/confirm`, "POST", w.signed(v.envelope));
    expect(c.body.use.state).toBe("reserve_unknown");
    expect(c.body.use.units.unit).toBe("reservation_pending");
    expect((await listed(w, v.id)).unit).toBe("reservation_pending");
  });

  it("a preparation past its signing time expires and still holds nothing", async () => {
    const w = await customerWorld({ customer: { protection: new SyntheticProtection() } });
    const x = await prepare(w, await w.offer());
    w.clock.now = Number(x.envelope.consent.sign_by_ms) + 1;
    const ex = (await w.cara(`/api/customer/uses/${x.id}`)).body.use;
    expect([ex.state, ex.units.unit]).toEqual(["expired", "not_held"]);
    expect(ex.headline.title).not.toMatch(/reserved/i);
    expect((await listed(w, x.id)).unit).toBe("not_held");
  });

  it("a charged request reads as completed, not as a current reservation", async () => {
    const w = await customerWorld({ customer: { protection: new SyntheticProtection() } });
    const offer = await w.offer();
    const u = await prepare(w, offer);
    await w.cara(`/api/customer/uses/${u.id}/confirm`, "POST", w.signed(u.envelope));
    const reserved = (await w.cara(`/api/customer/uses/${u.id}`)).body.use;
    expect([reserved.units.unit, reserved.headline.title]).toEqual([
      "reserved_awaiting_settlement",
      "Reserved",
    ]);
    sync(w);
    await w.cara(`/api/customer/uses/${u.id}/execute`, "POST", {});
    for (let i = 0; i < 3; i++) {
      sync(w);
      await w.cara(`/api/customer/uses/${u.id}/units/reconcile`, "POST");
    }
    const done = (await w.cara(`/api/customer/uses/${u.id}`)).body.use;
    // The protocol's historical facts stay; the headline composes them.
    expect([done.state, done.units.unit]).toEqual(["reserved", "charged"]);
    expect(done.headline.title).toBe("Completed");
    expect(done.headline.detail).not.toMatch(/signed hold/);
    expect((await listed(w, u.id)).headline.title).toBe("Completed");
  });

  it("recovery by key finds only the caller's own request, even when another person used the same key", async () => {
    const w = await customerWorld({ customer: { protection: new SyntheticProtection() } });
    const offer = await w.offer();
    const dana = w.person("Dana Fictional");
    w.link(dana.id, "dana-fixture.testnet");
    // Synthetic: a second funded customer, a copy of the contract-produced entitlement.
    w.chain.ents.set("dana-fixture.testnet", structuredClone(w.chain.ent() as Json));
    sync(w);
    const key = "shared-key-0001";
    const d = await dana(`/api/customer/offers/${offer}/prepare`, "POST", {
      idempotency_key: key,
      input: INVOICE,
    });
    expect([d.status, d.body.error]).toEqual([201, undefined]);
    // Cara has no request under this key yet: nothing of Dana's is reachable.
    expect((await w.cara(`/api/customer/requests/by-key/${key}`)).status).toBe(404);
    const c = await w.cara(`/api/customer/offers/${offer}/prepare`, "POST", {
      idempotency_key: key,
      input: `${INVOICE}, second copy`,
    });
    expect(c.status).toBe(201);
    const mine = await w.cara(`/api/customer/requests/by-key/${key}`);
    expect([mine.status, mine.body.use.id]).toEqual([200, c.body.use.id]);
    const theirs = await dana(`/api/customer/requests/by-key/${key}`);
    expect([theirs.status, theirs.body.use.id]).toEqual([200, d.body.use.id]);
    expect((await w.cara("/api/customer/requests/by-key/not a key")).status).toBe(404);
    // The owner can't read a customer's request, by key or by id.
    expect((await w.owner(`/api/customer/requests/by-key/${key}`)).status).toBe(404);
    expect((await w.owner(`/api/customer/uses/${c.body.use.id}`)).status).toBe(404);
    // A retired product still allows recovering one's own history.
    const r = await w.owner(
      `/api/businesses/${w.f.business}/customer-offers/${offer}/retire`,
      "POST",
    );
    expect(r.status).toBe(200);
    const after = await w.cara(`/api/customer/requests/by-key/${key}`);
    expect([after.status, after.body.use.id, after.body.use.offer.offer_state]).toEqual([
      200,
      c.body.use.id,
      "retired",
    ]);
  });

  it("a use returned before running reads as ended with the unit returned", async () => {
    const w = await customerWorld({ customer: { protection: new SyntheticProtection() } });
    const offer = await w.offer();
    const u = await prepare(w, offer);
    await w.cara(`/api/customer/uses/${u.id}/confirm`, "POST", w.signed(u.envelope));
    sync(w);
    await w.cara(`/api/customer/uses/${u.id}/release`, "POST");
    for (let i = 0; i < 3; i++) {
      sync(w);
      await w.cara(`/api/customer/uses/${u.id}/units/reconcile`, "POST");
    }
    const done = (await w.cara(`/api/customer/uses/${u.id}`)).body.use;
    expect([done.units.unit, done.headline.title]).toEqual(["returned", "Ended, unit returned"]);
    expect((await listed(w, u.id)).headline.title).toBe("Ended, unit returned");
  });

  it("a refused reservation and an unresolved one are not described as held", async () => {
    const w = await customerWorld({ customer: { protection: new SyntheticProtection() } });
    const offer = await w.offer();
    const u = await prepare(w, offer);
    w.chain.revoke(0); // the key changed before the open: refused
    const c = await w.cara(`/api/customer/uses/${u.id}/confirm`, "POST", w.signed(u.envelope));
    expect(c.body.use).toMatchObject({ state: "refused", units: { unit: "not_held" } });
    expect(c.body.use.headline.title).toBe("Not reserved");
  });
});
