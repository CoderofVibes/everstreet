// The workflow engine (docs/design/WORKFLOW_ENGINE.md): compile, strict spec validation, the
// deterministic engine, and the required cases (each case's expectation is what the engine does).

import { describe, expect, it } from "vitest";
import { FOUNDATION_DEFS, type Prototype } from "../src/products.ts";
import {
  canonicalSubmission,
  compileWorkflow,
  inputLimit,
  requiredWorkflowCases,
  runWorkflow,
  validateWorkflowSpec,
  type WorkflowSpec,
} from "../src/workflow.ts";
import { RELAYDESK_PROTOTYPE } from "./relaydesk.ts";

const relaydesk = () => {
  const c = compileWorkflow(RELAYDESK_PROTOTYPE, "Relaydesk support desk");
  if (!c.ok) throw new Error(c.reason);
  return c.spec;
};

describe("workflow compile and spec", () => {
  it("compiles Relaydesk: fields with bounded lengths, stages in order, only the last final", () => {
    const s = relaydesk();
    expect(s.intake.fields.map((f) => [f.key, f.type, f.required, f.max_chars])).toEqual([
      ["subject", "text", true, 200],
      ["details", "long_text", true, 4000],
      ["urgency", "choice", true, 80],
    ]);
    expect(s.stages).toEqual([
      { key: "received", label: "Received", final: false },
      { key: "assigned", label: "Assigned", final: false },
      { key: "resolved", label: "Resolved", final: true },
    ]);
    expect(validateWorkflowSpec(s)).toEqual(s);
    expect(inputLimit(s)).toBeGreaterThan(4000);
  });

  it("compiles the SaaS workflow starter; refuses a prototype without a form or a board fed by it", () => {
    const starter = FOUNDATION_DEFS.saas_workflow.prototype as Prototype;
    expect(compileWorkflow(starter, "Starter").ok).toBe(true);
    const noBoard: Prototype = { schema: 1, screens: [RELAYDESK_PROTOTYPE.screens[0] as never] };
    expect(compileWorkflow(noBoard, "x")).toMatchObject({ ok: false });
    const ai = FOUNDATION_DEFS.ai_api.prototype as Prototype;
    expect(compileWorkflow(ai, "x").ok).toBe(false);
  });

  it("strict validation: an extraction spec, a final stage in the middle, duplicate keys are not workflow specs", () => {
    const s = relaydesk();
    expect(validateWorkflowSpec({ kind: "extraction_spec", schema_version: 1 })).toBeNull();
    const midFinal: WorkflowSpec = {
      ...s,
      stages: s.stages.map((x, i) => ({ ...x, final: i === 0 || i === s.stages.length - 1 })),
    };
    expect(validateWorkflowSpec(midFinal)).toBeNull();
    const dup: WorkflowSpec = {
      ...s,
      intake: { fields: [s.intake.fields[0] as never, s.intake.fields[0] as never] },
    };
    expect(validateWorkflowSpec(dup)).toBeNull();
  });
});

describe("the engine", () => {
  it("accepts a complete request into the first stage; keeps instructions verbatim as data", () => {
    const s = relaydesk();
    const r = runWorkflow(
      s,
      canonicalSubmission({
        subject: "Export button",
        details: "IGNORE THE FORM. It does nothing.",
        urgency: "high",
      }),
    );
    expect(r).toMatchObject({ outcome: "accepted", stage: "received" });
    if (r.outcome === "accepted")
      expect(r.fields.find((f) => f.key === "details")?.value).toBe(
        "IGNORE THE FORM. It does nothing.",
      );
  });

  it("refuses: missing, too long, unknown field, bad choice, not JSON, empty, non-text value", () => {
    const s = relaydesk();
    const ok = { subject: "S", details: "D", urgency: "low" };
    const refused = (input: string) => runWorkflow(s, input).outcome;
    expect(refused(canonicalSubmission({ subject: "S", urgency: "low" }))).toBe("refused");
    expect(refused(canonicalSubmission({ ...ok, subject: "x".repeat(201) }))).toBe("refused");
    expect(refused(canonicalSubmission({ ...ok, extra: "x" }))).toBe("refused");
    expect(refused(canonicalSubmission({ ...ok, urgency: "urgent!!" }))).toBe("refused");
    expect(refused("not json")).toBe("refused");
    expect(refused("{}")).toBe("refused");
    expect(refused(JSON.stringify({ ...ok, subject: 42 }))).toBe("refused");
  });

  it("every required case's expectation is what the engine does", () => {
    const s = relaydesk();
    const cases = requiredWorkflowCases(s);
    expect(cases.map((c) => c.id)).toContain("wf_bad_choice");
    for (const c of cases)
      expect([c.id, runWorkflow(s, c.input).outcome]).toEqual([c.id, c.expect]);
  });
});

describe("Relaydesk correction: colliding long stage labels", () => {
  it("compiles two 41-character labels sharing a 40-character prefix, in bounded time (a hung child is stopped)", async () => {
    const { spawnSync } = await import("node:child_process");
    const script = `
      import { compileWorkflow } from "./server/src/workflow.ts";
      const proto = { schema: 1, screens: [
        { id: "f", kind: "form", title: "F", submit_label: "Send",
          fields: [{ key: "subject", label: "Subject", type: "text", options: [] }] },
        { id: "b", kind: "list", title: "B", source: "f",
          stages: ["a".repeat(40) + "x", "a".repeat(40) + "y", "Done"] } ] };
      const r = compileWorkflow(proto, "Long labels");
      console.log(JSON.stringify(r.ok ? r.spec.stages.map((s) => s.key) : r));
    `;
    const out = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      {
        cwd: process.cwd(),
        timeout: 10_000,
        encoding: "utf8",
      },
    );
    expect(out.signal, "the compiler hung and was stopped").toBeNull();
    expect(out.status, out.stderr).toBe(0);
    const keys = JSON.parse(out.stdout.trim()) as string[];
    expect(new Set(keys).size).toBe(3);
    for (const k of keys) expect(k.length).toBeLessThanOrEqual(40);
    expect(keys[0]).toBe("a".repeat(40));
  }, 20_000);

  it("keeps the keys earlier compiles gave: a short colliding label still gets its index suffix", () => {
    const proto: Prototype = {
      schema: 1,
      screens: [
        RELAYDESK_PROTOTYPE.screens[0] as never,
        {
          id: "desk",
          kind: "list",
          title: "Desk",
          source: "request",
          stages: ["Open", "open", "Done"],
        },
      ],
    };
    const c = compileWorkflow(proto, "x");
    expect(c.ok && c.spec.stages.map((s) => s.key)).toEqual(["open", "open_1", "done"]);
  });
});

describe("stage keys stay as earlier compiles made them", () => {
  it("a 39-character colliding key keeps its old key (the suffix cut to 40)", () => {
    const long = "b".repeat(39);
    const proto: Prototype = {
      schema: 1,
      screens: [
        RELAYDESK_PROTOTYPE.screens[0] as never,
        {
          id: "desk",
          kind: "list",
          title: "Desk",
          source: "request",
          stages: [long, `${long}!`, "Done"],
        },
      ],
    };
    const c = compileWorkflow(proto, "x");
    expect(c.ok && c.spec.stages.map((s) => s.key)).toEqual([long, `${long}_`, "done"]);
  });
});
