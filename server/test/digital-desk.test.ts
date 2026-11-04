// Job 001c: the digital business desk projection, over the real API. Product status from the
// records (brief, release, offers), work split into "needs you" and "waiting on the system", a
// brief-only founder, several products (bounded), an imported product, a legacy offering, a
// legacy business, and ownership: another person, a customer, and the actual acquisition
// reconciliation. Labelled fixtures; finite.

import { describe, expect, it } from "vitest";
import { DESK_PRODUCTS } from "../src/digitalDesk.ts";
import type { Json } from "./customer-world.ts";
import { maintenanceWorld } from "./maintenance-world.ts";
import { FixtureV3Transport, V3_CLOSED, V3_DIGEST } from "./v3-fixture-transport.ts";

const inert = { set: () => 1, clear: () => {} };

/** `scheduled`: the worker's passes are scheduled (start(), inert timers), not only run on request. */
async function digital(v3Transport?: FixtureV3Transport, scheduled = true) {
  const t = await maintenanceWorld({ v3Transport });
  const biz = `/api/businesses/${t.w.f.business}`;
  const desk = async (who = t.w.owner, id = t.w.f.business) =>
    who(`/api/businesses/${id}/digital-desk`);
  // One charged use (by the worker), one awaiting settlement (lost answer), one reserved.
  const s = t.supervisor("worker-a", { timers: inert });
  if (scheduled) s.start();
  const a = await t.reserve(t.w.cara, "desk-key-0001");
  await t.execute(t.w.cara, a);
  for (let i = 0; i < 3; i++) {
    t.sync();
    await s.runPass();
  }
  const c = t.customer(0);
  const lost = await t.reserve(c, "desk-key-0002");
  await t.execute(c, lost);
  t.w.writer.unitModes.push("drop");
  t.sync();
  await s.runPass();
  await t.reserve(t.customer(1), "desk-key-0003");
  return { t, biz, desk, s };
}

describe("001c a working digital business reads as one", () => {
  it("its released, offered product and actual waiting work; no empty legacy offer; nothing private", async () => {
    const { t, desk } = await digital();
    const r = await desk();
    expect(r.status).toBe(200);
    const d = r.body as Json;
    expect(d.kind).toBe("digital");
    expect(d.products.total).toBe(1);
    const p = d.products.shown[0];
    expect(p).toMatchObject({
      project_id: t.w.f.project,
      status: "offered",
      release: { state: "active" },
      offers: { active: 1, retired: 0 },
    });
    // The contract price as recorded: exact base units and the asset, no dollar conversion.
    expect(p.offer.id).toBe(t.offer);
    expect(p.offer.unit_price).toMatch(/^[0-9]+$/);
    expect(typeof p.offer.asset).toBe("string");
    // The legacy offering is empty, so it isn't presented.
    expect(d.legacy_offering).toEqual({ configured: false, title: null });
    expect(d.current).toMatchObject({ awaiting_settlement: 1, reserved_not_settled: 1 });
    // A scheduled worker's pass just ran: it reads running, and that work is the system's.
    expect(d.settlement.worker).toBe("running");
    const system = d.work.find((w: Json) => w.key === "system");
    expect(system).toMatchObject({ who: "system", count: 2, link: { to: "customers" } });
    expect(system.label).toContain("background worker");
    // Owner-safe: no customer identity, document or result.
    const text = JSON.stringify(d);
    for (const secret of ["Stackline", "cara.near", t.w.cara.id, "SH-1042"])
      expect(text).not.toContain(secret);
  });

  it("an overdue worker isn't presented as settling", async () => {
    const { t, desk } = await digital();
    t.advance(24 * 3_600_000); // a day later, no pass
    const d = (await desk()).body as Json;
    expect(d.settlement.worker).toBe("overdue");
    expect(d.work.find((w: Json) => w.key === "system").label).toContain("isn't running");
  });

  it("002d2: passes run only on request are not a running worker", async () => {
    const { desk } = await digital(undefined, false);
    const d = (await desk()).body as Json;
    expect(d.settlement.worker).toBe("not_scheduled");
    expect(d.work.find((w: Json) => w.key === "system").label).toContain("isn't running");
  });
});

describe("001c several products, a brief-only founder, imports and legacy offerings", () => {
  it("each product's own status; a retired offer and a brief are the founder's next steps", async () => {
    const { t, biz, desk } = await digital();
    const second = await t.w.owner("/api/product-projects", "POST", {
      idea: "A fictional agent that drafts supplier replies",
      foundation: "agent_service",
      name: "Reply Drafter",
      business_id: t.w.f.business,
    });
    expect(second.status).toBe(201);
    await t.w.owner(`${biz}/customer-offers/${t.offer}/retire`, "POST");
    const d = (await desk()).body as Json;
    expect(d.products.total).toBe(2);
    const by = (id: string) => d.products.shown.find((p: Json) => p.project_id === id);
    expect(by(second.body.project.id)).toMatchObject({
      name: "Reply Drafter",
      status: "brief_only",
      release: { state: "none" },
    });
    expect(by(t.w.f.project)).toMatchObject({ status: "offer_retired", offer: null });
    const keys = d.work.map((w: Json) => w.key);
    expect(keys).toContain(`build:${second.body.project.id}`);
    expect(keys).toContain(`offer:${t.w.f.project}`);
    // A saved brief is never a release.
    expect(d.work.find((w: Json) => w.key === `build:${second.body.project.id}`).label).toContain(
      "no release yet",
    );
  });

  it("a brief-only founder: digital, no customer work invented", async () => {
    const t = await maintenanceWorld();
    const bea = t.w.person("Bea Fictional");
    const p = await bea("/api/product-projects", "POST", {
      idea: "A fictional portal for tutoring clients",
      foundation: "client_portal",
    });
    const id = p.body.project.business_id as string;
    const d = (await bea(`/api/businesses/${id}/digital-desk`)).body as Json;
    expect(d.kind).toBe("digital");
    // The name is the saved brief's own (its default), not invented.
    expect(d.products.shown[0]).toMatchObject({ status: "brief_only", name: "Untitled product" });
    expect(d.work.map((w: Json) => w.key)).toEqual([`build:${p.body.project.id}`]);
    expect(d.work[0].label).toContain("no release yet");
    expect(d.current).toEqual({
      awaiting_settlement: 0,
      needs_attention: 0,
      reserved_not_settled: 0,
      awaiting_reservation: 0,
      awaiting_signature: 0,
    });
  });

  it("a legacy class business stays legacy; an imported product or a configured offering is recognised", async () => {
    const t = await maintenanceWorld();
    const dee = t.w.person("Dee Fictional");
    const start = await dee("/api/projects", "POST", { route: "idea", name: "Fictional Pottery" });
    const id = start.body.business.id as string;
    await dee(`/api/businesses/${id}`, "PATCH", { family: "class" });
    const read = async () => (await dee(`/api/businesses/${id}/digital-desk`)).body as Json;
    expect((await read()).kind).toBe("legacy");
    expect((await read()).legacy_offering.configured).toBe(false);
    await dee(`/api/businesses/${id}/offer`, "PATCH", { title: "Wheel throwing for beginners" });
    expect((await read()).legacy_offering).toEqual({
      configured: true,
      title: "Wheel throwing for beginners",
    });
    const imp = await dee("/api/imports", "POST", {
      idempotency_key: "desk-import-0001",
      name: "Fictional booking widget",
      product_kind: "saas",
      business_id: id,
    });
    expect(imp.status).toBeLessThan(300);
    const after = await read();
    expect(after.kind).toBe("digital");
    expect(after.imports.total).toBe(1);
  });

  it("products are bounded, newest first, with the true total", async () => {
    const t = await maintenanceWorld();
    for (let i = 0; i < DESK_PRODUCTS + 1; i++)
      await t.w.owner("/api/product-projects", "POST", {
        idea: `Fictional product number ${i}`,
        foundation: "ai_api",
        name: `Fictional ${i}`,
        business_id: t.w.f.business,
      });
    const d = (await t.w.owner(`/api/businesses/${t.w.f.business}/digital-desk`)).body as Json;
    expect(d.products.total).toBe(DESK_PRODUCTS + 2);
    expect(d.products.shown).toHaveLength(DESK_PRODUCTS);
  });
});

describe("001c ownership", () => {
  it("another founder and a customer see nothing", async () => {
    const { t, desk } = await digital();
    const bea = await t.w.rw.founder("Bea Fictional");
    expect((await desk(bea.ava)).status).toBe(404);
    expect((await desk(t.w.cara)).status).toBe(404);
  });

  it("after the actual reconciliation the buyer has the same desk and the former owner nothing", async () => {
    const transport = new FixtureV3Transport();
    const { t, biz, desk } = await digital(transport);
    const before = (await desk()).body as Json;
    const buyer = t.w.person("Noah Fenn");
    t.w.link(t.w.f.ava.id, "founder.near");
    t.w.link(buyer.id, "buyer.near");
    await t.w.owner(`${biz}/v3/refresh`, "POST", {});
    const intent = (
      await t.w.owner(`${biz}/v3/intents`, "POST", {
        idempotency_key: "desk-intent-0001",
        deal_seq: "1",
        version: 1,
        digest: V3_DIGEST,
      })
    ).body.intent.id as string;
    transport.next(V3_CLOSED);
    t.w.chain.afterSale();
    expect((await buyer(`${biz}/v3/intents/${intent}/reconcile`, "POST")).body.state).toBe(
      "applied",
    );
    expect((await desk()).status).toBe(404);
    const theirs = (await desk(buyer)).body as Json;
    expect(theirs.products).toEqual(before.products);
    expect(theirs.current).toEqual(before.current);
  });
});
