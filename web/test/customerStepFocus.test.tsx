// 006a browser pass (Nov 5): on the customer page, a keyboard user pressed Enter on "Review one
// use" and the next step's button lost focus to the page, because the button was `disabled`
// while the step ran (a disabled button drops focus). It now stays focusable while busy
// (aria-disabled, and a click then does nothing); it is still disabled when there's no action.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { WorkspaceState } from "../src/customerWorkspace.ts";
import { StepActions } from "../src/pages/CustomerProduct.tsx";

const base = {
  status: "ready",
  offer: null,
  use: null,
  result: null,
  check: null,
  unanswered: null,
  inDoubt: null,
  waiting: null,
  accepted: null,
  notice: null,
  authorizer: null,
} as unknown as WorkspaceState;

const primary = (s: WorkspaceState) =>
  /<div class="use-actions"><button[^>]*>/.exec(
    renderToStaticMarkup(createElement(StepActions, { s, onAction: () => {} })),
  )?.[0] ?? "";

describe("the customer's step button keeps keyboard focus while a step runs", () => {
  it("busy: focusable and marked aria-disabled, never disabled", () => {
    const b = primary({ ...base, draft: "Access pass", busy: "prepare" } as WorkspaceState);
    expect(b).toContain('aria-disabled="true"');
    expect(b).not.toMatch(/\sdisabled=""/);
  });
  it("idle with nothing to send: disabled", () => {
    const b = primary({ ...base, draft: "", busy: null } as WorkspaceState);
    expect(b).toMatch(/\sdisabled=""/);
    expect(b).not.toContain("aria-disabled");
  });
  it("idle and ready: enabled", () => {
    const b = primary({ ...base, draft: "Access pass", busy: null } as WorkspaceState);
    expect(b).not.toMatch(/disabled/);
  });
});
