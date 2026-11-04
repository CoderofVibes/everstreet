// Job 003r: from a tested release to a customer offer. The owner's readiness summary (local
// facts only), the bounded plan inspector, a create that must present the digest of the terms
// the owner reviewed, safely repeatable retirement and continuity across a sale. Real app on the
// labelled fixture chain and synthetic adapters; finite, with independent read ceilings.

import { describe, expect, it } from "vitest";
import {
  type CustomerWorld,
  customerWorld,
  type Json,
  SyntheticProtection,
} from "./customer-world.ts";

const base = (w: CustomerWorld) => `/api/businesses/${w.f.business}`;
const inspect = (w: CustomerWorld, terms: Json = {}, by = w.owner) =>
  by(`${base(w)}/customer-offer-inspections`, "POST", {
    release_id: w.release,
    plan_id: 1,
    retention_days: 30,
    ...terms,
  });
const create = (w: CustomerWorld, key: string, reviewed: string, terms: Json = {}, by = w.owner) =>
  by(`${base(w)}/customer-offers`, "POST", {
    idempotency_key: key,
    release_id: w.release,
    plan_id: 1,
    retention_days: 30,
    reviewed_terms: reviewed,
    ...terms,
  });
const offers = (w: CustomerWorld) =>
  w.state.store.db.prepare("SELECT id, state FROM customer_offers").all() as {
    id: string;
    state: string;
  }[];
const readiness = (w: CustomerWorld, by = w.owner) =>
  by(`${base(w)}/customer-offer-readiness?project=${w.f.project}`);

describe("003r readiness: what is configured, unavailable or unknown, never all green", () => {
  it("with nothing connected, every missing adapter is unavailable with a next step", async () => {
    const w = await customerWorld({ noReader: true, noWriter: true, noProvider: true });
    const r = await readiness(w);
    expect(r.status).toBe(200);
    const items = r.body.readiness.items as Json[];
    const state = Object.fromEntries(items.map((i) => [i.key, i.state]));
    expect(state).toEqual({
      release: "configured",
      page: expect.any(String),
      binding: "configured",
      plan: "unknown",
      reader: "unavailable",
      metering: "unavailable",
      protection: "unavailable",
      cleanup: "unavailable",
      runtime: "unavailable",
      authorization: "unavailable",
      offer: "unknown",
    });
    for (const i of items.filter((x) => x.state === "unavailable"))
      expect(i.next).toEqual(expect.any(String));
    expect(r.body.readiness.next).toEqual(items.find((i) => i.next)?.next);
    // Nothing is observed without a read, and nothing asks for credentials.
    expect(items.some((i) => i.state === "observed")).toBe(false);
    expect(JSON.stringify(r.body)).not.toMatch(/api[_ ]?key|secret|password|credential/i);
  });

  it("fully configured here still shows plan unknown and authorization unavailable; an offer is local", async () => {
    const w = await customerWorld({ customer: { protection: new SyntheticProtection() } });
    await w.offer();
    const items = (await readiness(w)).body.readiness.items as Json[];
    const by = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(by.plan.state).toBe("unknown");
    expect(by.authorization.state).toBe("unavailable");
    expect(by.offer).toMatchObject({ state: "configured" });
    expect(by.offer.detail).toMatch(/not proof/);
    expect(items.every((i) => ["configured", "observed"].includes(i.state))).toBe(false);
  });

  it("is the owner's alone", async () => {
    const w = await customerWorld();
    expect((await readiness(w, w.cara)).status).toBe(404);
    expect((await inspect(w, {}, w.cara)).status).toBe(404);
  });
});

describe("003r plan inspector: one bounded, fresh, exact read", () => {
  it("returns observed terms with their block, the platform's metering and the review digest", async () => {
    const w = await customerWorld();
    const r = await inspect(w);
    expect(r.status).toBe(200);
    const i = r.body.inspection;
    expect(i).toMatchObject({
      plan_id: 1,
      plan: { unit_price: "50000" },
      asset: "tusd.near",
      retention_days: 30,
      source: { network: "testnet", account: "studio.biz.near" },
      metering: { operator: "meter.near", platform_meters: true },
      block: { height: expect.any(String), timestamp_ms: String(w.chain.ts) },
      active_offer: null,
    });
    expect(i.terms_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(i.release.product.name).toEqual(expect.any(String));
    expect(offers(w)).toHaveLength(0); // inspecting writes nothing
  });

  it("refuses missing, aged, malformed, mixed and absent evidence without guessing", async () => {
    const w = await customerWorld();
    expect((await inspect(w, { plan_id: 7 })).body.code).toBe("no_such_plan");
    w.clock.now = Number(w.chain.ts) + 10 * 60_000; // the endpoint's newest block is 10 min old
    expect((await inspect(w)).body.code).toBe("evidence_too_old");
    w.clock.now = Number(w.chain.ts);
    w.reader.malformedNext = true;
    expect((await inspect(w)).body.code).toBe("read_malformed");
    w.reader.mixNext = true;
    expect((await inspect(w)).body.code).toBe("read_mixed_blocks");
    w.reader.failNext = 1;
    expect((await inspect(w)).status).toBe(503);
    const none = await customerWorld({ noReader: true });
    expect((await inspect(none)).body.code).toBe("customer_use_unavailable");
    expect((await inspect(w, { plan_id: 0 })).status).toBe(400);
    expect((await inspect(w, { retention_days: 366 })).status).toBe(400);
  });

  it("is capped per business per minute (each inspection is a contract read)", async () => {
    const w = await customerWorld();
    const reads = w.chain.calls;
    const codes: number[] = [];
    for (let i = 0; i < 14; i++) codes.push((await inspect(w)).status);
    expect(codes.filter((c) => c === 200)).toHaveLength(12);
    expect(codes.slice(12)).toEqual([429, 429]);
    const used = w.chain.calls - reads;
    w.clock.now += 61_000;
    w.chain.tick(61_000n);
    expect((await inspect(w)).status).toBe(200);
    expect(used).toBeLessThanOrEqual(12 * 3); // refused inspections read nothing
  });
});

describe("003r create: exactly the reviewed terms, or nothing", () => {
  it("requires a reviewed digest; a changed plan, retention or binding needs a fresh review", async () => {
    const w = await customerWorld();
    const missing = await create(w, "offer-key-0001", "");
    expect([missing.status, missing.body.code]).toEqual([400, "not_reviewed"]);
    const digest = (await inspect(w)).body.inspection.terms_digest as string;
    // The price changed on the contract after the review.
    w.chain.plan = { ...w.chain.plan, unit_price: "60000" };
    const changed = await create(w, "offer-key-0002", digest);
    expect([changed.status, changed.body.code]).toEqual([409, "terms_changed"]);
    expect(offers(w)).toHaveLength(0);
    // Retention differing from what was reviewed is also different terms.
    const fresh = (await inspect(w)).body.inspection.terms_digest as string;
    expect(fresh).not.toBe(digest);
    expect((await create(w, "offer-key-0003", fresh, { retention_days: 7 })).body.code).toBe(
      "terms_changed",
    );
    // The binding changed between review and create (a restarted server, another account).
    w.v3.bindings[0] = { ...w.v3.bindings[0], account: "other.biz.near" } as never;
    w.state.app = w.make(w.state.store);
    expect((await create(w, "offer-key-0004", fresh)).body.code).toBe("terms_changed");
    expect(offers(w)).toHaveLength(0);
  });

  it("the release retired during an inspection: no terms are offered for review", async () => {
    const w = await customerWorld();
    w.reader.duringRead = () =>
      w.state.store.db
        .prepare("UPDATE runtime_releases SET state = 'retired', retired_at = ? WHERE id = ?")
        .run(new Date().toISOString(), w.release);
    const r = await inspect(w);
    expect([r.status, r.body.code, r.body.inspection]).toEqual([
      409,
      "release_not_active",
      undefined,
    ]);
  });

  it("the release retired during the read: nothing is created", async () => {
    const w = await customerWorld();
    const digest = (await inspect(w)).body.inspection.terms_digest as string;
    w.reader.duringRead = () =>
      w.state.store.db
        .prepare("UPDATE runtime_releases SET state = 'retired', retired_at = ? WHERE id = ?")
        .run(new Date().toISOString(), w.release);
    const r = await create(w, "offer-key-0001", digest);
    expect([r.status, r.body.code]).toEqual([409, "release_not_active"]);
    expect(offers(w)).toHaveLength(0);
  });

  it("a sale during the read: the former owner's create lands nowhere", async () => {
    const w = await customerWorld();
    const digest = (await inspect(w)).body.inspection.terms_digest as string;
    const buyer = w.person("Noah Fenn");
    w.reader.duringRead = () => w.rw.transfer(w.f.business, w.f.ava.id, buyer.id);
    const r = await create(w, "offer-key-0001", digest);
    expect([404, 409]).toContain(r.status);
    expect(offers(w)).toHaveLength(0);
    // The buyer can't reuse the former owner's review: it named the former ownership.
    expect((await create(w, "offer-key-0002", digest, {}, buyer)).body.code).toBe("terms_changed");
  });

  it("a lost answer is recovered by the same key; a simultaneous duplicate makes one offer", async () => {
    const w = await customerWorld();
    const digest = (await inspect(w)).body.inspection.terms_digest as string;
    const [a, b] = await Promise.all([
      create(w, "offer-key-0001", digest),
      create(w, "offer-key-0001", digest),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.offer.id).toBe(b.body.offer.id);
    // Later, even after the plan changed, the original is returned exactly as it is.
    w.chain.plan = { ...w.chain.plan, unit_price: "60000" };
    const again = await create(w, "offer-key-0001", digest);
    expect([again.status, again.body.offer.plan.unit_price]).toEqual([200, "50000"]);
    expect(offers(w)).toHaveLength(1);
    expect(a.body.offer.product.name).toEqual(expect.any(String));
  });
});

describe("003r retirement and sale continuity", () => {
  it("retiring is exact and repeatable; a retry never reactivates; customers keep their history", async () => {
    const w = await customerWorld({ customer: { protection: new SyntheticProtection() } });
    const id = await w.offer();
    const one = await w.owner(`${base(w)}/customer-offers/${id}/retire`, "POST");
    const two = await w.owner(`${base(w)}/customer-offers/${id}/retire`, "POST");
    expect(one.body.offer.state).toBe("retired");
    expect(two.body.offer).toEqual(one.body.offer);
    expect((await w.owner(`${base(w)}/customer-offers/nope/retire`, "POST")).status).toBe(404);
    // The original create, retried with its key, returns the retired offer as it is.
    const retry = await w.offer();
    expect(retry).toBe(id);
    expect(offers(w)).toEqual([{ id, state: "retired" }]);
    // A deliberate new offer on the same release and plan is a new, reviewed creation.
    const fresh = await create(w, "offer-key-0009", await w.reviewed());
    expect([fresh.status, fresh.body.offer.state]).toEqual([201, "active"]);
    expect(fresh.body.offer.id).not.toBe(id);
  });

  it("after a sale the buyer manages the offers; the former owner is out; neither reads customers", async () => {
    const w = await customerWorld({ customer: { protection: new SyntheticProtection() } });
    const id = await w.offer();
    const p = await w.cara(`/api/customer/offers/${id}/prepare`, "POST", {
      idempotency_key: "use-key-0001",
      input: "Fictional invoice SH-1042 from Stackline Hosting Ltd, total 412.50 USD",
    });
    expect(p.status).toBe(201);
    const buyer = w.person("Noah Fenn");
    w.rw.transfer(w.f.business, w.f.ava.id, buyer.id);
    w.chain.afterSale();
    w.chain.reappointPlatform();
    for (const path of [
      `${base(w)}/customer-offers`,
      `${base(w)}/customer-offer-readiness?project=${w.f.project}`,
    ])
      expect((await w.owner(path)).status).toBe(404);
    expect((await inspect(w)).status).toBe(404);
    expect((await w.owner(`${base(w)}/customer-offers/${id}/retire`, "POST")).status).toBe(404);
    expect((await readiness(w, buyer)).status).toBe(200);
    expect((await buyer(`${base(w)}/customer-offers`)).body.offers).toHaveLength(1);
    const insp = await inspect(w, {}, buyer);
    expect(insp.status).toBe(200);
    expect(insp.body.inspection.active_offer).toBe(id);
    const retired = await buyer(`${base(w)}/customer-offers/${id}/retire`, "POST");
    expect(retired.body.offer.state).toBe("retired");
    for (const who of [w.owner, buyer])
      expect((await who(`/api/customer/uses/${p.body.use.id}`)).status).toBe(404);
    expect((await w.cara(`/api/customer/uses/${p.body.use.id}`)).status).toBe(200);
  });
});
