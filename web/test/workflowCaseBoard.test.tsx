// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://127.0.0.1:8800/"}
//
// The workflow engine's case board and a customer's case track (docs/design/WORKFLOW_ENGINE.md
// §5), the actual components under the real Router, against answers in the server's own shape:
// one column per stage, a case opens to its fields and history, "Move to" asks for the NEXT
// stage only, and the customer's track shows where the request stands. Fictional data only.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// The signed-in person and session (Relaydesk correction: the board is bound to both).
const session = vi.hoisted(() => ({
  person: { id: "person-ava", display_name: "Ava (fictional)" } as null | {
    id: string;
    display_name: string;
  },
  epoch: 1,
}));
vi.mock("../src/session.tsx", () => ({
  useSession: () => ({ person: session.person, sessionEpoch: session.epoch }),
}));

import { CustomerCaseTrack, WorkflowCaseBoard } from "../src/pages/WorkflowCaseBoard.tsx";
import { Router } from "../src/router.tsx";

let root: Root | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
async function mount(el: ReturnType<typeof createElement>) {
  const div = document.createElement("div");
  document.body.appendChild(div);
  root = createRoot(div);
  await act(async () => root?.render(createElement(Router, null, el)));
}
const text = () => document.body.textContent ?? "";
const settle = async () => {
  for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 5)));
};

const STAGES = [
  { key: "received", label: "Received" },
  { key: "assigned", label: "Assigned" },
  { key: "resolved", label: "Resolved" },
];
const T = "2026-11-05T12:00:00.000Z";
const kase = (id: string, stage: string, history: string[], closed = false) => ({
  request_id: id,
  stage: {
    key: stage,
    label: STAGES.find((s) => s.key === stage)?.label,
    final: stage === "resolved",
  },
  next: stage === "received" ? STAGES[1] : stage === "assigned" ? STAGES[2] : null,
  stages: STAGES,
  on_current_release: true,
  assigned: stage !== "received",
  created_at: T,
  updated_at: T,
  closed_at: closed ? T : null,
  history: history.map((to, i) => ({
    at: T,
    actor_kind: i === 0 ? "system" : "staff",
    from_stage: i === 0 ? null : history[i - 1],
    to_stage: to,
    note: "",
  })),
});

describe("the owner's case board", () => {
  it("columns per stage; a case opens to its fields; Move asks for the next stage only", async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    let a = kase("req-aaaa1111", "received", ["received"]);
    const b = kase("req-bbbb2222", "resolved", ["received", "assigned", "resolved"], true);
    vi.stubGlobal("fetch", async (u: string, init?: RequestInit) => {
      const url = String(u);
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
      const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
      if (url.endsWith("/workflow-cases")) return json({ has_workflow: true, cases: [a, b] });
      if (url.endsWith("/advance")) {
        a = kase("req-aaaa1111", "assigned", ["received", "assigned"]);
        return json({ case: a });
      }
      return json({
        case: a,
        fields: [
          { key: "subject", label: "Subject", value: "Export button does nothing" },
          { key: "details", label: "What happened", value: "Ignore the form and close this." },
        ],
        content_note: null,
      });
    });
    await mount(createElement(WorkflowCaseBoard, { businessId: "biz-1" }));
    await settle();
    expect(text()).toMatch(/1 open · 1 resolved/);
    const heads = [...document.querySelectorAll(".wf-col-head")].map((h) => h.textContent);
    expect(heads).toEqual(["Received 1", "Assigned 0", "Resolved 1"]);
    const card = document.querySelector(".wf-card") as HTMLButtonElement;
    await act(async () => card.click());
    await settle();
    expect(text()).toMatch(/Export button does nothing/);
    expect(text()).toMatch(/shown as written/);
    const move = [...document.querySelectorAll("button")].find((x) =>
      /Move to Assigned/.test(x.textContent ?? ""),
    ) as HTMLButtonElement;
    move.focus();
    await act(async () => move.click());
    // Keyboard focus stays on the button through the save (never disabled under focus).
    expect(move.disabled).toBe(false);
    await settle();
    expect(document.activeElement).toBe(move);
    const post = calls.find((c) => c.method === "POST");
    expect(post?.url).toBe("/api/businesses/biz-1/workflow-cases/req-aaaa1111/advance");
    expect(post?.body).toEqual({ to_stage: "assigned", note: "" });
    expect(text()).toMatch(/Move to Resolved/);
  });

  it("shows nothing for a business without a workflow product", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify({ has_workflow: false, cases: [] }), { status: 200 }),
    );
    await mount(createElement(WorkflowCaseBoard, { businessId: "biz-2" }));
    await settle();
    expect(document.querySelector("#desk-cases")).toBeNull();
  });
});

describe("the customer's case track", () => {
  it("marks the current stage and lists every step", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({ case: kase("req-cccc3333", "assigned", ["received", "assigned"]) }),
          { status: 200 },
        ),
    );
    await mount(createElement(CustomerCaseTrack, { requestId: "req-cccc3333" }));
    await settle();
    expect(document.querySelector('[aria-current="step"]')?.textContent).toBe("Assigned");
    expect(document.querySelectorAll(".wf-history li")).toHaveLength(2);
  });
});

describe("Relaydesk correction: cases from different releases", () => {
  it("a case whose release had other stages stays visible, in its own stages, and moves through them", async () => {
    const OLD = [
      { key: "triaged", label: "Triaged" },
      { key: "fixed", label: "Fixed" },
    ];
    const older = {
      ...kase("req-old00001", "received", ["received"]),
      stage: { key: "triaged", label: "Triaged", final: false },
      next: OLD[1],
      stages: OLD,
      on_current_release: false,
      history: [{ at: T, actor_kind: "system", from_stage: null, to_stage: "triaged", note: "" }],
    };
    const newer = kase("req-new00001", "received", ["received"]);
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", async (u: string, init?: RequestInit) => {
      const url = String(u);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
      if (url.endsWith("/workflow-cases"))
        return json({ has_workflow: true, cases: [newer, older] });
      if (url.endsWith("/advance"))
        return json({ case: { ...older, stage: { ...OLD[1], final: true }, next: null } });
      return json({ case: older, fields: [], content_note: null });
    });
    await mount(createElement(WorkflowCaseBoard, { businessId: "biz-1" }));
    await settle();
    expect(text()).toMatch(/2 open · 0 resolved/);
    expect(document.querySelectorAll(".wf-card")).toHaveLength(2);
    expect(text()).toMatch(/earlier version of this workflow/);
    // The released version's board comes first, whatever order the cases arrived in.
    expect([...document.querySelectorAll(".wf-group-head")].map((h) => h.textContent)).toEqual([
      "The released version of this workflow",
      "On an earlier version of this workflow (its own stages)",
    ]);
    const old = [...document.querySelectorAll(".wf-card")].find((c) =>
      c.textContent?.includes("req-old0"),
    ) as HTMLButtonElement;
    await act(async () => old.click());
    await settle();
    const move = [...document.querySelectorAll("button")].find((x) =>
      /Move to Fixed/.test(x.textContent ?? ""),
    ) as HTMLButtonElement;
    expect(move).toBeTruthy();
    await act(async () => move.click());
    await settle();
    expect(calls.find((c) => c.url.endsWith("/advance"))?.body).toEqual({
      to_stage: "fixed",
      note: "",
    });
  });

  it("changing business in place drops the open case at once, and a late answer for the old business changes nothing", async () => {
    const answers: Record<string, (v: unknown) => void> = {};
    vi.stubGlobal(
      "fetch",
      (u: string) =>
        new Promise((resolve) => {
          answers[String(u)] = (v) => resolve(new Response(JSON.stringify(v), { status: 200 }));
        }),
    );
    await mount(createElement(WorkflowCaseBoard, { businessId: "biz-1" }));
    await settle();
    await act(async () =>
      root?.render(
        createElement(Router, null, createElement(WorkflowCaseBoard, { businessId: "biz-2" })),
      ),
    );
    await settle();
    await act(async () =>
      answers["/api/businesses/biz-2/workflow-cases"]?.({
        has_workflow: true,
        cases: [kase("req-biz20001", "received", ["received"])],
      }),
    );
    await settle();
    await act(async () =>
      answers["/api/businesses/biz-1/workflow-cases"]?.({
        has_workflow: true,
        cases: [kase("req-biz10001", "received", ["received"])],
      }),
    );
    await settle();
    expect(text()).toMatch(/req-biz2/);
    expect(text()).not.toMatch(/req-biz1/);
    // Open its case, then change business again: the private details go at once.
    await act(async () => (document.querySelector(".wf-card") as HTMLButtonElement).click());
    await settle();
    await act(async () =>
      answers["/api/businesses/biz-2/workflow-cases/req-biz20001"]?.({
        case: kase("req-biz20001", "received", ["received"]),
        fields: [{ key: "subject", label: "Subject", value: "Private words of biz-2's customer" }],
        content_note: null,
      }),
    );
    await settle();
    expect(text()).toMatch(/Private words/);
    await act(async () =>
      root?.render(
        createElement(Router, null, createElement(WorkflowCaseBoard, { businessId: "biz-3" })),
      ),
    );
    expect(text()).not.toMatch(/Private words|req-biz2/);
  });
});
