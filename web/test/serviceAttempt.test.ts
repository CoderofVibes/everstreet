// Jobs 002c1/002c2: a lost request stays recoverable whatever the draft holds; recovering never
// touches the draft or makes new paid work; new paid work needs its own explicit action.

import { describe, expect, it } from "vitest";
import {
  describeAttempt,
  empty,
  inFlight,
  POLL,
  type Requests,
  recover,
  runAction,
  settle,
  start,
  unresolved,
} from "../src/serviceAttempt.ts";

let n = 0;
const mint = () => `run-key-${++n}`;
const T = "2026-11-02T13:00:00.000Z";

/** A request that was sent and whose answer was lost. */
function lost(): { r: Requests; key: string } {
  const s = start(empty(), "INVOICE SH-1042", "release", mint, T);
  if (!s) throw new Error("not started");
  return {
    r: settle(s.requests, s.attempt.key, { ok: false, status: 0, message: "Failed" }),
    key: s.attempt.key,
  };
}

describe("Service requests and the draft", () => {
  it("while one is in flight, nothing else is sent", () => {
    const s = start(empty(), "INVOICE SH-1042", "release", mint, T);
    if (!s) throw new Error("not started");
    expect(runAction(s.requests)).toBe("wait");
    expect(start(s.requests, "other", "release", mint, T, true)).toBeNull();
  });

  it("recovery doesn't depend on the draft: changed, empty or another target", () => {
    const { r, key } = lost();
    expect(unresolved(r).map((a) => a.key)).toEqual([key]);
    // The draft is not an input to recovery at all: it recovers the stored request.
    const again = recover(r, key);
    expect(again?.attempt).toMatchObject({
      key,
      text: "INVOICE SH-1042",
      target: "release",
      state: "sending",
    });
    // The founder's next draft (whatever it is) isn't consulted or changed by these rules.
    for (const draft of ["A different next draft", "", "   "]) {
      expect(runAction(r)).toBe("new_paid_only");
      expect(start(r, draft, "job:b2", mint, T)).toBeNull(); // a plain Run can't replace it
    }
  });

  it("new paid work after a lost answer needs the explicit action, and the lost one stays recoverable", () => {
    const { r, key } = lost();
    const fresh = start(r, "A different next draft", "job:b2", mint, T, true);
    if (!fresh) throw new Error("not started");
    expect(fresh.attempt.key).not.toBe(key);
    expect(fresh.attempt).toMatchObject({ text: "A different next draft", target: "job:b2" });
    const done = settle(fresh.requests, fresh.attempt.key, { ok: true, invocationId: "inv-2" });
    expect(unresolved(done).map((a) => a.key)).toEqual([key]);
    expect(recover(done, key)?.attempt.key).toBe(key);
  });

  it("a recovered answer settles the earlier request, not the draft's", () => {
    const { r, key } = lost();
    const again = recover(r, key);
    if (!again) throw new Error("not recovered");
    const done = settle(again.requests, key, { ok: true, invocationId: "inv-1" });
    expect(done.attempts.find((a) => a.key === key)).toMatchObject({
      state: "answered",
      invocationId: "inv-1",
    });
    expect(runAction(done)).toBe("run");
    expect(inFlight(done)).toBeNull();
  });

  it("refused and answered requests aren't recoverable; unknown keys can't be recovered", () => {
    const s = start(empty(), "x", "release", mint, T);
    if (!s) throw new Error("not started");
    const refused = settle(s.requests, s.attempt.key, {
      ok: false,
      status: 409,
      message: "Not enough budget",
    });
    expect(unresolved(refused)).toEqual([]);
    expect(recover(refused, s.attempt.key)).toBeNull();
    expect(recover(refused, "no-such-key")).toBeNull();
  });

  it("each request is identified to the founder; polling is bounded", () => {
    expect(
      describeAttempt({
        text: "\nINVOICE SH-1042\nmore",
        target: "job:abcdef123456",
        startedAt: T,
      }),
    ).toMatch(/on build abcdef12: "INVOICE SH-1042"/);
    expect(start(empty(), "   ", "release", mint, T)).toBeNull();
    expect(POLL.maxPolls).toBeLessThanOrEqual(60);
    expect(POLL.delay(100)).toBe(15_000);
  });
});
