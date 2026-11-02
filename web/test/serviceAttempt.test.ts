// Job 002c1: a Service request keeps its identity; retrying is never confused with new paid work.

import { describe, expect, it } from "vitest";
import { begin, nextAction, POLL, settle } from "../src/serviceAttempt.ts";

let n = 0;
const mint = () => `run-key-${++n}`;

describe("a Service request's identity", () => {
  it("while one is in flight, nothing else is sent", () => {
    const a = begin(null, "INVOICE SH-1042", "release", mint);
    expect(a?.state).toBe("sending");
    expect(nextAction(a, "INVOICE SH-1042", "release")).toBe("wait");
    expect(begin(a, "other text", "release", mint)).toBeNull();
  });

  it("after a lost answer, the same text and target check on the same request", () => {
    const a = begin(null, "INVOICE SH-1042", "release", mint);
    if (!a) throw new Error("no attempt");
    const lost = settle(a, { ok: false, status: 0, message: "Failed to fetch" });
    expect(lost.state).toBe("unknown");
    expect(lost.message).toMatch(/won't run it again/);
    expect(nextAction(lost, "INVOICE SH-1042", "release")).toBe("check");
    const again = begin(lost, "INVOICE SH-1042", "release", mint);
    expect(again?.key).toBe(a.key);
  });

  it("changing the text or the target after a lost answer is explicitly new work", () => {
    const a = begin(null, "INVOICE SH-1042", "release", mint);
    if (!a) throw new Error("no attempt");
    const lost = settle(a, { ok: false, status: 503, message: "" });
    expect(nextAction(lost, "INVOICE SH-1042 edited", "release")).toBe("run");
    expect(nextAction(lost, "INVOICE SH-1042", "job:b2")).toBe("run");
    expect(begin(lost, "INVOICE SH-1042", "job:b2", mint)?.key).not.toBe(a.key);
  });

  it("an answered or refused request is finished; the next run is new", () => {
    const a = begin(null, "INVOICE SH-1042", "release", mint);
    if (!a) throw new Error("no attempt");
    const done = settle(a, { ok: true, invocationId: "inv-1" });
    expect([done.state, done.invocationId]).toEqual(["answered", "inv-1"]);
    expect(nextAction(done, "INVOICE SH-1042", "release")).toBe("run");
    const refused = settle(a, { ok: false, status: 409, message: "Not enough runtime budget" });
    expect([refused.state, nextAction(refused, a.text, a.target)]).toEqual(["refused", "run"]);
  });

  it("blank text sends nothing; polling is bounded", () => {
    expect(begin(null, "   ", "release", mint)).toBeNull();
    expect(POLL.maxPolls).toBeLessThanOrEqual(60);
    expect(POLL.delay(100)).toBe(15_000);
  });
});
