// Job 003j: the Ownership and continuity page's state, through the controller the page uses, with
// a scripted API answered by the test in any order. Fictional data. Every scripted answer is a
// single finite value; nothing here produces data without end.

import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api.ts";
import { groupDigits, MalformedView, monthLabel, parseView } from "../src/continuityApi.ts";
import {
  ACCESS_CONFIRMED,
  ACCESS_ENDED,
  ACCESS_UNCONFIRMED,
  ContinuityController,
  type ContinuityPort,
  parseMonth,
} from "../src/continuityController.ts";

// biome-ignore lint/suspicious/noExplicitAny: test fixtures are plain JSON
type Json = Record<string, any>;

const T0 = Date.parse("2026-11-03T10:00:00.000Z");

/** An observed view as the server sends it (values taken from the direct-accepting fixture). */
function observed(over: Json = {}): Json {
  return {
    state: "observed",
    owner_epoch: "mara:0",
    served_at: "2026-11-03T10:00:00.000Z",
    stale_after_ms: 600_000,
    binding: { network: "testnet", account: "studio.biz.testnet" },
    binding_matches_record: true,
    transport: "configured",
    source: { network: "testnet", account: "studio.biz.testnet", schema: "business-v3/003g" },
    block: { height: "187310138", hash: "9tFkUmtWpR9kZLqgZVjDdsP7rN5vGnHxJ3cYbA2sQeWf" },
    finality: "final",
    provenance: "Reported by the configured read transport; not independently verified.",
    network_identity: "The network is named by operator configuration.",
    observed_at: "2026-11-03T09:58:00.000Z",
    age_ms: 120_000,
    freshness: "fresh",
    high_water: { block_height: "187310138", control_seq: "6" },
    flag: null,
    control: {
      owner: "founder.near",
      generation: 1,
      control_seq: "6",
      close_mode: "direct",
      closer: null,
      service_manifest: "0".repeat(64),
      manifest_seq: "0",
      operators: [{ account: "meter.near", caps: 1, generation: 1 }],
      live_deal: {
        seq: "1",
        version: 1,
        state: "accepting",
        seller: "founder.near",
        buyer: "buyer.near",
        price: "300000000000000000000",
        escrow: "300000000000000000000",
        seller_accepted: true,
        buyer_accepted: false,
        expires_at_ms: "1793664000000",
        deadline_ms: "0",
        expected_generation: 1,
      },
      manifest_note: "A hash pointer.",
      closer_note: "Direct.",
    },
    owner_match: "matches",
    owner_note: "An observation never changes who controls this business.",
    treasury: {
      asset: "tusd.near",
      held: "400000000000000000000",
      ent_free_value: "90000000000000000000",
      ent_held_value: "0",
      available: "9000000000000000000",
      withdrawable: "8999999999999750000",
      pending_total: "1000000000000000000",
      claims_total: "0",
      escrow_total: "300000000000000000000",
    },
    claims_note: "Claims are owed.",
    pending: [
      {
        slot: 0,
        state: "in_flight",
        kind: "profit",
        amount: "1000000000000000000",
        to: "founder.near",
      },
    ],
    periods: [
      {
        yyyymm: 202611,
        status: "recorded",
        period: {
          yyyymm: 202611,
          purchases_in: { amount: "100000000000000000000", exact: true },
          earned: { amount: "10000000000000000000", exact: false },
        },
        block: { height: "187310100", hash: "Abc" },
        at_core_block: false,
        observed_at: "2026-11-03T09:00:00.000Z",
      },
    ],
    periods_note: "A month never read here is absent, not zero.",
    outcomes: [],
    history: {
      complete: true,
      missing_count: "0",
      first_missing: [],
      note: "Every deal observed.",
    },
    ...over,
  };
}

interface Pending {
  kind: "get" | "refresh";
  args: unknown[];
  ok: (v: unknown) => void;
  fail: (e: unknown) => void;
}

class Script implements ContinuityPort {
  pending: Pending[] = [];
  private call(kind: Pending["kind"], args: unknown[]) {
    return new Promise<never>((ok, fail) =>
      this.pending.push({ kind, args, ok: ok as (v: unknown) => void, fail }),
    );
  }
  get = (...a: unknown[]) => this.call("get", a);
  refresh = (...a: unknown[]) => this.call("refresh", a);
  take(kind: Pending["kind"]) {
    const i = this.pending.findIndex((p) => p.kind === kind);
    if (i < 0) throw new Error(`no ${kind} waiting (have ${this.pending.map((p) => p.kind)})`);
    return this.pending.splice(i, 1)[0] as Pending;
  }
}

async function opened(view: Json = observed()) {
  const api = new Script();
  const clock = { t: T0 };
  const c = new ContinuityController("b1", api, () => clock.t);
  const loading = c.load();
  api.take("get").ok(view);
  await loading;
  return { api, c, clock };
}

const offline = () => new TypeError("Failed to fetch");

describe("003j every capability state reads truthfully", () => {
  it("unbound, paused and never-read are shown as such, and can't be refreshed", async () => {
    for (const [view, why] of [
      [{ state: "unbound", owner_epoch: "mara:0", message: "Not connected." }, /isn't connected/],
      [
        {
          state: "paused",
          owner_epoch: "mara:0",
          code: "format_upgrade_failed",
          message: "Paused.",
        },
        /paused/,
      ],
    ] as const) {
      const { api, c } = await opened(view);
      expect(c.getState()).toMatchObject({ status: "ready", view: { state: view.state } });
      expect(c.blocked).toMatch(why);
      await c.refresh();
      expect(api.pending).toEqual([]);
      expect(c.freshness()).toBeNull();
    }
    const never = await opened({
      state: "never_observed",
      owner_epoch: "mara:0",
      binding: { network: "testnet", account: "studio.biz.testnet" },
      transport: "unavailable",
    });
    expect(never.c.getState().view).toMatchObject({
      state: "never_observed",
      transport: "unavailable",
    });
    expect(never.c.blocked).toBeNull(); // the owner may try; the server says unavailable
  });

  it("freshness is recomputed from the server's times as time passes", async () => {
    const { c, clock } = await opened();
    expect(c.freshness()).toEqual({ age_ms: 120_000, stale: false });
    clock.t += 9 * 60_000; // 11 minutes old now
    expect(c.freshness()).toEqual({ age_ms: 660_000, stale: true });
  });

  it("large amounts stay exact strings; uncertain counters and unread months stay distinct", async () => {
    const { c } = await opened();
    const v = c.getState().view as Json;
    expect(v.treasury.held).toBe("400000000000000000000");
    expect(groupDigits(v.treasury.withdrawable)).toBe("8,999,999,999,999,750,000");
    expect(v.periods[0].period.earned).toEqual({ amount: "10000000000000000000", exact: false });
    expect(v.periods.find((p: Json) => p.yyyymm === 202610)).toBeUndefined(); // absent, not zero
    expect(monthLabel(202611)).toBe("November 2026");
  });

  it("refuses to show a malformed answer, rather than coercing it", () => {
    for (const bad of [
      observed({ treasury: { ...observed().treasury, held: 4e20 } }), // a number, not a string
      observed({ treasury: { ...observed().treasury, available: "-1" } }),
      observed({ block: { height: "1.5", hash: "x" } }),
      observed({ observed_at: "yesterday" }),
      observed({ owner_epoch: undefined }),
      observed({ periods: [{ ...observed().periods[0], period: { earned: { amount: "1" } } }] }),
      { state: "connected", owner_epoch: "mara:0" },
    ])
      expect(() => parseView(bad)).toThrow(MalformedView);
    expect(() => parseView(observed())).not.toThrow();
  });

  it("a malformed first answer is an error state, not a partial page", async () => {
    const { c } = await opened(observed({ treasury: { asset: "tusd.near" } }));
    expect(c.getState()).toMatchObject({ status: "error", view: null });
    expect(c.getState().message).toMatch(/couldn't be shown safely/);
  });

  it("flags, owner mismatch, unknown mapping and history gaps come through as recorded", async () => {
    const { c } = await opened(
      observed({
        flag: { code: "conflict", detail: "height 1000", message: "Two different answers." },
        owner_match: "mismatch",
        history: { complete: false, missing_count: "2", first_missing: ["1", "2"], note: "Gaps." },
      }),
    );
    expect(c.getState().view).toMatchObject({
      flag: { code: "conflict" },
      owner_match: "mismatch",
      history: { complete: false, missing_count: "2" },
    });
    const unknown = await opened(observed({ owner_match: "unknown_mapping" }));
    expect(unknown.c.getState().view).toMatchObject({ owner_match: "unknown_mapping" });
  });
});

describe("003j refreshing is deliberate, and failures never advance or clear evidence", () => {
  it("nothing refreshes on open; a refresh for one month records and reports the result", async () => {
    const { api, c } = await opened();
    expect(api.pending).toEqual([]); // the open read only
    c.setMonth("202611");
    const r = c.refresh();
    expect(c.getState().refresh.state).toBe("sending");
    await c.refresh(); // a second press while sending sends nothing
    const p = api.take("refresh");
    expect(p.args).toEqual(["b1", { period: 202611 }]);
    expect(api.pending).toEqual([]);
    p.ok({
      outcome: "accepted",
      message: "Recorded.",
      period: { yyyymm: 202611, outcome: "accepted" },
      view: observed({
        observed_at: "2026-11-03T10:00:00.000Z",
        block: { height: "187310200", hash: "Def" },
      }),
    });
    await r;
    expect(c.getState().refresh).toMatchObject({
      state: "done",
      outcome: "accepted",
      period: { yyyymm: 202611, outcome: "accepted" },
    });
    expect((c.getState().view as Json).block.height).toBe("187310200");
  });

  it("a refused or unanswered refresh keeps the evidence and its original time; a flag stays", async () => {
    const flagged = observed({
      flag: { code: "conflict", detail: "height 9", message: "Two answers." },
    });
    const { api, c } = await opened(flagged);
    const before = c.getState().view;
    let r = c.refresh();
    api
      .take("refresh")
      .ok({ outcome: "refused", code: "timeout", message: "The NEAR read took too long." });
    await r;
    expect(c.getState().refresh).toMatchObject({ state: "refused", code: "timeout" });
    expect(c.getState().view).toBe(before);
    r = c.refresh();
    api.take("refresh").fail(offline());
    await r;
    expect(c.getState().refresh.state).toBe("unknown");
    expect(c.getState().refresh.message).toMatch(/original time/);
    expect(c.getState().view).toBe(before);
    expect((c.getState().view as Json).observed_at).toBe("2026-11-03T09:58:00.000Z");
    expect((c.getState().view as Json).flag.code).toBe("conflict");
    r = c.refresh();
    api.take("refresh").fail(new ApiError(503, "Unavailable"));
    await r;
    expect(c.getState().refresh.state).toBe("unknown");
  });

  it("a conflict outcome is reported as such, never as success", async () => {
    const { api, c } = await opened();
    const r = c.refresh();
    api.take("refresh").ok({
      outcome: "conflict",
      message: "Two different answers.",
      view: observed({ flag: { code: "conflict", detail: "height 1", message: "Two answers." } }),
    });
    await r;
    expect(c.getState().refresh).toMatchObject({ state: "done", outcome: "conflict" });
    expect(c.getState().refresh.message).toMatch(/Nothing was applied/);
  });

  it("an invalid month is refused locally; a 400 is a plain refusal", async () => {
    const { api, c } = await opened();
    c.setMonth("2026-11");
    expect(c.blocked).toMatch(/yyyymm/);
    await c.refresh();
    expect(api.pending).toEqual([]);
    expect(parseMonth("202613")).toBeNull();
    c.setMonth("");
    const r = c.refresh();
    api.take("refresh").fail(new ApiError(400, "The period is a month written yyyymm"));
    await r;
    expect(c.getState().refresh).toMatchObject({ state: "refused" });
  });

  it("an older read finishing after a refresh never replaces the newer evidence", async () => {
    const { api, c } = await opened();
    const older = c.load();
    const r = c.refresh();
    const [g, p] = [api.take("get"), api.take("refresh")];
    p.ok({
      outcome: "accepted",
      message: "Recorded.",
      view: observed({ block: { height: "200", hash: "New" } }),
    });
    await r;
    g.ok(observed({ block: { height: "100", hash: "Old" } }));
    await older;
    expect((c.getState().view as Json).block.height).toBe("200");
  });
});

describe("003j access, control and lifecycle", () => {
  it("a 404 refresh, then a 404 read: everything private is cleared and stays cleared", async () => {
    const { api, c } = await opened();
    c.setMonth("202611");
    const r = c.refresh();
    api.take("refresh").fail(new ApiError(404, "No such business"));
    await Promise.resolve();
    await new Promise((x) => setTimeout(x, 0));
    api.take("get").fail(new ApiError(404, "No such business"));
    await r;
    expect(c.getState()).toMatchObject({
      status: "gone",
      view: null,
      month: "",
      message: ACCESS_ENDED,
    });
    expect(c.getState().refresh.state).toBe("idle");
    expect(await c.load()).toBe("ended"); // nothing brings it back
    await c.refresh();
    expect(api.pending).toEqual([]);
  });

  it("a 404 refresh whose check can't finish: settled, labelled unconfirmed, then an explicit check recovers", async () => {
    const { api, c } = await opened();
    const r = c.refresh();
    api.take("refresh").fail(new ApiError(404, "No such business"));
    await new Promise((x) => setTimeout(x, 0));
    api.take("get").fail(offline());
    await r;
    expect(c.getState().access).toBe("unconfirmed");
    expect(c.getState().refresh.state).toBe("unknown"); // not stuck in "sending"
    expect(c.getState().view).not.toBeNull(); // kept, labelled
    expect(c.blocked).toMatch(/Check access/);
    let check = c.checkAccess();
    expect(c.getState().access).toBe("checking");
    api.take("get").fail(offline());
    await check;
    expect(c.getState().access).toBe("unconfirmed"); // a usable button again, not a spinner
    check = c.checkAccess();
    api.take("get").ok(observed());
    await check;
    expect(c.getState().access).toBe("current");
    expect(c.blocked).toBeNull();
  });

  it("another control epoch drops the typed month and the last result; a late refresh lands nowhere", async () => {
    const { api, c } = await opened();
    c.setMonth("202611");
    const r = c.refresh();
    const reread = c.load();
    api.take("get").ok(observed({ owner_epoch: "mara:2" })); // away and back
    await reread;
    expect(c.getState()).toMatchObject({ month: "", refresh: { state: "idle" } });
    api.take("refresh").ok({ outcome: "accepted", message: "Recorded.", view: observed() });
    await r;
    expect(c.getState().view?.owner_epoch).toBe("mara:2");
    expect(c.getState().refresh.state).toBe("idle");
  });

  it("a 409 (control changed during the read) is reported, then the current state is read", async () => {
    const { api, c } = await opened();
    const r = c.refresh();
    api
      .take("refresh")
      .fail(new ApiError(409, "Control of this business changed while this was loading"));
    await new Promise((x) => setTimeout(x, 0));
    api.take("get").ok(observed({ owner_epoch: "mara:2" }));
    await r;
    expect(c.getState().view?.owner_epoch).toBe("mara:2");
  });

  it("leaving the page drops late answers; a failed first load can be retried", async () => {
    const { api, c } = await opened();
    const r = c.refresh();
    c.dispose();
    api.take("refresh").ok({
      outcome: "accepted",
      message: "Recorded.",
      view: observed({ block: { height: "9", hash: "Z" } }),
    });
    await r;
    expect((c.getState().view as Json).block.height).toBe("187310138");
    const api2 = new Script();
    const c2 = new ContinuityController("b1", api2, () => T0);
    let l = c2.load();
    api2.take("get").fail(offline());
    await l;
    expect(c2.getState()).toMatchObject({ status: "error", view: null });
    l = c2.load();
    api2.take("get").ok(observed());
    await l;
    expect(c2.getState().status).toBe("ready");
  });
});

// ---------- 003j1: malformed answers during recovery and refresh ----------

const NEVER = {
  state: "never_observed",
  owner_epoch: "mara:0",
  binding: { network: "testnet", account: "studio.biz.testnet" },
  transport: "configured",
};

/** From a valid never-observed view: 404 refresh, then a failed recheck: access unconfirmed. */
async function unconfirmed() {
  const o = await opened(NEVER);
  const r = o.c.refresh();
  o.api.take("refresh").fail(new ApiError(404, "No such business"));
  await new Promise((x) => setTimeout(x, 0));
  o.api.take("get").fail(offline());
  await r;
  expect(o.c.getState().access).toBe("unconfirmed");
  return o;
}

describe("003j1 Astra's reproductions", () => {
  it("#1 a malformed answer to Check access settles as unconfirmed, retryable, never stuck checking", async () => {
    const { api, c } = await unconfirmed();
    const check = c.checkAccess();
    api.take("get").ok({ state: "observed" }); // malformed
    await check;
    expect(c.getState().access).toBe("unconfirmed");
    expect(c.getState().view).toMatchObject({ state: "never_observed" }); // last valid evidence
    // The person can retry, and a valid answer restores access.
    const again = c.checkAccess();
    expect(api.pending.filter((p) => p.kind === "get")).toHaveLength(1);
    api.take("get").ok(NEVER);
    await again;
    expect(c.getState().access).toBe("current");
    expect(c.blocked).toBeNull();
  });

  it("#2 an accepted refresh carrying a malformed view never announces success", async () => {
    const { api, c } = await opened(NEVER);
    const r = c.refresh();
    api
      .take("refresh")
      .ok({ outcome: "accepted", message: "accepted", view: { state: "observed" } });
    await r;
    const s = c.getState();
    expect(s.refresh.state).not.toBe("done");
    expect(s.refresh).toMatchObject({ state: "unknown" });
    expect(s.refresh.message).not.toMatch(/Recorded/);
    expect(s.view).toMatchObject({ state: "never_observed" });
    expect(c.blocked).toBeNull(); // retryable
  });
});

describe("003j1 the whole refresh answer is validated at the browser boundary", () => {
  const cases: [string, unknown][] = [
    ["not an object", "accepted"],
    ["an array", []],
    ["no outcome", { message: "x", view: observed() }],
    ["an unknown outcome", { outcome: "applied", message: "x", view: observed() }],
    ["an object-valued outcome", { outcome: { a: 1 }, message: "x", view: observed() }],
    ["an observation outcome without a view", { outcome: "accepted", message: "Recorded." }],
    ["an object-valued message", { outcome: "duplicate", message: { a: 1 }, view: observed() }],
    [
      "a malformed month result",
      {
        outcome: "accepted",
        message: "x",
        view: observed(),
        period: { yyyymm: "202611", outcome: 1 },
      },
    ],
    [
      "an unknown month outcome",
      {
        outcome: "accepted",
        message: "x",
        view: observed(),
        period: { yyyymm: 202611, outcome: "maybe" },
      },
    ],
    ["a refusal without a code", { outcome: "refused", message: "x" }],
    [
      "a refusal with an object message",
      { outcome: "refused", code: "timeout", message: { a: 1 } },
    ],
  ];
  for (const [what, answer] of cases)
    it(`refuses ${what}: no success claimed, last valid evidence and its time kept, retry possible`, async () => {
      const { api, c } = await opened();
      const before = c.getState().view;
      const r = c.refresh();
      api.take("refresh").ok(answer);
      await r;
      const s = c.getState();
      expect(s.refresh.state).toBe("unknown");
      expect(s.refresh.message).toMatch(/wasn't in the expected form/);
      expect(s.view).toBe(before);
      expect(c.blocked).toBeNull();
    });

  it("a retry after a malformed answer can succeed normally", async () => {
    const { api, c } = await opened();
    let r = c.refresh();
    api.take("refresh").ok({ outcome: "accepted" });
    await r;
    r = c.refresh();
    api.take("refresh").ok({
      outcome: "accepted",
      message: "Recorded.",
      view: observed({ block: { height: "187310200", hash: "Def" } }),
    });
    await r;
    expect(c.getState().refresh).toMatchObject({ state: "done", outcome: "accepted" });
    expect((c.getState().view as Json).block.height).toBe("187310200");
  });

  it("a valid refusal is still a refusal, with its code", async () => {
    const { api, c } = await opened();
    const r = c.refresh();
    api
      .take("refresh")
      .ok({ outcome: "refused", code: "timeout", message: "The NEAR read took too long." });
    await r;
    expect(c.getState().refresh).toMatchObject({ state: "refused", code: "timeout" });
  });

  it("an older malformed answer after a newer successful access check changes nothing", async () => {
    const { api, c } = await unconfirmed();
    const stale = c.load(); // an older read, still in flight
    const check = c.checkAccess();
    const [older, newer] = [api.take("get"), api.take("get")];
    newer.ok(NEVER);
    await check;
    expect(c.getState().access).toBe("current");
    older.ok({ state: "observed" }); // malformed, and older
    await stale;
    expect(c.getState()).toMatchObject({ access: "current", status: "ready", message: null });
    expect(c.getState().view).toMatchObject({ state: "never_observed" });
  });
});

// ---------- 003j2: the access notice after a successful check ----------

describe("003j2 a successful check replaces the obsolete access notice", () => {
  it("Astra's browser sequence: refresh 404, recheck 503, malformed check, valid check", async () => {
    const { api, c } = await opened(); // valid evidence
    const r = c.refresh();
    api.take("refresh").fail(new ApiError(404, "No such business"));
    await new Promise((x) => setTimeout(x, 0));
    api.take("get").fail(new ApiError(503, "Unavailable"));
    await r;
    expect(c.getState().refresh.message).toBe(ACCESS_UNCONFIRMED);
    let check = c.checkAccess();
    api.take("get").ok({ state: "observed" }); // malformed
    await check;
    expect(c.getState().refresh.message).toBe(ACCESS_UNCONFIRMED); // still true: not confirmed
    check = c.checkAccess();
    api.take("get").ok(observed());
    await check;
    const s = c.getState();
    expect(s.access).toBe("current");
    expect(c.blocked).toBeNull();
    // The status no longer says refreshing is impossible; it says what happened, truthfully.
    expect(s.refresh.message).not.toBe(ACCESS_UNCONFIRMED);
    expect(s.refresh.message).not.toMatch(/nothing can be refreshed/);
    expect(s.refresh).toMatchObject({ state: "info", message: ACCESS_CONFIRMED });
    expect((s.view as Json).observed_at).toBe("2026-11-03T09:58:00.000Z"); // original time
  });

  it("an unrelated refusal is never replaced by an access confirmation", async () => {
    const { api, c } = await opened();
    const r = c.refresh();
    api
      .take("refresh")
      .ok({ outcome: "refused", code: "timeout", message: "The NEAR read took too long." });
    await r;
    const reread = c.load();
    api.take("get").ok(observed());
    await reread;
    expect(c.getState().refresh).toMatchObject({ state: "refused", code: "timeout" });
  });

  it("a newer refusal after the access problem is kept when an older confirming read lands", async () => {
    const { api, c } = await unconfirmed();
    const older = c.load(); // a read started before the newer refusal, not yet answered
    const check = c.checkAccess();
    const [olderGet, checkGet] = [api.take("get"), api.take("get")];
    checkGet.ok(NEVER);
    await check;
    expect(c.getState().refresh.state).toBe("info");
    // A newer refresh is refused...
    const r = c.refresh();
    api
      .take("refresh")
      .ok({ outcome: "refused", code: "timeout", message: "The NEAR read took too long." });
    await r;
    // ...and the older read finishing later doesn't clear that refusal.
    olderGet.ok(NEVER);
    await older;
    expect(c.getState().refresh).toMatchObject({ state: "refused", code: "timeout" });
  });
});
