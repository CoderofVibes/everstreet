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
  w.link(w.person("Noah Fenn").id, "buyer.near");
  const owner = (port = portFor(w.owner)) =>
    new OwnerHandover(port, {
      personId: w.f.ava.id,
      businessId: w.f.business,
      storage: null,
      makeKey: () => `sale-view-key-${String(++keys).padStart(4, "0")}`,
    });
  return { w, t, owner };
}

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
