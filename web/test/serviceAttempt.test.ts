// Jobs 002c1/002c2: a lost request stays recoverable whatever the draft holds; recovering never
// touches the draft or makes new paid work; new paid work needs its own explicit action.

import { describe, expect, it, vi } from "vitest";
import {
  describeAttempt,
  empty,
  inFlight,
  MAX_TRACKED,
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

  it("an unresolved request survives more than ten later answered requests", () => {
    let { r, key } = lost();
    for (let i = 0; i < 15; i++) {
      const s = start(r, `later ${i}`, "release", mint, T, true);
      if (!s) throw new Error(`later ${i} not started`);
      r = settle(s.requests, s.attempt.key, { ok: true, invocationId: `inv-${i}` });
    }
    expect(r.attempts.length).toBe(MAX_TRACKED);
    expect(unresolved(r).map((a) => a.key)).toEqual([key]);
    expect(recover(r, key)?.attempt).toMatchObject({ key, text: "INVOICE SH-1042" });
    // Only the oldest answered history was trimmed; the newest answers are kept.
    expect(r.attempts.at(-1)?.invocationId).toBe("inv-14");
  });

  it("with every slot unresolved, new paid work is refused before a key is minted", () => {
    let r = empty();
    const keys: string[] = [];
    for (let i = 0; i < MAX_TRACKED; i++) {
      const s = start(r, `request ${i}`, "release", mint, T, true);
      if (!s) throw new Error(`request ${i} not started`);
      keys.push(s.attempt.key);
      r = settle(s.requests, s.attempt.key, { ok: false, status: 502, message: "Bad gateway" });
    }
    expect(unresolved(r).map((a) => a.key)).toEqual(keys);
    expect(runAction(r)).toBe("full");
    const minted = vi.fn(() => "never-used");
    const draft = "The eleventh request the founder typed";
    expect(start(r, draft, "release", minted, T, true)).toBeNull();
    expect(start(r, draft, "release", minted, T)).toBeNull();
    expect(minted).not.toHaveBeenCalled();
    // Nothing was dropped or changed, and the draft was never stored.
    expect(unresolved(r).map((a) => a.key)).toEqual(keys);
    expect(r.attempts.some((a) => a.text === draft)).toBe(false);

    // Recovery still works at the limit, for the oldest as well as the newest.
    const oldest = recover(r, keys[0] as string);
    if (!oldest) throw new Error("oldest not recoverable");
    expect(oldest.requests.attempts.length).toBe(MAX_TRACKED);
    expect(runAction(oldest.requests)).toBe("wait");
    // Its answer arrives: that settled entry frees capacity for explicit new work.
    const freed = settle(oldest.requests, keys[0] as string, { ok: true, invocationId: "inv-0" });
    expect(runAction(freed)).toBe("new_paid_only");
    const next = start(freed, draft, "release", mint, T, true);
    if (!next) throw new Error("not started after capacity freed");
    expect(next.requests.attempts.length).toBe(MAX_TRACKED);
    // The settled one was trimmed, never an unresolved one.
    expect(unresolved(next.requests).map((a) => a.key)).toEqual(keys.slice(1));
    expect(next.requests.attempts.some((a) => a.key === keys[0])).toBe(false);
  });

  it("a refusal settles a request (trimmable, not recoverable); an unknown answer pins it", () => {
    let r = empty();
    for (let i = 0; i < MAX_TRACKED - 1; i++) {
      const s = start(r, `lost ${i}`, "release", mint, T, true);
      if (!s) throw new Error("not started");
      r = settle(s.requests, s.attempt.key, { ok: false, status: 0, message: "Failed" });
    }
    const s = start(r, "refused one", "release", mint, T, true);
    if (!s) throw new Error("not started");
    r = settle(s.requests, s.attempt.key, { ok: false, status: 402, message: "Over budget" });
    // Nine unresolved and one refusal: there is still room, and the refusal isn't recoverable.
    expect(runAction(r)).toBe("new_paid_only");
    expect(recover(r, s.attempt.key)).toBeNull();
    const t = start(r, "tenth unknown", "release", mint, T, true);
    if (!t) throw new Error("not started");
    // The refusal made way; the new request then lost its answer too: now full.
    r = settle(t.requests, t.attempt.key, { ok: false, status: 503, message: "Unavailable" });
    expect(r.attempts.some((a) => a.key === s.attempt.key)).toBe(false);
    expect(unresolved(r).length).toBe(MAX_TRACKED);
    expect(runAction(r)).toBe("full");
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
