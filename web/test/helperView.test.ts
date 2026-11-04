// Job 005b: the Helping page's rules against real latestLoader sequences. Answers are held and
// released by the test (no timers); every sequence is finite. Private sections only for a
// capability confirmed in the latest answer; ended/denied/refused clear drafts; unconfirmed and
// failed keep them for a retry; an action with no answer is "outcome unknown" (re-read, not resend).

import { describe, expect, it } from "vitest";
import type { HelperDesk } from "../src/api4.ts";
import {
  actionMessage,
  actionOutcome,
  helperPatch,
  helperShown,
  keepDrafts,
} from "../src/helperView.ts";
import { initialLoad, type LoadState, latestLoader } from "../src/latestLoad.ts";

const CANARY = "FICTIONAL PRIVATE CANARY";
const cap = (state: "authorized" | "denied" | "unconfirmed" | "ended") => ({
  state,
  reason: state,
});
const desk = (o: Partial<HelperDesk> = {}): HelperDesk => ({
  business: { id: "b1", name: "Juniper Print Studio", slug: "juniper" },
  access: "active",
  active_in_everstreet: true,
  capabilities: { support: cap("authorized"), fulfillment: cap("authorized") },
  chain_check: { authorized: true, reason: "confirmed" },
  business_account: "b-juniper.fake",
  inquiries: [
    {
      id: "i1",
      kind: "question",
      message: CANARY,
      share_contact: 1,
      from_name: "Sam Fictional",
      reply: null,
      created_at: "2026-11-04T10:00:00.000Z",
      replied_at: null,
    },
  ] as never,
  orders: [],
  ...o,
});
const ended = (): HelperDesk =>
  desk({
    access: "ended",
    capabilities: { support: cap("ended"), fulfillment: cap("ended") },
    inquiries: null,
    orders: null,
    business_account: null,
  });

class HttpError extends Error {
  constructor(
    readonly status: number,
    m: string,
  ) {
    super(m);
  }
}

/** A page-like holder: the real loader and the page's real patch rule. */
function page(answers: ((v: HelperDesk) => void)[], fails: ((e: unknown) => void)[], cap = 10) {
  let s: LoadState<HelperDesk> = initialLoad();
  let calls = 0;
  const loader = latestLoader(
    () =>
      new Promise<HelperDesk>((resolve, reject) => {
        if (++calls > cap) throw new Error("request cap");
        answers.push(resolve);
        fails.push(reject);
      }),
    (p) => {
      s = helperPatch(s, p);
    },
  );
  return { loader, state: () => s, calls: () => calls };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("005b what the page may show", () => {
  it("active: only the confirmed capability's section", () => {
    const both = helperShown({ data: desk(), error: null, status: "ready" });
    expect(both.kind === "active" && both.inquiries?.[0]?.message).toBe(CANARY);
    const supportOnly = helperShown({
      data: desk({ capabilities: { support: cap("authorized"), fulfillment: cap("denied") } }),
      error: null,
      status: "ready",
    });
    expect(supportOnly.kind === "active" && supportOnly.orders).toBeNull();
    const fulfilOnly = helperShown({
      data: desk({ capabilities: { support: cap("denied"), fulfillment: cap("authorized") } }),
      error: null,
      status: "ready",
    });
    expect(fulfilOnly.kind === "active" && fulfilOnly.inquiries).toBeNull();
  });

  it("ended, denied and unconfirmed carry no private section; failed and refused carry nothing", () => {
    for (const access of ["ended", "denied", "unconfirmed"] as const) {
      const v = helperShown({ data: { ...ended(), access }, error: null, status: "ready" });
      expect(v.kind).toBe(access);
      expect(JSON.stringify(v)).not.toContain(CANARY);
    }
    // Even if older data were present, a failed or refused read shows none of it.
    expect(helperShown({ data: desk(), error: "down", status: "failed" })).toEqual({
      kind: "failed",
      error: "down",
    });
    expect(helperShown({ data: desk(), error: "no", status: "refused" }).kind).toBe("refused");
  });

  it("drafts: kept for active, unconfirmed and failed; cleared when access ends, is denied or refused", () => {
    expect(keepDrafts({ kind: "loading" })).toBe(true);
    expect(keepDrafts({ kind: "failed", error: null })).toBe(true);
    expect(keepDrafts({ kind: "unconfirmed", desk: ended() })).toBe(true);
    expect(keepDrafts({ kind: "ended", desk: ended() })).toBe(false);
    expect(keepDrafts({ kind: "denied", desk: ended() })).toBe(false);
    expect(keepDrafts({ kind: "refused", error: null })).toBe(false);
  });
});

describe("005b sequences through the real loader", () => {
  it("a re-read that fails drops the earlier answer: the retry starts from nothing", async () => {
    const answers: ((v: HelperDesk) => void)[] = [];
    const fails: ((e: unknown) => void)[] = [];
    const p = page(answers, fails);
    void p.loader.load();
    answers[0]?.(desk());
    await tick();
    expect(helperShown(p.state()).kind).toBe("active");
    void p.loader.load();
    fails[1]?.(new Error("Couldn't reach the server"));
    await tick();
    expect(p.state().data).toBeNull();
    expect(JSON.stringify(helperShown(p.state()))).not.toContain(CANARY);
    // Retry: still nothing until the new answer, which is then shown on its own merits.
    void p.loader.load();
    expect(helperShown(p.state()).kind).not.toBe("active");
    answers[2]?.(ended());
    await tick();
    expect(helperShown(p.state()).kind).toBe("ended");
    expect(p.calls()).toBe(3);
  });

  it("revoked between reads: the next answer is ended, and the older active answer can't land late", async () => {
    const answers: ((v: HelperDesk) => void)[] = [];
    const fails: ((e: unknown) => void)[] = [];
    const p = page(answers, fails);
    void p.loader.load(); // older read (active when it was asked)
    void p.loader.load(); // newer read (after the revocation)
    answers[1]?.(ended());
    answers[0]?.(desk());
    await tick();
    expect(helperShown(p.state()).kind).toBe("ended");
    expect(JSON.stringify(p.state())).not.toContain(CANARY);
  });

  it("losing access (401/403/404) drops everything", async () => {
    const answers: ((v: HelperDesk) => void)[] = [];
    const fails: ((e: unknown) => void)[] = [];
    const p = page(answers, fails);
    void p.loader.load();
    answers[0]?.(desk());
    await tick();
    void p.loader.load();
    fails[1]?.(new HttpError(404, "No such business"));
    await tick();
    expect(p.state()).toMatchObject({ data: null, status: "refused" });
  });

  it("after the page closes (actor or business switch), a late answer changes nothing", async () => {
    const answers: ((v: HelperDesk) => void)[] = [];
    const fails: ((e: unknown) => void)[] = [];
    const p = page(answers, fails);
    void p.loader.load();
    p.loader.close();
    answers[0]?.(desk());
    await tick();
    expect(p.state().data).toBeNull();
  });
});

describe("005b action outcomes", () => {
  it("no answer is 'outcome unknown' (re-read, not resend); refusals and conflicts are told apart", () => {
    expect(actionOutcome(new TypeError("Failed to fetch"))).toBe("unknown");
    expect(actionOutcome(new HttpError(403, "no"))).toBe("refused");
    expect(actionOutcome(new HttpError(409, "already"))).toBe("conflict");
    expect(actionOutcome(new HttpError(500, "boom"))).toBe("failed");
    expect(actionMessage("unknown", "")).toMatch(/without sending it again/);
  });
});
