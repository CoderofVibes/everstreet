// Joining work-log pages (Astra's long-log follow-up): older pages loaded on request and a
// polled tail that overlaps them must give each message once, in order, with fresh status.

import { describe, expect, it } from "vitest";
import { mergeLog, olderCursor } from "../src/workLog.ts";

const m = (seq: number, status = "") => ({ id: `m${seq}`, seq, status });

describe("work log pages", () => {
  it("keeps older history when a new tail arrives, without duplicates", () => {
    const older = [1, 2, 3].map((s) => m(s));
    const tail = [3, 4, 5].map((s) => m(s));
    expect(mergeLog(older, tail).map((x) => x.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it("takes the fresher copy of a message seen in both (its request status changed)", () => {
    const merged = mergeLog([m(4, "running")], [m(4, "succeeded"), m(5)]);
    expect(merged.find((x) => x.seq === 4)?.status).toBe("succeeded");
  });

  it("pages back from the oldest message shown", () => {
    const shown = mergeLog([m(151), m(152)], [m(200), m(201), m(202)]);
    expect(olderCursor(shown)).toBe(151);
    expect(olderCursor([])).toBeNull();
  });
});
