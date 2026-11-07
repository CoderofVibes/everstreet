// @vitest-environment jsdom
//
// The Case Docket (design/sale-proof/DECISION.md): the committed attack-suite results, each clean
// run beside its attack run, the refusal, the protected values, fixtures labelled as fixtures,
// and the planted faults with the check that caught each one.

import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/router.tsx", async () => {
  const React = await import("react");
  return {
    Link: ({ to, children }: { to: string; children: unknown }) =>
      React.createElement("a", { href: to }, children as never),
  };
});

import { AttackDocket, type Suite } from "../src/pages/AttackDocket.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

const suite = () => JSON.parse(readFileSync("data/evidence/attack-suite.json", "utf8")) as Suite;

describe("Case Docket", () => {
  it("shows every group, each case paired with its refusal, labelled as a fixture", () => {
    const s = suite();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(createElement(AttackDocket, { suite: s })));
    const text = host.textContent ?? "";
    expect(text).toContain(`${s.summary.passed} of ${s.summary.cases} attacks refused`);
    expect(host.querySelectorAll(".docket-group").length).toBe(9);
    expect(host.querySelectorAll(".docket-case").length).toBe(s.cases.length);
    for (const c of s.cases) {
      expect(text).toContain(c.name);
      expect(text).toContain(c.attack.refusal);
    }
    expect(text).toContain("E_NOT_OWNER");
    expect(host.querySelectorAll(".docket-clean").length).toBe(s.cases.length);
    expect(host.querySelectorAll(".docket-attack").length).toBe(s.cases.length);
    // Fixtures are labelled; the source tag has its mark and words.
    expect(
      [...host.querySelectorAll(".pill")].filter((p) => p.textContent === "Fixture").length,
    ).toBe(s.cases.length);
    expect(text).toContain("◇ Synthetic run");
    // Planted faults name the check that caught each one.
    expect(text).toContain("Caught: Owner check");
    expect(text).toContain("Caught: Customer units check");
    expect(host.querySelectorAll("nav a[href^='#group-']").length).toBe(9);
  });
});
