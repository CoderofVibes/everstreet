// Job 003s: the acquisition workspace controllers over the REAL API. Two synthetic sources, kept
// coherent and labelled: the v3 OBSERVATION transport serves the contract-produced fixtures
// (direct-accepting, then direct-closed: the same deal), and the customer-use chain double serves
// the customer's entitlement (its after-sale control is also contract-produced). What contract
// fixtures prove: the deal's identity, terms and closed outcome. What these app tests prove:
// recording, receipts, explicit reconciliation, access and customer continuity in the app.
// No browser, no network, no signing.

import { describe, expect, it } from "vitest";
import {
  type CustomerWorld,
  customerWorld,
  type Json,
  SyntheticProtection,
} from "../../server/test/customer-world.ts";
import {
  editView,
  FixtureV3Transport,
  V3_ACCEPTING,
  V3_CLOSED,
  V3_DIGEST,
} from "../../server/test/v3-fixture-transport.ts";
import { ApiError } from "../src/api.ts";
import { MalformedAnswer } from "../src/customerApi.ts";
import { Handovers, OwnerHandover } from "../src/handover.ts";
import type { HandoverPort } from "../src/handoverApi.ts";

const INVOICE =
  "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD";

type Caller = CustomerWorld["owner"];

function portFor(who: Caller, override: Partial<HandoverPort> = {}): HandoverPort {
  const go = async (path: string, method = "GET", body?: unknown) => {
    const r = await who(path, method, body);
    if (r.status >= 400)
      throw new ApiError(r.status, r.body.error ?? "failed", r.body.code, r.body.detail);
    return r.body;
  };
  const b = (id: string) => `/api/businesses/${id}`;
  return {
    evidence: (id) => go(`${b(id)}/v3`),
    refresh: (id) => go(`${b(id)}/v3/refresh`, "POST", {}),
    intents: (id) => go(`${b(id)}/v3/intents`),
    record: (id, body) => go(`${b(id)}/v3/intents`, "POST", body),
    receipt: (id, i) => go(`${b(id)}/v3/intents/${i}`),
    reconcile: (id, i) => go(`${b(id)}/v3/intents/${i}/reconcile`, "POST"),
    mine: () => go("/api/me/v3/handovers"),
    ...override,
  };
}

class MemoryStorage {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

let keys = 0;
const makeKey = () => `handover-key-${String(++keys).padStart(4, "0")}`;

async function world() {
  const t = new FixtureV3Transport();
  const w = await customerWorld({
    customer: { protection: new SyntheticProtection() },
    v3Transport: t,
  });
  const noah = w.person("Noah Fenn");
  w.link(w.f.ava.id, "founder.near");
  w.link(noah.id, "buyer.near");
  const owner = (storage: MemoryStorage | null = null, port = portFor(w.owner)) =>
    new OwnerHandover(port, {
      personId: w.f.ava.id,
      businessId: w.f.business,
      storage: storage as never,
      makeKey,
    });
  const authority = () => ({
    owner: (
      w.state.store.db
        .prepare("SELECT owner_id FROM businesses WHERE id = ?")
        .get(w.f.business) as {
        owner_id: string;
      }
    ).owner_id,
    history: (
      w.state.store.db
        .prepare("SELECT COUNT(*) AS n FROM ownership WHERE business_id = ?")
        .get(w.f.business) as { n: number }
    ).n,
  });
  return { w, t, noah, owner, authority };
}

/** One complete customer use through the real API: reserved, run, charged. */
async function oneUse(w: CustomerWorld, offer: string, key: string) {
  w.clock.now = Number(w.chain.ts);
  const p = await w.cara(`/api/customer/offers/${offer}/prepare`, "POST", {
    idempotency_key: key,
    input: INVOICE,
  });
  expect(p.status).toBe(201);
  const id = p.body.use.id as string;
  await w.cara(`/api/customer/uses/${id}/confirm`, "POST", w.signed(p.body.use.envelope));
  w.clock.now = Number(w.chain.ts);
  await w.cara(`/api/customer/uses/${id}/execute`, "POST", {});
  let unit = "";
  for (let i = 0; i < 3 && unit !== "charged"; i++) {
    w.clock.now = Number(w.chain.ts);
    unit = (await w.cara(`/api/customer/uses/${id}/units/reconcile`, "POST")).body.use.units.unit;
  }
  expect(unit).toBe("charged");
  return id;
}

describe("003s owner: review and record the exact observed deal", () => {
  it("reads, reviews and records without typing; opening or refreshing never applies anything", async () => {
    const { w, owner, authority } = await world();
    const s = owner();
    await s.start();
    expect(s.getState().evidence?.state).toBe("never_observed");
    const before = authority();
    await s.refreshEvidence();
    const deal = s.getState().evidence?.observed?.deal;
    expect(deal).toMatchObject({
      seq: "1",
      version: 1,
      digest: V3_DIGEST,
      state: "accepting",
      buyer: "buyer.near",
      price: "300000000000000000000",
      grants: [{ account: "meter2.near", caps: 1 }],
    });
    s.review();
    expect(s.getState().reviewing?.digest).toBe(V3_DIGEST);
    await s.record();
    expect(s.getState().intents).toMatchObject([
      { status: "recorded", deal: { seq: "1", version: 1, digest: V3_DIGEST } },
    ]);
    // Reading again changes no authority: nothing reconciles implicitly.
    await s.refreshEvidence();
    await s.start();
    expect(authority()).toEqual(before);
    expect(w.state.store.db.prepare("SELECT COUNT(*) AS n FROM v3_intents").get()).toEqual({
      n: 1,
    });
  });

  it("revised terms set the review aside; recording needs a fresh review", async () => {
    const { t, owner } = await world();
    const s = owner();
    await s.start();
    await s.refreshEvidence();
    s.review();
    // Synthetic, coherent: the seller revised the deal (version 2), clearing both acceptances.
    t.next(
      editView(V3_ACCEPTING, "get_control", (c) => {
        c.control_seq = "7";
        c.live_deal.version = 2;
        c.live_deal.digest = "e".repeat(64);
        c.live_deal.state = "proposed";
        c.live_deal.seller_accepted = false;
        c.live_deal.buyer_accepted = false;
      }),
    );
    await s.refreshEvidence();
    expect(s.getState().reviewing).toBeNull();
    await s.record();
    expect(s.getState().notice?.code).toBe("not_reviewed");
    expect(s.getState().intents).toHaveLength(0);
    s.review();
    await s.record();
    expect(s.getState().intents).toMatchObject([{ deal: { version: 2 } }]);
  });

  for (const how of ["network", "502", "malformed"] as const)
    it(`a lost record answer (${how}) is recovered as the same intent, also after a reload`, async () => {
      const { w, owner } = await world();
      const real = portFor(w.owner);
      let lose = true;
      const port = portFor(w.owner, {
        record: async (b, body) => {
          const r = await real.record(b, body);
          if (!lose) return r;
          lose = false;
          if (how === "network") throw new TypeError("network");
          if (how === "502") throw new ApiError(502, "bad gateway");
          throw new MalformedAnswer("garbled");
        },
      });
      const storage = new MemoryStorage();
      const s = owner(storage, port);
      await s.start();
      await s.refreshEvidence();
      s.review();
      await s.record();
      expect(s.getState().unanswered).toEqual({ seq: "1", version: 1 });
      expect(s.getState().busy).toBeNull();
      s.review();
      await s.record();
      expect(s.getState().notice?.code).toBe("recover_first");
      // A reload: a new page finds the same request in session storage.
      s.dispose();
      const again = owner(storage);
      await again.start();
      expect(again.getState().unanswered).toEqual({ seq: "1", version: 1 });
      await again.recoverOriginal();
      expect(again.getState().unanswered).toBeNull();
      expect(w.state.store.db.prepare("SELECT COUNT(*) AS n FROM v3_intents").get()).toEqual({
        n: 1,
      });
      expect(storage.m.size).toBe(0);
    });
});

describe("003s owner: a record answer must name the reviewed deal", () => {
  for (const field of ["seq", "version", "digest"] as const)
    it(`an answer naming another deal ${field} keeps the exact request recoverable`, async () => {
      const { w, owner } = await world();
      const real = portFor(w.owner);
      let tamper = true;
      const port = portFor(w.owner, {
        record: async (b, body) => {
          const r = (await real.record(b, body)) as Json;
          if (!tamper) return r;
          tamper = false;
          const deal = { ...r.intent.deal };
          if (field === "seq") deal.seq = "9";
          else if (field === "version") deal.version = 9;
          else deal.digest = "f".repeat(64);
          return { ...r, intent: { ...r.intent, deal } };
        },
      });
      const s = owner(null, port);
      await s.start();
      await s.refreshEvidence();
      s.review();
      await s.record();
      expect(s.getState().unanswered).toEqual({ seq: "1", version: 1 });
      await s.recoverOriginal();
      expect(s.getState().unanswered).toBeNull();
      expect(s.getState().intents).toHaveLength(1);
    });
});

describe("003s participants: receipts, explicit reconciliation and customer continuity", () => {
  it("the whole journey: customer use → recorded intent → pending → actual close applied once → buyer's first shift", async () => {
    const { w, t, noah, owner, authority } = await world();
    w.state.store.db
      .prepare("UPDATE businesses SET published_at = ? WHERE id = ?")
      .run(new Date().toISOString(), w.f.business);
    const offer = await w.offer();
    const use = await oneUse(w, offer, "hand-use-0001");
    const unitsBefore = w.chain.ent();
    const seller = owner();
    await seller.start();
    await seller.refreshEvidence();
    seller.review();
    await seller.record();
    const intent = seller.getState().intents[0]?.id as string;

    // The buyer's own receipts: the minimal receipt, nothing else about the business.
    const buyer = new Handovers(portFor(noah));
    await buyer.load();
    const h = buyer.getState().handovers;
    expect(h).toMatchObject([
      {
        business: { id: w.f.business },
        you_own_it_now: false,
        receipt: { role: "buyer", status: "recorded", deal: { seq: "1", version: 1 } },
      },
    ]);
    // Opening and loading never reconcile; the first click only explains.
    await buyer.reconcile(h[0] as never);
    expect(buyer.getState().confirmApply).toBe(intent);
    const before = authority();
    expect(before.owner).toBe(w.f.ava.id);
    await buyer.reconcile(h[0] as never);
    expect(buyer.getState().answers[intent]?.state).toBe("pending");
    expect(authority()).toEqual(before);

    // The contract shows this exact deal closed (contract fixtures, both sources coherent).
    t.next(V3_CLOSED);
    w.chain.afterSale();
    // A lost reply after the server applied it: asking again answers "already".
    const real = portFor(noah);
    let lose = true;
    const lossy = new Handovers(
      portFor(noah, {
        reconcile: async (b, i) => {
          const r = await real.reconcile(b, i);
          if (!lose) return r;
          lose = false;
          throw new TypeError("network");
        },
      }),
    );
    await lossy.load();
    const [mine] = lossy.getState().handovers;
    await lossy.reconcile(mine as never);
    await lossy.reconcile(mine as never);
    expect(lossy.getState().notice?.code).toBe("reconcile_unanswered");
    expect(authority()).toEqual({ owner: noah.id, history: before.history + 1 });
    await lossy.reconcile(mine as never);
    await lossy.reconcile(mine as never);
    expect(lossy.getState().answers[intent]?.state).toBe("already");
    expect(lossy.getState().handovers[0]).toMatchObject({
      you_own_it_now: true,
      receipt: { status: "applied", target_generation: 2 },
    });
    // Applied through the actual reconciliation: one entry naming this intent, no other.
    expect(
      w.state.store.db
        .prepare("SELECT to_id, generation, v3_intent_id FROM ownership WHERE business_id = ?")
        .all(w.f.business),
    ).toEqual([{ to_id: noah.id, generation: 2, v3_intent_id: intent }]);

    // The seller's workspace: access ended, only the receipt.
    await seller.start();
    await seller.refreshEvidence();
    // The page that had the business loaded clears it, too.
    expect(seller.getState()).toMatchObject({
      status: "gone",
      evidence: null,
      intents: [],
      reviewing: null,
    });
    const sold = owner();
    await sold.start();
    expect(sold.getState()).toMatchObject({
      status: "gone",
      evidence: null,
      intents: [],
      notice: { code: "access_ended" },
    });
    expect(sold.getState().receipts).toMatchObject([
      { receipt: { role: "seller", status: "applied" }, you_own_it_now: false },
    ]);
    expect(JSON.stringify(sold.getState().receipts)).not.toMatch(/treasury|terms|price|INVOICE/);
    for (const path of [
      `/api/businesses/${w.f.business}/v3`,
      `/api/businesses/${w.f.business}/customer-offers`,
      `/api/businesses/${w.f.business}/v3/intents`,
    ])
      expect((await w.owner(path)).status, path).toBe(404);

    // Buyer's first shift: the normal owner links work.
    for (const path of [
      `/api/businesses/${w.f.business}/v3`,
      `/api/businesses/${w.f.business}/customer-offers`,
      `/api/businesses/${w.f.business}/customer-offer-readiness?project=${w.f.project}`,
    ])
      expect((await noah(path)).status, path).toBe(200);

    // The customer: same request, history and result; units unchanged; neither owner reads them.
    expect((await w.cara(`/api/customer/uses/${use}/result`)).status).toBe(200);
    expect(((await w.cara("/api/customer/uses")).body.uses as Json[]).map((u) => u.id)).toContain(
      use,
    );
    expect(w.chain.ent()).toEqual(unitsBefore);
    for (const who of [w.owner, noah]) {
      expect((await who(`/api/customer/uses/${use}`)).status).toBe(404);
      expect((await who(`/api/customer/uses/${use}/result`)).status).toBe(404);
    }
    // The next use waits for the new owner to appoint platform metering on the contract.
    w.clock.now = Number(w.chain.ts);
    const refused = await w.cara(`/api/customer/offers/${offer}/prepare`, "POST", {
      idempotency_key: "hand-use-0002",
      input: INVOICE,
    });
    expect(refused.body.code).toBe("operator_not_authorized");
    w.chain.reappointPlatform(); // synthetic: the buyer's appoint_operator, done on the contract
    await oneUse(w, offer, "hand-use-0003");
  });

  it("receipts are the participants' alone; nothing about the sale reaches customer discovery", async () => {
    const { w, owner } = await world();
    const s = owner();
    await s.start();
    await s.refreshEvidence();
    s.review();
    await s.record();
    const ana = w.person("Ana Ruiz");
    expect((await ana("/api/me/v3/handovers")).body.handovers).toEqual([]);
    const intent = s.getState().intents[0]?.id as string;
    expect((await ana(`/api/businesses/${w.f.business}/v3/intents/${intent}`)).status).toBe(404);
    // An unpublished business isn't named to the buyer before the sale.
    const noah = w.caller(
      (
        w.state.store.db
          .prepare("SELECT owner_id FROM chain_accounts WHERE account_id = 'buyer.near'")
          .get() as { owner_id: string }
      ).owner_id,
    );
    expect((await noah("/api/me/v3/handovers")).body.handovers[0].business.name).toBeNull();
    // Publish it: customer discovery shows nothing of the sale.
    w.state.store.db
      .prepare("UPDATE businesses SET published_at = ?, slug = 'ledgerline' WHERE id = ?")
      .run(new Date().toISOString(), w.f.business);
    await w.offer();
    for (const path of [
      "/api/public/businesses/ledgerline",
      "/api/public/businesses/ledgerline/customer-offers",
    ]) {
      const r = await ana(path);
      expect(r.status, path).toBe(200);
      const text = JSON.stringify(r.body);
      expect(text, path).not.toMatch(/buyer\.near|intent|300000000000000000000/);
      expect(text, path).not.toContain(V3_DIGEST);
    }
  });

  it("a malformed reconcile answer or a refused one shows plainly and changes nothing here", async () => {
    const { w, noah, owner, authority } = await world();
    const s = owner();
    await s.start();
    await s.refreshEvidence();
    s.review();
    await s.record();
    const before = authority();
    const h = new Handovers(
      portFor(noah, {
        reconcile: async () => ({ state: "applied", message: "yes" }),
      }),
    );
    await h.load();
    const [x] = h.getState().handovers;
    await h.reconcile(x as never);
    await h.reconcile(x as never);
    expect(h.getState().notice?.code).toBe("reconcile_unanswered");
    expect(authority()).toEqual(before);
    expect(w.state.store.db.prepare("SELECT status FROM v3_intents").get()).toEqual({
      status: "recorded",
    });
  });
});
