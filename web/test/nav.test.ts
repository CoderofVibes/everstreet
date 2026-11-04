// Job 001f: navigation. Every existing route still belongs somewhere sensible, deep links (with
// queries) mark the right destination, a business's sale/handover reads as Acquire, personal
// customer pages sit outside the four, and every contextual link resolves to a real route.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DESTINATIONS, destinationOf, isCurrent, SUBNAV, UTILITIES } from "../src/nav.ts";

describe("001f destinations for existing routes", () => {
  const cases: [string, ReturnType<typeof destinationOf>][] = [
    ["/", "discover"],
    ["/explore", "discover"],
    ["/find", "discover"],
    ["/opportunities", "discover"],
    ["/opportunities/abc/build", "discover"],
    ["/b/ledgerline", "discover"],
    ["/b/ledgerline?via=discovery", "discover"],
    ["/p/person-1", "discover"],
    ["/build", "build"],
    ["/build/p1?view=service&task=customers", "build"],
    ["/start", "build"],
    ["/import", "build"],
    ["/import/w1", "build"],
    ["/studio/x1", "build"],
    ["/desk", "operate"],
    ["/desk/b1", "operate"],
    ["/desk/b1/value", "operate"],
    ["/desk/b1/continuity", "operate"],
    ["/desk/b1/public", "operate"],
    ["/help/b1", "operate"],
    ["/inbox", "operate"],
    ["/desk/b1/sale", "acquire"],
    ["/desk/b1/handover", "acquire"],
    ["/acquire", "acquire"],
    ["/acquire/l/l1", "acquire"],
    ["/acquire/room/r1", "acquire"],
    ["/deal/d1", "acquire"],
    ["/handovers", "acquire"],
    ["/activity", null],
    ["/use/o1", null],
    ["/uses/u1", null],
    ["/profile", null],
  ];
  for (const [path, dest] of cases)
    it(`${path} → ${dest ?? "personal (no destination)"}`, () => {
      expect(destinationOf(path)).toBe(dest);
    });

  it("look-alike prefixes don't match (no /deskx or /bad)", () => {
    expect(destinationOf("/deskx")).toBeNull();
    expect(destinationOf("/bad")).toBeNull();
  });
});

describe("001f current link", () => {
  it("Home is current only on '/'; others on their own subtree, ignoring queries", () => {
    expect(isCurrent("/", "/")).toBe(true);
    expect(isCurrent("/", "/explore")).toBe(false);
    expect(isCurrent("/build", "/build/p1?view=service")).toBe(true);
    expect(isCurrent("/import", "/import/w1")).toBe(true);
    expect(isCurrent("/desk", "/deskx")).toBe(false);
  });
});

describe("001f every navigation target is a real route", () => {
  const app = readFileSync("web/src/App.tsx", "utf8");
  const targets = [
    ...DESTINATIONS.map((d) => d.to),
    ...Object.values(SUBNAV).flatMap((l) => l.map((x) => x.to)),
    ...UTILITIES.map((u) => u.to),
  ];
  for (const to of new Set(targets))
    it(`${to} is routed in App.tsx`, () => {
      const routed = to === "/" ? app.includes('path === "/"') : app.includes(`path === "${to}"`);
      expect(routed).toBe(true);
    });

  it("each destination's landing page is one of its own contextual links", () => {
    for (const d of DESTINATIONS) expect(SUBNAV[d.id].some((l) => l.to === d.to)).toBe(true);
  });
});
