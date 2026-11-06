// Job 003s1: handover evidence stays qualified. A flagged, stale or owner-mismatched reading keeps
// its historical terms visible but can't stay an actionable review; a refresh answer is accepted
// only in its actual finite form; a deadline is labelled as passed relative to the reading. Real
// API over the contract fixtures (in-memory transport) and the labelled customer world.

import { describe, expect, it } from "vitest";
import {
  type CustomerWorld,
  customerWorld,
  SyntheticProtection,
} from "../../server/test/customer-world.ts";
import {
  editView,
  FixtureV3Transport,
  V3_PROPOSED,
} from "../../server/test/v3-fixture-transport.ts";
import { ApiError } from "../src/api.ts";
import { OwnerHandover, reviewProblem } from "../src/handover.ts";
import { elapsedAt, type HandoverPort, sellerMark } from "../src/handoverApi.ts";

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

let keys = 0;
async function world(overrideFor: (w: CustomerWorld) => Partial<HandoverPort> = () => ({})) {
  const t = new FixtureV3Transport();
  t.views = V3_PROPOSED;
  const clock = { now: Date.now() };
  const w = await customerWorld({
    customer: { protection: new SyntheticProtection() },
    v3Transport: t,
    v3Now: () => clock.now,
  });
  w.link(w.f.ava.id, "founder.near");
  w.link(w.person("Noah Fenn").id, "buyer.near");
  const s = new OwnerHandover(portFor(w.owner, overrideFor(w)), {
    personId: w.f.ava.id,
    businessId: w.f.business,
    makeKey: () => `ev-key-${String(++keys).padStart(4, "0")}`,
  });
  await s.start();
  await s.refreshEvidence();
  s.review();
  expect(s.getState().reviewing).not.toBeNull();
  const intents = () =>
    (w.state.store.db.prepare("SELECT COUNT(*) AS n FROM v3_intents").get() as { n: number }).n;
  return { w, t, s, clock, intents };
}

describe("003s1 a qualified reading can't stay an actionable review", () => {
  it("flagged evidence (same height, other content): terms stay visible, the review is set aside", async () => {
    const { t, s, intents } = await world();
    // Synthetic: the block already read now answers with other content: a sticky conflict.
    t.conflictAtSameHeight(editView(t.views, "get_control", (c) => (c.manifest_seq = "9")));
    await s.refreshEvidence();
    const o = s.getState().evidence?.observed;
    expect(o?.flag).not.toBeNull();
    expect(o?.deal?.seq).toBe("1"); // historical terms still shown
    expect(s.getState().reviewing).toBeNull();
    expect(reviewProblem(s.getState().evidence)).toMatch(/conflict|flag/i);
    s.review();
    expect(s.getState().reviewing).toBeNull();
    await s.record();
    expect(s.getState().notice?.code).toBe("evidence_disqualified");
    expect(intents()).toBe(0);
  });

  it("a stale reading or an owner that no longer maps here can't be recorded from", async () => {
    const { w, t, s, clock, intents } = await world();
    clock.now += 11 * 60_000; // past the 10-minute freshness window
    await s.checkAccess(); // a plain reload of the evidence
    expect(s.getState().evidence?.observed?.freshness).toBe("stale");
    expect(s.getState().reviewing).toBeNull();
    expect(reviewProblem(s.getState().evidence)).toMatch(/read the contract again/i);
    await s.record();
    expect(s.getState().notice?.code).toBe("evidence_disqualified");
    // Reading a newer block makes it current and reviewable (the same block is a duplicate and
    // keeps its original reading time).
    t.next(t.views);
    await s.refreshEvidence();
    s.review();
    expect(s.getState().reviewing).not.toBeNull();
    // The chain owner's account now maps to someone else here.
    w.state.store.db
      .prepare("UPDATE chain_accounts SET owner_id = ? WHERE account_id = 'founder.near'")
      .run(w.person("Ana Ruiz").id);
    await s.checkAccess();
    expect(s.getState().evidence?.observed?.owner_match).not.toBe("matches");
    expect(s.getState().reviewing).toBeNull();
    expect(intents()).toBe(0);
  });

  it("an unanswered record stays recoverable even when the reading later becomes qualified", async () => {
    let lose = true;
    const { t, s, intents } = await world((w) => ({
      record: async (b, body) => {
        const r = await w.owner(`/api/businesses/${b}/v3/intents`, "POST", body);
        if (lose) {
          lose = false;
          throw new TypeError("network");
        }
        return r.body;
      },
    }));
    await s.record();
    expect(s.getState().unanswered).toEqual({ seq: "1", version: 1 });
    t.conflictAtSameHeight(editView(t.views, "get_control", (c) => (c.manifest_seq = "9")));
    await s.refreshEvidence();
    await s.recoverOriginal(); // the same request; the server decides, it was already recorded
    expect(s.getState().unanswered).toBeNull();
    expect(intents()).toBe(1);
  });
});

describe("003s1 a refresh answer is accepted only in its actual form", () => {
  const cases: [string, unknown][] = [
    ["unknown outcome", { outcome: "applied", message: "Sold!" }],
    ["no message", { outcome: "accepted" }],
    ["accepted without a view", { outcome: "accepted", message: "Recorded." }],
    ["refused without a code", { outcome: "refused", message: "No." }],
    ["refused with a view", { outcome: "refused", code: "x", message: "No.", view: {} }],
    [
      "a malformed view",
      { outcome: "accepted", message: "Recorded.", view: { state: "observed" } },
    ],
    ["a period of the wrong shape", { outcome: "accepted", message: "Recorded.", period: 5 }],
  ];
  for (const [what, answer] of cases)
    it(`refuses ${what}: retryable, the evidence shown is not replaced`, async () => {
      let bad = false;
      const { s } = await world((w) => ({
        refresh: async (b) => {
          if (bad) return answer;
          return (await w.owner(`/api/businesses/${b}/v3/refresh`, "POST", {})).body;
        },
      }));
      const before = s.getState().evidence;
      bad = true;
      await s.refreshEvidence();
      expect(s.getState().notice?.code).toBe("refresh_malformed");
      expect(s.getState().notice?.code).not.toMatch(/^refresh_(applied|accepted)/);
      expect(s.getState().evidence).toBe(before);
      expect(s.getState().busy).toBeNull();
      bad = false;
      await s.refreshEvidence();
      expect(s.getState().notice?.code).toBe("refresh_duplicate"); // the same block, genuinely
    });

  it("a genuine refused answer is shown as refused, not success", async () => {
    const { t, s } = await world();
    t.failNext = 1;
    await s.refreshEvidence();
    expect(s.getState().notice).toMatchObject({ tone: "warn", code: "refresh_refused" });
  });
});

describe("003s1 deadlines are labelled relative to the reading", () => {
  it("a passed offer deadline is elapsed at the observed time; a future one isn't; zero is unset", () => {
    const at = "2026-11-04T10:50:00.000Z";
    expect(elapsedAt("1793664000000", at)).toBe(true); // 2026-11-03T00:00Z
    expect(elapsedAt(String(Date.parse(at) + 60_000), at)).toBe(false);
    expect(elapsedAt("0", at)).toBe(false);
    expect(elapsedAt("1793664000000", "not a time")).toBe(false);
  });
});

describe("attack review note 10: a seller kept on as an operator", () => {
  it("is marked wherever grants show", () => {
    expect(sellerMark("founder.near", "founder.near")).toBe(" · the seller");
    expect(sellerMark("meter.near", "founder.near")).toBe("");
    expect(sellerMark("founder.near", null)).toBe("");
  });
});
