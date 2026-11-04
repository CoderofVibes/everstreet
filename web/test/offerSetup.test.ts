// Job 003r: the owner's offer-setup controller over the REAL owner offer API (the server side runs
// on the labelled fixture chain and synthetic adapters of server/test). No browser, no network.

import { describe, expect, it } from "vitest";
import {
  type CustomerWorld,
  customerWorld,
  type Json,
  SyntheticProtection,
} from "../../server/test/customer-world.ts";
import { ApiError } from "../src/api.ts";
import { MalformedAnswer } from "../src/customerApi.ts";
import { draftProblem, type OfferPort, OfferSetup } from "../src/offerSetup.ts";

type Caller = CustomerWorld["owner"];

function portFor(who: Caller, _w: CustomerWorld, override: Partial<OfferPort> = {}): OfferPort {
  const go = async (path: string, method = "GET", body?: unknown) => {
    const r = await who(path, method, body);
    if (r.status >= 400) throw new ApiError(r.status, r.body.error ?? "failed", r.body.code);
    return r.body;
  };
  const b = (id: string) => `/api/businesses/${id}`;
  return {
    readiness: (id, p) => go(`${b(id)}/customer-offer-readiness?project=${p}`),
    list: (id) => go(`${b(id)}/customer-offers`),
    inspect: (id, body) => go(`${b(id)}/customer-offer-inspections`, "POST", body),
    create: (id, body) => go(`${b(id)}/customer-offers`, "POST", body),
    retire: (id, o) => go(`${b(id)}/customer-offers/${o}/retire`, "POST"),
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
class DeniedStorage extends MemoryStorage {
  override setItem(): void {
    throw new Error("denied");
  }
}

let keys = 0;
const setupFor = (w: CustomerWorld, who: Caller, port = portFor(who, w), storage = null as never) =>
  new OfferSetup(port, {
    personId: who.id,
    businessId: w.f.business,
    projectId: w.f.project,
    storage,
    makeKey: () => `offer-ui-${String(++keys).padStart(4, "0")}`,
  });
const rows = (w: CustomerWorld) =>
  w.state.store.db.prepare("SELECT id, state, plan_id FROM customer_offers").all() as Json[];

async function world() {
  return customerWorld({ customer: { protection: new SyntheticProtection() } });
}

describe("003r founder setup through the controller", () => {
  it("review an inspected plan, create one exact offer, reopen it after reload, reach the customer page", async () => {
    const w = await world();
    w.state.store.db
      .prepare("UPDATE businesses SET published_at = ? WHERE id = ?")
      .run(new Date().toISOString(), w.f.business);
    const s = setupFor(w, w.owner);
    await s.start();
    expect(s.getState().status).toBe("ready");
    expect(s.getState().readiness?.release?.product.name).toEqual(expect.any(String));
    // Nothing reads as observed before an inspection.
    expect(s.getState().readiness?.items.find((i) => i.key === "plan")?.state).toBe("unknown");
    s.setDraft({ plan: "1", retention: "14" });
    await s.inspect();
    const i = s.getState().inspection;
    expect(i).toMatchObject({ plan_id: 1, retention_days: 14, plan: { unit_price: "50000" } });
    expect(i?.block.timestamp_ms).toBe(String(w.chain.ts));
    await s.create();
    const created = s.getState().created as string;
    expect(s.getState().notice?.code).toBe("offer_active");
    expect(rows(w)).toEqual([{ id: created, state: "active", plan_id: 1 }]);
    // A reload is a new page: the offer is there, active, with its exact terms.
    const again = setupFor(w, w.owner);
    await again.start();
    expect(again.getState().offers).toMatchObject([
      { id: created, state: "active", retention_days: 14, plan: { unit_price: "50000" } },
    ]);
    // The actual customer page can read it.
    expect((await w.cara(`/api/public/customer-offers/${created}`)).status).toBe(200);
  });

  it("a review is only of what was inspected: changed values set it aside; invalid ones read nothing", async () => {
    const w = await world();
    const s = setupFor(w, w.owner);
    await s.start();
    await s.inspect();
    expect(s.getState().inspection).not.toBeNull();
    s.setDraft({ plan: "2" });
    expect(s.getState().inspection).toBeNull();
    await s.create();
    expect(s.getState().notice?.code).toBe("not_reviewed");
    const reads = w.chain.calls;
    for (const d of [
      { plan: "0" },
      { plan: "abc" },
      { plan: "1", retention: "400" },
      { retention: "" },
    ]) {
      s.setDraft(d);
      await s.inspect();
      expect(s.getState().notice?.code).toBe("draft_invalid");
    }
    expect(w.chain.calls).toBe(reads);
    expect(rows(w)).toHaveLength(0);
    expect(draftProblem({ plan: "4294967296", retention: "30" })).not.toBeNull();
  });

  for (const how of ["network", "502", "malformed"] as const)
    it(`a lost create answer (${how}) plus an edited draft keeps the original; recovery makes one offer`, async () => {
      const w = await world();
      const real = portFor(w.owner, w);
      let lose = true;
      const port = portFor(w.owner, w, {
        create: async (id, body) => {
          const r = await real.create(id, body);
          if (!lose) return r;
          lose = false;
          if (how === "network") throw new TypeError("network");
          if (how === "502") throw new ApiError(502, "bad gateway");
          throw new MalformedAnswer("garbled");
        },
      });
      const storage = new MemoryStorage();
      const s = setupFor(w, w.owner, port, storage as never);
      await s.start();
      await s.inspect();
      await s.create();
      expect(s.getState().unanswered).toEqual({ plan_id: 1, retention_days: 30 });
      expect(s.getState().busy).toBeNull();
      // The founder edits the draft meanwhile: it stays as typed and can't start another create.
      s.setDraft({ plan: "7", retention: "5" });
      await s.create();
      expect(s.getState().notice?.code).toBe("recover_first");
      expect(s.getState().draft).toEqual({ plan: "7", retention: "5" });
      await s.recoverOriginal();
      expect(s.getState().unanswered).toBeNull();
      expect(s.getState().created).toEqual(expect.any(String));
      expect(rows(w)).toEqual([{ id: s.getState().created, state: "active", plan_id: 1 }]);
      expect(storage.m.size).toBe(0);
    });

  it("after a reload, an unanswered create is offered for recovery from session storage", async () => {
    const w = await world();
    const storage = new MemoryStorage();
    const port = portFor(w.owner, w, {
      create: async () => {
        throw new TypeError("network"); // it never reached the server
      },
    });
    const s = setupFor(w, w.owner, port, storage as never);
    await s.start();
    await s.inspect();
    await s.create();
    expect(s.getState().unanswered).not.toBeNull();
    s.retire();
    const after = setupFor(w, w.owner, portFor(w.owner, w), storage as never);
    await after.start();
    expect(after.getState().unanswered).toEqual({ plan_id: 1, retention_days: 30 });
    await after.recoverOriginal();
    expect(rows(w)).toHaveLength(1);
    expect(after.getState().unanswered).toBeNull();
  });

  it("terms changed on the contract after review: nothing is created and a fresh review is asked", async () => {
    const w = await world();
    const s = setupFor(w, w.owner);
    await s.start();
    await s.inspect();
    w.chain.plan = { ...w.chain.plan, unit_price: "60000" };
    await s.create();
    expect(s.getState().notice?.code).toBe("terms_changed");
    expect(s.getState().inspection).toBeNull();
    expect(s.getState().unanswered).toBeNull();
    expect(rows(w)).toHaveLength(0);
    await s.inspect();
    expect(s.getState().inspection?.plan.unit_price).toBe("60000");
    await s.create();
    expect(rows(w)).toHaveLength(1);
  });

  it("denied storage never blocks creating or recovering", async () => {
    const w = await world();
    const s = setupFor(w, w.owner, portFor(w.owner, w), new DeniedStorage() as never);
    await s.start();
    await s.inspect();
    await s.create();
    expect(s.getState().busy).toBeNull();
    expect(rows(w)).toHaveLength(1);
  });

  it("a malformed readiness answer settles to a retryable error", async () => {
    const w = await world();
    let bad = true;
    const real = portFor(w.owner, w);
    const s = setupFor(
      w,
      w.owner,
      portFor(w.owner, w, {
        readiness: async (b, p) => {
          if (bad) {
            bad = false;
            return { readiness: { items: "nope" } };
          }
          return real.readiness(b, p);
        },
      }),
    );
    await s.start();
    expect([s.getState().status, s.getState().busy]).toEqual(["error", null]);
    await s.refresh();
    expect(s.getState().status).toBe("ready");
  });
});

describe("003r retirement and a sale through the controller", () => {
  it("retiring asks once, targets the exact offer and is safely repeatable", async () => {
    const w = await world();
    const id = await w.offer();
    const s = setupFor(w, w.owner);
    await s.start();
    await s.retireOffer(id);
    expect(s.getState().confirmRetire).toBe(id);
    expect(rows(w)[0]?.state).toBe("active");
    await s.retireOffer(id);
    expect(rows(w)[0]?.state).toBe("retired");
    expect(s.getState().offers[0]?.state).toBe("retired");
    await s.retireOffer(id);
    await s.retireOffer(id);
    expect(s.getState().notice?.code).toBe("offer_retired");
    expect(rows(w)).toEqual([{ id, state: "retired", plan_id: 1 }]);
    // An unknown offer is a plain refusal, not lost access.
    await s.retireOffer("nope");
    await s.retireOffer("nope");
    expect(s.getState().status).toBe("ready");
  });

  it("a sale during an inspection: the former owner's page clears; the buyer manages the offer", async () => {
    const w = await world();
    const id = await w.offer();
    const seller = setupFor(w, w.owner);
    await seller.start();
    const buyer = w.person("Noah Fenn");
    w.reader.duringRead = () => {
      w.rw.transfer(w.f.business, w.f.ava.id, buyer.id);
      w.chain.afterSale();
      w.chain.reappointPlatform();
    };
    await seller.inspect();
    expect(seller.getState()).toMatchObject({
      status: "gone",
      offers: [],
      inspection: null,
      readiness: null,
    });
    const b = setupFor(w, buyer);
    await b.start();
    expect(b.getState().offers.map((o) => o.id)).toEqual([id]);
    await b.inspect();
    expect(b.getState().inspection?.active_offer).toBe(id);
    await b.retireOffer(id);
    await b.retireOffer(id);
    expect(rows(w)[0]?.state).toBe("retired");
  });

  it("a late answer after the page closed lands nowhere", async () => {
    const w = await world();
    const s = setupFor(w, w.owner);
    await s.start();
    const gate = w.reader.holdNextRead();
    const pending = s.inspect();
    await gate.entered;
    s.retire();
    gate.open();
    await pending;
    expect(s.getState().inspection).toBeNull();
  });
});

describe("003r1 a review is only current while its facts and access are", () => {
  const retireRelease = (w: CustomerWorld) =>
    w.state.store.db
      .prepare("UPDATE runtime_releases SET state = 'retired', retired_at = ? WHERE id = ?")
      .run(new Date().toISOString(), w.release);

  it("the release retired, then a refresh: the review is set aside and nothing can be created", async () => {
    const w = await world();
    const s = setupFor(w, w.owner);
    await s.start();
    await s.inspect();
    expect(s.getState().inspection).not.toBeNull();
    retireRelease(w);
    await s.refresh();
    expect(s.getState().readiness?.release).toBeNull();
    expect(s.getState().inspection).toBeNull();
    await s.create();
    expect(s.getState().notice?.code).toBe("not_reviewed");
    expect(rows(w)).toHaveLength(0);
  });

  it("the binding or the ownership generation changed: a refresh sets the review aside", async () => {
    const w = await world();
    const s = setupFor(w, w.owner);
    await s.start();
    await s.inspect();
    w.v3.bindings[0] = { ...w.v3.bindings[0], account: "other.biz.near" } as never;
    w.state.app = w.make(w.state.store);
    await s.refresh();
    expect(s.getState().inspection).toBeNull();
    // Same person, new generation: sold and bought back.
    const v = await world();
    const t = setupFor(v, v.owner);
    await t.start();
    await t.inspect();
    const other = v.person("Noah Fenn");
    v.rw.transfer(v.f.business, v.f.ava.id, other.id);
    v.rw.transfer(v.f.business, other.id, v.f.ava.id);
    await t.refresh();
    expect([t.getState().status, t.getState().inspection]).toEqual(["ready", null]);
  });

  for (const check of ["failed", "malformed"] as const)
    it(`a 404 then an inconclusive access check (${check}): the review is set aside and actions wait for Check access`, async () => {
      const w = await world();
      const id = await w.offer();
      const real = portFor(w.owner, w);
      let breakCheck = false;
      const port = portFor(w.owner, w, {
        retire: async () => {
          breakCheck = true;
          throw new ApiError(404, "No such offer");
        },
        readiness: async (b, p) => {
          if (breakCheck) {
            if (check === "failed") throw new ApiError(503, "unavailable");
            return { readiness: "garbled" };
          }
          return real.readiness(b, p);
        },
      });
      const s = setupFor(w, w.owner, port);
      await s.start();
      await s.inspect();
      await s.retireOffer(id);
      await s.retireOffer(id);
      expect(s.getState()).toMatchObject({
        busy: null,
        access: "unconfirmed",
        inspection: null,
        confirmRetire: null,
        status: "ready",
      });
      // Nothing that changes anything runs until access is confirmed.
      const calls = w.chain.calls;
      await s.inspect();
      await s.create();
      await s.retireOffer(id);
      expect(s.getState().notice?.code).toBe("access_unconfirmed");
      expect(w.chain.calls).toBe(calls);
      expect(rows(w)[0]?.state).toBe("active");
      // Still inconclusive: stays unconfirmed and retryable.
      await s.checkAccess();
      expect(s.getState().access).toBe("unconfirmed");
      breakCheck = false;
      await s.checkAccess();
      expect(s.getState()).toMatchObject({ access: "confirmed", status: "ready" });
      await s.inspect();
      expect(s.getState().inspection).not.toBeNull();
    });

  it("a 404 then a denied check clears the owner's content; a superseded check lands nowhere", async () => {
    const w = await world();
    const id = await w.offer();
    const s = setupFor(w, w.owner);
    await s.start();
    await s.inspect();
    w.rw.transfer(w.f.business, w.f.ava.id, w.person("Noah Fenn").id);
    await s.retireOffer(id);
    await s.retireOffer(id);
    expect(s.getState()).toMatchObject({ status: "gone", inspection: null, offers: [] });
    // Superseded: the page closes while its access check is in flight.
    const v = await world();
    const vid = await v.offer();
    let release: () => void = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    const real = portFor(v.owner, v);
    let hold = false;
    const t = setupFor(
      v,
      v.owner,
      portFor(v.owner, v, {
        retire: async () => {
          hold = true;
          throw new ApiError(404, "No such offer");
        },
        readiness: async (b, p) => {
          if (hold) await held;
          return real.readiness(b, p);
        },
      }),
    );
    await t.start();
    await t.inspect();
    const before = t.getState();
    await t.retireOffer(vid);
    const pending = t.retireOffer(vid);
    t.retire();
    release();
    await pending;
    expect(t.getState().inspection).toEqual(before.inspection); // nothing applied after close
  });

  it("an unanswered create stays recoverable while access is unconfirmed, and after it is confirmed", async () => {
    const w = await world();
    const real = portFor(w.owner, w);
    let mode: "lose" | "check_fails" | "ok" = "lose";
    const port = portFor(w.owner, w, {
      create: async (b, body) => {
        if (mode === "lose") {
          mode = "check_fails";
          throw new TypeError("network");
        }
        return real.create(b, body);
      },
      retire: async () => {
        throw new ApiError(404, "No such offer");
      },
      readiness: async (b, p) => {
        if (mode === "check_fails" && breakNow) throw new ApiError(503, "unavailable");
        return real.readiness(b, p);
      },
    });
    let breakNow = false;
    const s = setupFor(w, w.owner, port);
    await s.start();
    await s.inspect();
    await s.create();
    expect(s.getState().unanswered).toEqual({ plan_id: 1, retention_days: 30 });
    breakNow = true;
    await s.retireOffer("nope");
    await s.retireOffer("nope");
    expect(s.getState().access).toBe("unconfirmed");
    await s.recoverOriginal();
    expect(s.getState().notice?.code).toBe("access_unconfirmed");
    expect(s.getState().unanswered).not.toBeNull();
    breakNow = false;
    mode = "ok";
    await s.checkAccess();
    await s.recoverOriginal();
    expect(s.getState().unanswered).toBeNull();
    expect(rows(w)).toHaveLength(1);
  });

  it("a create answer naming another release, project, source or digest keeps the exact request recoverable", async () => {
    for (const field of ["release_id", "project_id", "artifact_digest", "source"] as const) {
      const w = await world();
      const real = portFor(w.owner, w);
      let tamper = true;
      const port = portFor(w.owner, w, {
        create: async (b, body) => {
          const r = (await real.create(b, body)) as Json;
          if (!tamper) return r;
          tamper = false;
          const o = { ...r.offer };
          if (field === "source") o.source = { network: "testnet", account: "other.biz.near" };
          else if (field === "artifact_digest") o.artifact_digest = "ab".repeat(32);
          else o[field] = "someone-else";
          return { ...r, offer: o };
        },
      });
      const s = setupFor(w, w.owner, port);
      await s.start();
      await s.inspect();
      await s.create();
      expect([field, s.getState().unanswered, s.getState().created]).toEqual([
        field,
        { plan_id: 1, retention_days: 30 },
        null,
      ]);
      await s.recoverOriginal();
      expect([field, s.getState().unanswered, rows(w).length]).toEqual([field, null, 1]);
    }
  });
});
