// Job 002b2: conversation state is scoped to person, project and owner epoch.

import { describe, expect, it } from "vitest";
import { prefillFor, studioScope, withPrefill } from "../src/studioScope.ts";

describe("studio conversation scope", () => {
  const ava = studioScope("ava", "p1", "e1");

  it("differs for another person, project or owner epoch", () => {
    expect(
      new Set([
        ava,
        studioScope("ben", "p1", "e1"),
        studioScope("ava", "p2", "e1"),
        studioScope("ava", "p1", "e2"),
      ]).size,
    ).toBe(4);
    expect(studioScope("ava", "p1", "e1")).toBe(ava);
  });

  it("can't be forged by joining parts differently", () => {
    expect(studioScope("a|b", "c", "d")).not.toBe(studioScope("a", "b|c", "d"));
  });

  it("offered text reaches only the scope it was offered in", () => {
    const offered = { text: "Ask again", n: 1, scope: ava };
    expect(prefillFor(offered, ava)).toBe(offered);
    expect(prefillFor(offered, studioScope("ben", "p1", "e1"))).toBeNull();
    expect(prefillFor(null, ava)).toBeNull();
  });

  it("offered text never wipes a thought being typed", () => {
    expect(withPrefill("", "Ask again")).toBe("Ask again");
    expect(withPrefill("  ", "Ask again")).toBe("Ask again");
    expect(withPrefill("Also add a due date", "Ask again")).toBe(
      "Also add a due date\n\nAsk again",
    );
    expect(withPrefill("Also add a due date\n\nAsk again", "Ask again")).toBe(
      "Also add a due date\n\nAsk again",
    );
  });
});
