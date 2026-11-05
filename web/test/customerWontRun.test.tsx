// Job 003wf3 (Astra 02:43): a use that never ran and now never can composes every panel and step
// from that terminal state. Pure projections and the page's own ResultArea, from use shapes the
// API returns (the actual configured page is customerReturnedUse.test.tsx).

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UseView } from "../src/customerApi.ts";
import { customerSteps, WONT_RUN_RESULT, wontRun } from "../src/customerView.ts";
import { ResultArea } from "../src/pages/CustomerProduct.tsx";

const use = (state: string, unit: string) =>
  ({
    id: "u1",
    state,
    explanation: "Ended.",
    execution: null,
    input: { chars: 80 },
    units: { unit, reason: null, retryable: false },
    headline: { title: "t", detail: "d" },
  }) as unknown as UseView;
const view = (u: UseView) => ({
  use: u,
  result: null,
  check: null,
  unanswered: null,
  draft: "",
  inDoubt: null,
});
const resultStep = (u: UseView) => customerSteps(view(u) as never).find((s) => s.key === "result");
const panel = (u: UseView) =>
  renderToStaticMarkup(createElement(ResultArea, { use: u, result: null, fields: ["total"] }));

describe("003wf3 a use that won't run never invites a run or promises a result", () => {
  it.each([
    ["reserved", "returned", "returned"],
    ["reserved", "release_pending", "returning"],
    ["cancelled", "not_held", "ended"],
    ["expired", "not_held", "ended"],
  ] as const)("%s with its unit %s", (state, unit, kind) => {
    const u = use(state, unit);
    expect(wontRun(u)).toBe(kind);
    expect(resultStep(u)).toMatchObject({ status: "stopped", detail: WONT_RUN_RESULT[kind] });
    const html = panel(u);
    expect(html).toContain(WONT_RUN_RESULT[kind].replaceAll("'", "&#x27;"));
    expect(html).not.toMatch(/Run it when|You&#x27;ll get/);
  });

  it("a reserved use still awaiting its run keeps inviting it", () => {
    const u = use("reserved", "reserved_awaiting_settlement");
    expect(wontRun(u)).toBeNull();
    expect(resultStep(u)).toMatchObject({
      status: "waiting",
      detail: "Appears here after the run.",
    });
    expect(panel(u)).toContain("Reserved. Run it when you&#x27;re ready.");
  });
});
