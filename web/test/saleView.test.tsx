// Job 001i: the sale workspace's rules, driven by the actual owner controller over the REAL API
// with the contract-produced v3 fixtures (synthetic, labelled; no browser, network or signing).
// What these prove: the progress never calls the close or the takeover completed before an applied
// intent exists, a revised version is never covered by an older record, the one next action
// follows the real state (access, recovery, review, outcome), and the continuity panel keeps
// authority, customer rights and external transfers apart.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { customerWorld, SyntheticProtection } from "../../server/test/customer-world.ts";
import {
  editView,
  FixtureV3Transport,
  V3_ACCEPTING,
  V3_CLOSED,
} from "../../server/test/v3-fixture-transport.ts";
import { ApiError } from "../src/api.ts";
import { OwnerHandover, type OwnerHandoverState } from "../src/handover.ts";
import { grouped, type HandoverPort } from "../src/handoverApi.ts";
import { Continuity, SaleProgress } from "../src/pages/Handover.tsx";
import { saleNext, saleSentence, saleSteps } from "../src/saleView.ts";

type Caller = Awaited<ReturnType<typeof customerWorld>>["owner"];

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

let keys = 0;
async function world() {
  const t = new FixtureV3Transport();
  const w = await customerWorld({
    customer: { protection: new SyntheticProtection() },
    v3Transport: t,
    v3Now: () => Date.now(),
  });
  w.link(w.f.ava.id, "founder.near");
  const noah = w.person("Noah Fenn");
  w.link(noah.id, "buyer.near");
  const owner = (port = portFor(w.owner), personId = w.f.ava.id) =>
    new OwnerHandover(port, {
      personId,
      businessId: w.f.business,
      storage: null,
      makeKey: () => `sale-view-key-${String(++keys).padStart(4, "0")}`,
    });
  return { w, t, owner, noah };
}

/**
 * Synthetic, coherent with the contract's closed fixture: after deal 1 closed to buyer.near
 * (generation 2), the new owner proposes deal 2 to another buyer. Nobody has accepted; no escrow.
 */
const V3_DEAL2 = editView(V3_CLOSED, "get_control", (c) => {
  c.control_seq = "8";
  c.live_deal = {
    ...JSON.parse(V3_ACCEPTING.get_control as string).live_deal,
    seq: "2",
    version: 1,
    state: "proposed",
    digest: "d".repeat(64),
    seller: "buyer.near",
    buyer: "third.near",
    expected_generation: 2,
    seller_accepted: false,
    buyer_accepted: false,
    escrow: "0",
    grants: [],
  };
});

const status = (s: OwnerHandoverState) =>
  Object.fromEntries(saleSteps(s).map((st) => [st.key, st.status]));

describe("001i progress and next action follow the real controller", () => {
  it("read → review → record → revised version: the close is never shown as completed", async () => {
    const { t, owner } = await world();
    const c = owner();
    await c.start();
    expect(status(c.getState())).toMatchObject({ read: "current", record: "waiting" });
    expect(saleNext(c.getState()).action).toBe("refresh");

    await c.refreshEvidence();
    expect(status(c.getState())).toEqual({
      read: "completed",
      record: "current",
      close: "waiting",
      apply: "waiting",
      takeover: "waiting",
    });
    expect(saleNext(c.getState())).toMatchObject({ action: "review" });
    expect(saleSentence(c.getState())).toMatch(
      /^Deal 1, version 1 is accepting on the contract; .* Not recorded here yet\.$/,
    );

    c.review();
    expect(saleNext(c.getState()).action).toBe("record");
    await c.record();
    const intent = c.getState().intents[0]?.id;
    expect(status(c.getState())).toMatchObject({
      record: "completed",
      close: "current",
      apply: "current",
      takeover: "waiting",
    });
    expect(saleNext(c.getState())).toEqual({
      action: "reconcile",
      label: "Check the contract's outcome…",
      intent,
    });
    expect(saleSentence(c.getState())).toMatch(/This version is recorded here\.$/);
    const progress = renderToStaticMarkup(
      <SaleProgress ev={c.getState().evidence} intents={c.getState().intents} />,
    );
    expect(progress.match(/is-completed/g)).toHaveLength(2);
    expect(progress).toMatch(
      /is-current"><span class="sale-step-status">Current<\/span><strong class="sale-step-title">The contract closes the sale/,
    );

    // The seller revises the deal: version 2 needs its own review; the old record doesn't cover it.
    t.next(
      editView(V3_ACCEPTING, "get_control", (x) => {
        x.control_seq = "7";
        x.live_deal.version = 2;
        x.live_deal.digest = "e".repeat(64);
        x.live_deal.state = "proposed";
        x.live_deal.seller_accepted = false;
        x.live_deal.buyer_accepted = false;
      }),
    );
    await c.refreshEvidence();
    expect(status(c.getState()).record).toBe("current");
    expect(saleNext(c.getState()).action).toBe("review");
    expect(saleSentence(c.getState())).toMatch(
      /version 2 .* nobody has accepted yet\..* Not recorded/,
    );
  });

  it("a stale or flagged reading blocks recording; the next action is to read again", async () => {
    const { owner } = await world();
    const c = owner();
    await c.start();
    await c.refreshEvidence();
    const s = c.getState();
    const o = s.evidence?.observed;
    if (!o || !s.evidence) throw new Error("no reading");
    for (const observed of [
      { ...o, freshness: "stale" as const },
      { ...o, flag: { code: "mismatch", message: "Synthetic flag." } },
    ]) {
      const v = { ...s, evidence: { ...s.evidence, observed } } as OwnerHandoverState;
      expect(status(v)).toMatchObject({ read: "completed", record: "blocked" });
      expect(saleNext(v).action).toBe("refresh");
    }
  });

  it("access in doubt comes first: Check access, before any review or outcome", async () => {
    const { w, owner } = await world();
    const real = portFor(w.owner);
    let deny = false;
    const c = owner(
      portFor(w.owner, {
        refresh: async (id) => {
          if (deny) throw new ApiError(404, "No such business");
          return real.refresh(id);
        },
        evidence: async (id) => {
          if (deny) throw new ApiError(503, "unavailable");
          return real.evidence(id);
        },
      }),
    );
    await c.start();
    await c.refreshEvidence();
    deny = true;
    await c.refreshEvidence();
    expect(c.getState().access).toBe("unconfirmed");
    expect(saleNext(c.getState())).toEqual({ action: "check_access", label: "Check access" });
    // Recovery ranks next; it can't be skipped by a review button.
    const unanswered = {
      ...c.getState(),
      access: "confirmed",
      unanswered: { seq: "1", version: 1 },
    };
    expect(saleNext(unanswered as OwnerHandoverState).action).toBe("recover");
  });

  it("only an applied intent completes the close and apply; the takeover is then current", async () => {
    const { owner } = await world();
    const c = owner();
    await c.start();
    await c.refreshEvidence();
    c.review();
    await c.record();
    const s = c.getState();
    const applied = {
      ...s,
      intents: s.intents.map((i) => ({ ...i, status: "applied" as const })),
    };
    expect(status(applied)).toEqual({
      read: "completed",
      record: "completed",
      close: "completed",
      apply: "completed",
      takeover: "current",
    });
    for (const st of ["ended", "superseded"] as const) {
      const v = { ...s, intents: s.intents.map((i) => ({ ...i, status: st })) };
      expect(status(v)).toMatchObject({ close: "waiting", apply: "waiting", takeover: "waiting" });
    }
  });

  it("unbound sends the seller to Selling; paused offers no action and blocks the reading", () => {
    const base = {
      status: "ready",
      access: "confirmed",
      intents: [],
      reviewing: null,
      unanswered: null,
    } as const;
    const unbound = { ...base, evidence: { state: "unbound", message: "No v3 contract." } };
    const paused = { ...base, evidence: { state: "paused", message: "Reading is paused." } };
    expect(saleNext(unbound as never).action).toBe("selling");
    expect(saleNext(paused as never)).toEqual({ action: "none", label: "" });
    expect(saleSteps(paused as never)[0]).toMatchObject({
      status: "blocked",
      detail: "Reading is paused.",
    });
  });
});

describe("001i continuity keeps authority, customer rights and external transfers apart", () => {
  it("renders the contract's buyer and grants under authority, its customer amounts under rights", async () => {
    const { owner } = await world();
    const c = owner();
    await c.start();
    await c.refreshEvidence();
    const ev = c.getState().evidence;
    const o = ev?.observed;
    if (!ev || !o?.deal) throw new Error("no deal");
    const html = renderToStaticMarkup(<Continuity ev={ev} />);
    const [authority, rights, external] = html.split("<section>").slice(1);
    expect(authority).toContain("buyer.near");
    expect(authority).toContain("meter2.near</span> (metering)");
    expect(rights).not.toContain("buyer.near");
    expect(rights).toContain(grouped(o.customers.prepaid_unused));
    expect(rights).toContain(grouped(o.customers.reserved_in_use));
    expect(external).toMatch(/domains, provider and model accounts, secrets/);
    expect(external).not.toContain(".near");
  });
});

// Job 001i1: the current sale stands on its own evidence. Astra's probe on dfeecae: an applied
// deal 1 in the business's intent history (the list API returns all of it, newest first) made
// the sentence say deal 1 was applied and the steps mark Record/Close/Apply completed for a fresh
// proposed deal 2, while the action offered Review. These drive the real controller through the
// whole first sale, then a second; synthetic constructions are labelled where they're made.

/** Closes and applies deal 1 through the real API; returns Noah's workspace as the new owner. */
async function afterFirstSale() {
  const x = await world();
  const ava = x.owner();
  await ava.start();
  await ava.refreshEvidence();
  ava.review();
  await ava.record();
  const first = ava.getState().intents[0]?.id as string;
  x.t.next(V3_CLOSED); // the contract fixture: this exact deal closed
  x.w.chain.afterSale();
  await ava.refreshEvidence();
  // No live deal now, and the exact record awaits its outcome: that is the current sale.
  expect(status(ava.getState())).toMatchObject({ record: "completed", close: "current" });
  expect(saleNext(ava.getState())).toMatchObject({ action: "reconcile", intent: first });
  await ava.reconcile(first);
  await ava.reconcile(first);
  expect(ava.getState().status).toBe("gone"); // the seller's management ended
  const noah = x.owner(portFor(x.noah), x.noah.id);
  await noah.start();
  await noah.refreshEvidence();
  expect(noah.getState().intents).toMatchObject([{ id: first, status: "applied" }]);
  return { ...x, noah, first };
}

describe("001i1 a historical sale never completes the current one", () => {
  it("after deal 1 is applied, no live deal: the history stays history", async () => {
    const { noah } = await afterFirstSale();
    const s = noah.getState();
    expect(saleSentence(s)).toMatch(/^No sale is in progress at block \d+\./);
    expect(saleSentence(s)).not.toMatch(/applied/);
    expect(status(s)).toEqual({
      read: "completed",
      record: "waiting",
      close: "waiting",
      apply: "waiting",
      takeover: "waiting",
    });
    expect(saleNext(s).action).toBe("refresh");
  });

  it("a proposed deal 2 after an applied deal 1: sentence, steps and action all describe deal 2", async () => {
    const { w, t, noah, first } = await afterFirstSale();
    w.link(w.person("Lena Ortiz").id, "third.near"); // deal 2's buyer, fictional
    t.next(V3_DEAL2);
    await noah.refreshEvidence();
    const s = noah.getState();
    expect(s.evidence?.observed?.deal).toMatchObject({ seq: "2", state: "proposed" });
    expect(saleSentence(s)).toMatch(
      /^Deal 2, version 1 is proposed on the contract; nobody has accepted yet\..* Not recorded here yet\.$/,
    );
    expect(status(s)).toEqual({
      read: "completed",
      record: "current",
      close: "waiting",
      apply: "waiting",
      takeover: "waiting",
    });
    expect(saleNext(s).action).toBe("review");

    noah.review();
    await noah.record();
    const second = noah.getState().intents.find((i) => i.deal.seq === "2")?.id;
    expect(noah.getState().notice?.code).toBe("intent_recorded");
    expect(second).toBeDefined();
    expect(noah.getState().intents.map((i) => i.id)).toContain(first);
    expect(status(noah.getState())).toMatchObject({
      record: "completed",
      close: "current",
      apply: "current",
      takeover: "waiting",
    });
    expect(saleNext(noah.getState())).toMatchObject({ action: "reconcile", intent: second });
    // Order-independent: the same answers with the history listed the other way round
    // (synthetic reorder of the real list).
    const reversed = { ...noah.getState(), intents: [...noah.getState().intents].reverse() };
    expect(status(reversed)).toEqual(status(noah.getState()));
    expect(saleNext(reversed)).toEqual(saleNext(noah.getState()));
    expect(saleSentence(reversed)).toBe(saleSentence(noah.getState()));
  });

  it("older and newer versions recorded: only the shown version's exact record counts, wherever it is", async () => {
    const { t, owner } = await world();
    const c = owner();
    await c.start();
    await c.refreshEvidence();
    c.review();
    await c.record(); // version 1
    t.next(
      editView(V3_ACCEPTING, "get_control", (x) => {
        x.control_seq = "7";
        x.live_deal.version = 2;
        x.live_deal.digest = "e".repeat(64);
        x.live_deal.state = "proposed";
        x.live_deal.seller_accepted = false;
        x.live_deal.buyer_accepted = false;
      }),
    );
    await c.refreshEvidence();
    c.review();
    await c.record(); // version 2
    const s = c.getState();
    const v2 = s.intents.find((i) => i.deal.version === 2);
    expect(v2?.status).toBe("recorded");
    for (const intents of [s.intents, [...s.intents].reverse()]) {
      const v = { ...s, intents };
      expect(saleNext(v)).toMatchObject({ action: "reconcile", intent: v2?.id });
      expect(saleSentence(v)).toMatch(/^Deal 1, version 2 .* This version is recorded here\.$/);
      expect(saleSteps(v)[1]?.detail).toMatch(/^Version 2 of deal 1 is recorded here/);
      // Synthetic: the next reading shows no live deal. Both records await an outcome; the
      // newest version is the current one, whatever the list order.
      const o = s.evidence?.observed;
      if (!o || !s.evidence) throw new Error("no reading");
      const gone = { ...v, evidence: { ...s.evidence, observed: { ...o, deal: null } } };
      expect(saleNext(gone)).toMatchObject({ action: "reconcile", intent: v2?.id });
      expect(saleSentence(gone)).toMatch(/^Version 2 of deal 1 is recorded here; the last reading/);
      // Synthetic: reading paused with those records pending: mentioned, never completed.
      const paused = { ...v, evidence: { state: "paused", message: "Paused." } } as typeof v;
      expect(status(paused as OwnerHandoverState)).toMatchObject({
        read: "blocked",
        record: "waiting",
        close: "waiting",
      });
      expect(saleSentence(paused)).toMatch(
        /^Paused\. Version 2 of deal 1 is recorded here; its outcome can't be checked/,
      );
    }
  });

  it("paused or stale evidence is never covered by a historical success", async () => {
    const { noah } = await afterFirstSale();
    const s = noah.getState();
    const o = s.evidence?.observed;
    if (!o || !s.evidence) throw new Error("no reading");
    // Synthetic: the same state with reading paused, then with the last reading stale.
    const paused = {
      ...s,
      evidence: { state: "paused", message: "Reading the contract is paused here." },
    } as OwnerHandoverState;
    expect(saleSentence(paused)).toBe("Reading the contract is paused here.");
    expect(status(paused)).toEqual({
      read: "blocked",
      record: "waiting",
      close: "waiting",
      apply: "waiting",
      takeover: "waiting",
    });
    expect(saleNext(paused).action).toBe("none");
    const stale = {
      ...s,
      evidence: { ...s.evidence, observed: { ...o, freshness: "stale" as const } },
    };
    expect(saleSentence(stale)).toMatch(/stale/);
    expect(saleSentence(stale)).not.toMatch(/applied/);
    expect(status(stale)).toMatchObject({ record: "waiting", close: "waiting", apply: "waiting" });
    expect(saleNext(stale).action).toBe("refresh");
  });

  it("ended and superseded history completes nothing, with or without a live deal", async () => {
    const { t, noah } = await afterFirstSale();
    const s = noah.getState();
    for (const st of ["ended", "superseded"] as const) {
      // Synthetic: the real history with deal 1's record in a terminal state.
      const none = { ...s, intents: s.intents.map((i) => ({ ...i, status: st })) };
      expect(status(none)).toMatchObject({ record: "waiting", close: "waiting", apply: "waiting" });
      expect(saleNext(none).action).toBe("refresh");
    }
    t.next(V3_DEAL2);
    await noah.refreshEvidence();
    const live = noah.getState();
    for (const st of ["ended", "superseded", "recorded"] as const) {
      // Synthetic: deal 1's record in each state alongside the live deal 2.
      const v = { ...live, intents: live.intents.map((i) => ({ ...i, status: st })) };
      expect(status(v)).toMatchObject({ record: "current", close: "waiting", apply: "waiting" });
      expect(saleNext(v).action).toBe("review");
      expect(saleSentence(v)).toMatch(/^Deal 2, .* Not recorded here yet\.$/);
    }
  });
});
