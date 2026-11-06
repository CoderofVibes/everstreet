// Job 003q: the workspace controller over the REAL customer-use API (the server side runs on the
// labelled fixture chain, scripted extractor and synthetic protection of server/test). The test
// authorizer below is test-only (the contract tests' synthetic seed-1 key); the app bundle ships
// none. No browser, no network.

import { describe, expect, it } from "vitest";
import {
  type CustomerWorld,
  customerWorld,
  type Json,
  keyFromSeed,
  SyntheticProtection,
} from "../../server/test/customer-world.ts";
import { ApiError } from "../src/api.ts";
import type { CustomerPort } from "../src/customerApi.ts";
import type { CustomerAuthorizer } from "../src/customerAuthorizer.ts";
import { CustomerWorkspace, nextStep } from "../src/customerWorkspace.ts";

const INVOICE =
  "Fictional invoice SH-1042 from Stackline Hosting Ltd, 2026-10-14, total 412.50 USD";
const SEED1_PK = "8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c";

type Caller = CustomerWorld["cara"];

/** The port over the real app, as one person's session. */
function portFor(
  who: Caller,
  w: CustomerWorld,
  override: Partial<CustomerPort> = {},
): CustomerPort {
  const go = async (path: string, method = "GET", body?: unknown) => {
    w.clock.now = Number(w.chain.ts);
    const r = await who(path, method, body);
    if (r.status >= 400)
      throw new ApiError(r.status, r.body.error ?? "failed", r.body.code, r.body.detail);
    return r.body;
  };
  return {
    offer: (id) => go(`/api/public/customer-offers/${id}`),
    use: (id) => go(`/api/customer/uses/${id}`),
    uses: () => go("/api/customer/uses?limit=20"),
    byKey: (key) => go(`/api/customer/requests/by-key/${key}`),
    prepare: (o, b) => go(`/api/customer/offers/${o}/prepare`, "POST", b),
    confirm: (id, b) => go(`/api/customer/uses/${id}/confirm`, "POST", b),
    cancel: (id) => go(`/api/customer/uses/${id}/cancel`, "POST"),
    reconcile: (id) => go(`/api/customer/uses/${id}/reconcile`, "POST"),
    execute: (id, b) => go(`/api/customer/uses/${id}/execute`, "POST", b),
    result: (id) => go(`/api/customer/uses/${id}/result`),
    units: (id) => go(`/api/customer/uses/${id}/units/reconcile`, "POST"),
    release: (id) => go(`/api/customer/uses/${id}/release`, "POST"),
    ...override,
  };
}

/** Test-only authorizer: the contract tests' synthetic key. Never in the app bundle. */
function testAuthorizer(seed = 1, calls = { n: 0 }): CustomerAuthorizer {
  const sign = keyFromSeed(seed);
  return {
    label: "Test only: synthetic key",
    synthetic: true,
    publicKey: async () => (seed === 1 ? SEED1_PK : "cd".repeat(32)),
    sign: async (m) => {
      calls.n++;
      return { hold_signature: sign(m.hold_message_hex), use_signature: sign(m.use_message_hex) };
    },
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

async function setup() {
  const protection = new SyntheticProtection();
  const w = await customerWorld({ customer: { protection } });
  const offer = await w.offer();
  // Synthetic: publish the founder's business so its offer is public.
  w.state.store.db
    .prepare("UPDATE businesses SET published_at = ? WHERE id = ?")
    .run(new Date().toISOString(), w.f.business);
  return { w, offer, protection };
}

let keys = 0;
const makeKey = () => `ws-key-${String(++keys).padStart(6, "0")}`;

describe("003q customer workspace controller (real API)", () => {
  it("review → authorize → run → private result → settle → next use, one call and one charge", async () => {
    const { w, offer } = await setup();
    const ws = new CustomerWorkspace(portFor(w.cara, w), {
      personId: w.cara.id,
      offerId: offer,
      authorizer: () => testAuthorizer(),
      now: () => w.clock.now,
      makeKey,
    });
    await ws.start();
    expect(ws.getState()).toMatchObject({ status: "ready", offer: { offer_id: offer } });
    expect(nextStep(ws.getState()).action).toBe(null);
    ws.setDraft(INVOICE);
    expect(nextStep(ws.getState()).action).toBe("prepare");
    await ws.prepare();
    expect(ws.getState().use?.state).toBe("prepared");
    expect(ws.getState().check).toEqual({ ok: true, problem: null });
    expect(nextStep(ws.getState()).action).toBe("authorize");
    // Typing ahead never changes the prepared request.
    ws.setDraft("A different document typed while reviewing");
    await ws.authorize();
    expect(ws.getState().use?.state).toBe("reserved");
    expect(ws.getState().accepted).toBe(INVOICE);
    const calls = w.provider.calls.length;
    await ws.run();
    expect(ws.getState().use?.execution).toMatchObject({ fulfilled: true, result: "available" });
    expect(w.provider.calls.length - calls).toBe(1);
    expect(nextStep(ws.getState()).action).toBe("show_result");
    await ws.showResult();
    expect(ws.getState().result?.result.fields.find((f) => f.key === "vendor")?.value).toBe(
      "Stackline Hosting Ltd",
    );
    for (let i = 0; i < 3 && ws.getState().use?.units.unit !== "charged"; i++) await ws.checkUnit();
    const units = ws.getState().use?.units;
    expect(units).toMatchObject({
      unit: "charged",
      source: { observed: { free: "99", consumed: "1" } },
    });
    expect([w.writer.settleCalls, w.chain.charged]).toEqual([1, 1]);
    expect(nextStep(ws.getState()).action).toBe("start_another");
    expect(ws.getState().recent[0]).toMatchObject({ id: ws.getState().use?.id, unit: "charged" });
    ws.startAnother();
    expect(ws.getState()).toMatchObject({ use: null, result: null, accepted: null });
    ws.setDraft(INVOICE);
    await ws.prepare();
    expect(ws.getState().use?.reservation.hold_seq).toBe(2);
  });

  it("a lost prepare answer is retried with the same key: one request, not two", async () => {
    const { w, offer } = await setup();
    let lose = true;
    const base = portFor(w.cara, w);
    const port = portFor(w.cara, w, {
      prepare: async (o, b) => {
        const r = await base.prepare(o, b);
        if (lose) {
          lose = false;
          throw new TypeError("network: the answer was lost");
        }
        return r;
      },
    });
    const ws = new CustomerWorkspace(port, {
      personId: w.cara.id,
      offerId: offer,
      authorizer: () => testAuthorizer(),
      now: () => w.clock.now,
      makeKey,
    });
    await ws.start();
    ws.setDraft(INVOICE);
    await ws.prepare();
    expect(ws.getState()).toMatchObject({ use: null, notice: { tone: "error" } });
    expect(ws.getState().notice?.message).toMatch(/same request/);
    await ws.prepare();
    expect(ws.getState().use?.state).toBe("prepared");
    expect(w.state.store.db.prepare("SELECT COUNT(*) AS n FROM customer_requests").get()).toEqual({
      n: 1,
    });
  });

  it("after a reload the request resumes from its id, and the same document must be pasted to check it", async () => {
    const { w, offer } = await setup();
    const storage = new MemoryStorage();
    const first = new CustomerWorkspace(portFor(w.cara, w), {
      personId: w.cara.id,
      offerId: offer,
      authorizer: () => testAuthorizer(),
      now: () => w.clock.now,
      storage,
      makeKey,
    });
    await first.start();
    first.setDraft(INVOICE);
    await first.prepare();
    first.retire();
    // Only an opaque key and request id were stored: no document, no envelope.
    const stored = [...storage.m.values()].join(" ");
    expect(stored).not.toContain("Stackline");
    expect(stored).not.toContain("salt");
    const again = new CustomerWorkspace(portFor(w.cara, w), {
      personId: w.cara.id,
      offerId: offer,
      authorizer: () => testAuthorizer(),
      now: () => w.clock.now,
      storage,
      makeKey,
    });
    await again.start();
    expect(again.getState().use?.state).toBe("prepared");
    expect(again.getState().accepted).toBeNull();
    expect(nextStep(again.getState()).action).toBe("match_document");
    again.setDraft(`${INVOICE} (edited)`);
    await again.matchDocument();
    expect(again.getState().notice?.code).toBe("input_mismatch");
    again.setDraft(INVOICE);
    await again.matchDocument();
    expect(again.getState().check?.ok).toBe(true);
  });

  it("no authorizer: the review works, authorizing is explained as unavailable, nothing is sent", async () => {
    const { w, offer } = await setup();
    const ws = new CustomerWorkspace(portFor(w.cara, w), {
      personId: w.cara.id,
      offerId: offer,
      authorizer: () => null,
      now: () => w.clock.now,
      makeKey,
    });
    await ws.start();
    ws.setDraft(INVOICE);
    await ws.prepare();
    expect(ws.getState().check?.ok).toBe(true);
    expect(nextStep(ws.getState())).toMatchObject({
      action: null,
      label: "Authorizing isn't available here",
    });
    await ws.authorize();
    expect(ws.getState().notice?.code).toBe("authorization_unavailable");
    expect(ws.getState().use?.state).toBe("prepared");
    expect(w.writer.calls).toBe(0);
  });

  it("a key that isn't the envelope's is never asked to sign", async () => {
    const { w, offer } = await setup();
    const calls = { n: 0 };
    const ws = new CustomerWorkspace(portFor(w.cara, w), {
      personId: w.cara.id,
      offerId: offer,
      authorizer: () => testAuthorizer(2, calls),
      now: () => w.clock.now,
      makeKey,
    });
    await ws.start();
    ws.setDraft(INVOICE);
    await ws.prepare();
    expect(ws.getState().check).toEqual({
      ok: false,
      problem: "This request names a key that isn't yours.",
    });
    await ws.authorize();
    expect(calls.n).toBe(0);
    expect(ws.getState().use?.state).toBe("prepared");
  });

  it("review #65: with verified sign-in, nothing is prepared until this device's key is ready", async () => {
    const { w, offer } = await setup();
    let device: CustomerAuthorizer | null = null;
    const ws = new CustomerWorkspace(portFor(w.cara, w), {
      personId: w.cara.id,
      offerId: offer,
      authorizer: () => device,
      requireAuthorizer: true,
      now: () => w.clock.now,
      makeKey,
    });
    await ws.start();
    ws.setDraft(INVOICE);
    expect(nextStep(ws.getState())).toMatchObject({
      action: null,
      label: "Set up this device first",
    });
    await ws.prepare();
    expect(ws.getState().use).toBeNull();
    expect(ws.getState().notice?.code).toBe("device_first");
    // The device becomes ready: now the request is reviewed with this key.
    device = testAuthorizer();
    ws.refreshAuthorizer();
    expect(nextStep(ws.getState())).toMatchObject({ action: "prepare" });
    await ws.prepare();
    expect(ws.getState().check?.ok).toBe(true);
    expect(nextStep(ws.getState())).toMatchObject({ action: "authorize" });
  });

  it("review #65: a key that changes after the review is checked at once; no stale Authorize", async () => {
    const { w, offer } = await setup();
    let device: CustomerAuthorizer = testAuthorizer();
    const ws = new CustomerWorkspace(portFor(w.cara, w), {
      personId: w.cara.id,
      offerId: offer,
      authorizer: () => device,
      now: () => w.clock.now,
      makeKey,
    });
    await ws.start();
    ws.setDraft(INVOICE);
    await ws.prepare();
    expect(ws.getState().check?.ok).toBe(true);
    // Another key takes over (different label so the change is seen).
    const other = testAuthorizer(2);
    device = { ...other, label: "Another device", publicKey: other.publicKey, sign: other.sign };
    ws.refreshAuthorizer();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(ws.getState().check).toEqual({
      ok: false,
      problem: "This request names a key that isn't yours.",
    });
    expect(nextStep(ws.getState()).action).not.toBe("authorize");
  });

  it("a malformed answer changes nothing; access lost clears everything private", async () => {
    const { w, offer } = await setup();
    let garble = false;
    const base = portFor(w.cara, w);
    const port = portFor(w.cara, w, {
      use: async (id) => (garble ? { use: { id, state: "bogus" } } : base.use(id)),
    });
    const ws = new CustomerWorkspace(port, {
      personId: w.cara.id,
      offerId: offer,
      authorizer: () => testAuthorizer(),
      now: () => w.clock.now,
      makeKey,
    });
    await ws.start();
    ws.setDraft(INVOICE);
    await ws.prepare();
    await ws.authorize();
    const before = ws.getState().use;
    garble = true;
    await ws.refresh();
    expect(ws.getState().use).toBe(before);
    expect(ws.getState().notice?.message).toMatch(/expected form/);
    // The business is sold and this session now belongs to someone else: 404 on the request.
    const lena = w.person("Lena Park");
    const other = new CustomerWorkspace(portFor(lena, w), {
      personId: lena.id,
      useId: (before as Json).id,
      authorizer: () => null,
      makeKey,
    });
    await other.start();
    expect(other.getState()).toMatchObject({ status: "gone", use: null, result: null, draft: "" });
  });

  it("a late answer after the page moved on lands nowhere", async () => {
    const { w, offer } = await setup();
    let release: () => void = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    const base = portFor(w.cara, w);
    const port = portFor(w.cara, w, {
      execute: async (id, b) => {
        await held;
        return base.execute(id, b);
      },
    });
    const ws = new CustomerWorkspace(port, {
      personId: w.cara.id,
      offerId: offer,
      authorizer: () => testAuthorizer(),
      now: () => w.clock.now,
      makeKey,
    });
    await ws.start();
    ws.setDraft(INVOICE);
    await ws.prepare();
    await ws.authorize();
    const running = ws.run();
    ws.retire();
    release();
    await running;
    expect(ws.getState().use?.execution).toBeNull();
  });

  it("a retired offer can't be started, but the customer's own request still resumes", async () => {
    const { w, offer } = await setup();
    const ws = new CustomerWorkspace(portFor(w.cara, w), {
      personId: w.cara.id,
      offerId: offer,
      authorizer: () => testAuthorizer(),
      now: () => w.clock.now,
      makeKey,
    });
    await ws.start();
    ws.setDraft(INVOICE);
    await ws.prepare();
    const id = ws.getState().use?.id as string;
    await w.owner(`/api/businesses/${w.f.business}/customer-offers/${offer}/retire`, "POST");
    const fresh = new CustomerWorkspace(portFor(w.cara, w), {
      personId: w.cara.id,
      offerId: offer,
      authorizer: () => null,
      makeKey,
    });
    await fresh.start();
    expect(fresh.getState().status).toBe("gone");
    const resumed = new CustomerWorkspace(portFor(w.cara, w), {
      personId: w.cara.id,
      useId: id,
      authorizer: () => null,
      makeKey,
    });
    await resumed.start();
    expect(resumed.getState()).toMatchObject({
      status: "ready",
      use: { id, offer: { offer_state: "retired" } },
    });
  });
});

// ---------- 003q1: recovering the original request; storage denied; honest statuses ----------

/** A port whose next prepare commits on the server, then loses its answer in the given way. */
function losingPrepare(w: CustomerWorld, how: "network" | "502" | "malformed") {
  const base = portFor(w.cara, w);
  let lose = true;
  return portFor(w.cara, w, {
    prepare: async (o, b) => {
      const r = await base.prepare(o, b);
      if (!lose) return r;
      lose = false;
      if (how === "network") throw new TypeError("network: the answer was lost");
      if (how === "502") throw new ApiError(502, "Preview: the answer was lost on the way back.");
      return { use: { id: "garbled" } };
    },
  });
}

class DeniedStorage {
  getItem(): string | null {
    throw new Error("SecurityError: storage denied");
  }
  setItem() {
    throw new Error("SecurityError: storage denied");
  }
  removeItem() {
    throw new Error("SecurityError: storage denied");
  }
}

const OTHER = "Fictional invoice B from Alder Supply, total 10.00 USD";

describe("003q1 recovering the original request", () => {
  for (const how of ["network", "502", "malformed"] as const)
    it(`a lost prepare answer (${how}) is recovered as the original, whatever the draft now says`, async () => {
      const { w, offer } = await setup();
      const ws = new CustomerWorkspace(losingPrepare(w, how), {
        personId: w.cara.id,
        offerId: offer,
        authorizer: () => testAuthorizer(),
        now: () => w.clock.now,
        makeKey,
      });
      await ws.start();
      ws.setDraft(INVOICE);
      await ws.prepare();
      expect(ws.getState().use).toBeNull();
      expect(ws.getState().unanswered).toEqual({ chars: INVOICE.length });
      expect(nextStep(ws.getState()).action).toBe("recover_original");
      // The customer edits ahead (or clears, or overfills) the composer: no new request is made.
      for (const draft of [OTHER, "", "x".repeat(25_000)]) {
        ws.setDraft(draft);
        await ws.prepare();
        expect(ws.getState().notice?.code).toBe("recover_first");
      }
      ws.setDraft(OTHER);
      await ws.recoverOriginal();
      expect(ws.getState().use?.state).toBe("prepared");
      expect(ws.getState().accepted).toBe(INVOICE);
      expect(ws.getState().draft).toBe(OTHER); // the typed-ahead draft is kept, separately
      expect(ws.getState().check?.ok).toBe(true);
      expect(ws.getState().unanswered).toBeNull();
      expect(w.state.store.db.prepare("SELECT COUNT(*) AS n FROM customer_requests").get()).toEqual(
        { n: 1 },
      );
      expect(ws.getState().recent.map((r) => r.id)).toEqual([ws.getState().use?.id]);
    });

  it("after a reload the original is found by its exact key; the same document must be pasted", async () => {
    const { w, offer } = await setup();
    const storage = new MemoryStorage();
    const first = new CustomerWorkspace(losingPrepare(w, "network"), {
      personId: w.cara.id,
      offerId: offer,
      authorizer: () => testAuthorizer(),
      now: () => w.clock.now,
      storage,
      makeKey,
    });
    await first.start();
    first.setDraft(INVOICE);
    await first.prepare();
    first.retire();
    const stored = [...storage.m.values()];
    expect(stored.join(" ")).not.toContain("Stackline"); // only the opaque key
    const again = new CustomerWorkspace(portFor(w.cara, w), {
      personId: w.cara.id,
      offerId: offer,
      authorizer: () => testAuthorizer(),
      now: () => w.clock.now,
      storage,
      makeKey,
    });
    await again.start();
    expect(again.getState().use?.state).toBe("prepared");
    expect(nextStep(again.getState()).action).toBe("match_document");
    // Another person's session can't use that key, even if it were put in their storage.
    const lena = w.person("Lena Park");
    const theirs = new MemoryStorage();
    theirs.setItem(`everstreet.use.${lena.id}.${offer}`, stored[0] as string);
    const other = new CustomerWorkspace(portFor(lena, w), {
      personId: lena.id,
      offerId: offer,
      authorizer: () => null,
      storage: theirs,
      makeKey,
    });
    await other.start();
    expect(other.getState().use).toBeNull();
  });

  it("an attempt that never reached the server is reported after a reload, not silently replaced", async () => {
    const { w, offer } = await setup();
    const storage = new MemoryStorage();
    const port = portFor(w.cara, w, {
      prepare: async () => {
        throw new TypeError("network: never arrived");
      },
    });
    const first = new CustomerWorkspace(port, {
      personId: w.cara.id,
      offerId: offer,
      authorizer: () => null,
      now: () => w.clock.now,
      storage,
      makeKey,
    });
    await first.start();
    first.setDraft(INVOICE);
    await first.prepare();
    first.retire();
    const again = new CustomerWorkspace(portFor(w.cara, w), {
      personId: w.cara.id,
      offerId: offer,
      authorizer: () => null,
      now: () => w.clock.now,
      storage,
      makeKey,
    });
    await again.start();
    expect(again.getState()).toMatchObject({
      use: null,
      notice: { code: "earlier_attempt_not_recorded" },
    });
  });

  it("storage denied: nothing stays busy, and in-session recovery still works", async () => {
    const { w, offer } = await setup();
    const ws = new CustomerWorkspace(losingPrepare(w, "network"), {
      personId: w.cara.id,
      offerId: offer,
      authorizer: () => testAuthorizer(),
      now: () => w.clock.now,
      storage: new DeniedStorage(),
      makeKey,
    });
    await ws.start();
    ws.setDraft(INVOICE);
    await ws.prepare();
    expect(ws.getState().busy).toBeNull();
    await ws.recoverOriginal();
    expect(ws.getState().use?.state).toBe("prepared");
    await ws.authorize();
    expect(ws.getState().use?.state).toBe("reserved");
  });

  it("statuses agree: prepared holds nothing, charged reads completed (workspace and list)", async () => {
    const { w, offer } = await setup();
    const ws = new CustomerWorkspace(portFor(w.cara, w), {
      personId: w.cara.id,
      offerId: offer,
      authorizer: () => testAuthorizer(),
      now: () => w.clock.now,
      makeKey,
    });
    await ws.start();
    ws.setDraft(INVOICE);
    await ws.prepare();
    expect(ws.getState().use?.units.unit).toBe("not_held");
    expect(ws.getState().recent[0]?.unit).toBe("not_held");
    await ws.authorize();
    await ws.run();
    for (let i = 0; i < 3 && ws.getState().use?.units.unit !== "charged"; i++) await ws.checkUnit();
    expect(ws.getState().use?.headline.title).toBe("Completed");
    expect(ws.getState().recent[0]).toMatchObject({
      unit: "charged",
      headline: { title: "Completed" },
    });
  });
});

describe("003r1 a cancelled use waits honestly for its authorization window", () => {
  const ws = (w: CustomerWorld, offer: string) =>
    new CustomerWorkspace(portFor(w.cara, w), {
      personId: w.cara.id,
      offerId: offer,
      authorizer: () => testAuthorizer(),
      now: () => w.clock.now,
      makeKey,
    });

  it("after cancelling (review #66): back to the document, the wait said once with its deadline", async () => {
    const { w, offer } = await setup();
    const s = ws(w, offer);
    await s.start();
    s.setDraft(INVOICE);
    await s.prepare();
    const first = s.getState().use?.id;
    const acceptBy = s.getState().use?.envelope?.consent.accept_by_ms as string;
    await s.cancel();
    // The request is cancelled (it stays in the history); the page is back at the document.
    expect(s.getState().use).toBeNull();
    expect(s.getState().draft).toBe(INVOICE);
    expect(s.getState().waiting).toEqual({ request_id: first, until_ms: acceptBy });
    const next = nextStep(s.getState());
    expect([next.action, next.label]).toEqual(["prepare", "Check again and review"]);
    expect(next.why).toMatch(/stays valid/);
    expect(next.why).not.toMatch(/charged|reserved/i);
    const count = () =>
      (
        w.state.store.db.prepare("SELECT COUNT(*) AS n FROM customer_requests").get() as {
          n: number;
        }
      ).n;
    // Trying before the deadline creates nothing: the contract may still accept the old one.
    await s.prepare();
    expect(s.getState().use).toBeNull();
    expect(count()).toBe(1);
    // After the deadline (both clocks), the same document makes a new request.
    w.chain.tick(BigInt(acceptBy) - w.chain.ts + 1n);
    w.clock.now = Number(w.chain.ts);
    s.setDraft(`${INVOICE} (second)`);
    await s.prepare();
    expect(s.getState().use?.state).toBe("prepared");
    expect(count()).toBe(2);
  });

  it("a new request refused inside the window keeps the next draft and explains the wait", async () => {
    const { w, offer } = await setup();
    const s = ws(w, offer);
    await s.start();
    s.setDraft(INVOICE);
    await s.prepare();
    const first = s.getState().use;
    const acceptBy = first?.envelope?.consent.accept_by_ms as string;
    await s.cancel();
    s.startAnother(); // e.g. from a stale page that still offered it
    const next = "Fictional invoice SH-2001 from Stackline Hosting Ltd, total 99.00 USD";
    s.setDraft(next);
    await s.prepare();
    expect(s.getState()).toMatchObject({
      use: null,
      draft: next,
      busy: null,
      unanswered: null,
      waiting: { request_id: first?.id, until_ms: acceptBy },
      notice: { code: "previous_window_open" },
    });
    const step = nextStep(s.getState());
    expect([step.action, step.label]).toEqual(["prepare", "Check again and review"]);
    expect(step.why).toMatch(/stays valid/);
    // At the deadline exactly, a block may still accept it: still refused (the barrier is kept).
    w.chain.tick(BigInt(acceptBy) - w.chain.ts);
    w.clock.now = Number(w.chain.ts);
    await s.prepare();
    expect(s.getState().notice?.code).toBe("previous_window_open");
    w.chain.tick(1n);
    w.clock.now = Number(w.chain.ts);
    await s.prepare();
    expect(s.getState()).toMatchObject({ waiting: null, use: { state: "prepared" } });
    expect(s.getState().accepted).toBe(next);
  });
});
