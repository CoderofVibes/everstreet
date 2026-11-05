// The analysis engine (docs/design/AGENT_ANALYSIS.md): compile, strict spec validation, input
// checks before any model call, the platform's checks on an answer (verbatim evidence above all),
// and the required cases: the labelled stand-in passes every one, and wrong answers fail them.

import { describe, expect, it } from "vitest";
import {
  type AnalysisSpec,
  analysisContent,
  compileAnalysis,
  parseAnalysisInput,
  requiredAnalysisCases,
  scoreAnalysis,
  validateAnalysis,
  validateAnalysisSpec,
} from "../src/analysis.ts";
import { FOUNDATION_DEFS, type Prototype } from "../src/products.ts";
import { SIGNALWATCH_BRIEF, SIGNALWATCH_PROTOTYPE, standInFromContent } from "./analyst.ts";

const signalwatch = () => {
  const c = compileAnalysis(SIGNALWATCH_PROTOTYPE, SIGNALWATCH_BRIEF);
  if (!c.ok) throw new Error(c.reason);
  return c.spec;
};
/** The stand-in's answer for a canonical submission, through the real request content. */
const answer = (spec: AnalysisSpec, input: string) => {
  const p = parseAnalysisInput(spec, input);
  if (!p.ok) throw new Error(p.reason);
  return { source: p.source, output: standInFromContent(analysisContent(spec, p)) };
};

describe("analysis compile and spec", () => {
  it("compiles Signalwatch: the notes are the source, what you rely on is context", () => {
    const s = signalwatch();
    expect(s.source).toEqual({ key: "notes", label: "Release notes", max_chars: 12_000 });
    expect(s.context).toEqual([{ key: "relies", label: "What you rely on", max_chars: 2000 }]);
    expect(s.result_title).toBe("Flags for you");
    expect(validateAnalysisSpec(s)).toEqual(s);
  });

  it("compiles the agent-service starter; refuses a prototype without an agent result screen", () => {
    expect(
      compileAnalysis(FOUNDATION_DEFS.agent_service.prototype as Prototype, SIGNALWATCH_BRIEF).ok,
    ).toBe(true);
    const noModel: Prototype = { schema: 1, screens: [SIGNALWATCH_PROTOTYPE.screens[0] as never] };
    expect(compileAnalysis(noModel, SIGNALWATCH_BRIEF)).toMatchObject({ ok: false });
    expect(validateAnalysisSpec({ ...signalwatch(), kind: "workflow_spec" })).toBeNull();
    expect(validateAnalysisSpec({ ...signalwatch(), tools: ["http"] })).toBeNull();
  });

  it("refuses a malformed submission before any model call", () => {
    const s = signalwatch();
    for (const bad of [
      "not json",
      "{}",
      '{"relies":"x"}',
      '{"notes":"x","extra":"y"}',
      '{"notes":5}',
    ])
      expect(parseAnalysisInput(s, bad).ok).toBe(false);
    expect(parseAnalysisInput(s, JSON.stringify({ notes: "x".repeat(12_001) })).ok).toBe(false);
  });
});

describe("the platform's checks on an answer", () => {
  const s = signalwatch();
  const source = "Northbeam v1.2 release notes\n- Removed the Export API on 2026-12-01.";
  const flag = {
    title: "Export API removed",
    severity: "high",
    evidence: "Removed the Export API on 2026-12-01.",
    why: "You use it.",
    proposed_action: "Move to Reports.",
  };
  it("a verbatim quote is delivered; whitespace differences don't matter", () => {
    const ok = validateAnalysis(s, source, {
      status: "analyzed",
      summary: "One change.",
      findings: [flag],
    });
    expect(ok.outcome).toBe("analyzed");
    const spaced = { ...flag, evidence: "Removed  the Export\nAPI on 2026-12-01." };
    expect(
      validateAnalysis(s, source, { status: "analyzed", summary: "x", findings: [spaced] }).outcome,
    ).toBe("analyzed");
  });
  it("a made-up quote, a bad severity, too many flags or an empty field make the answer invalid", () => {
    const made = { ...flag, evidence: "The Export API will be removed next week." };
    const r = validateAnalysis(s, source, { status: "analyzed", summary: "x", findings: [made] });
    expect(r).toMatchObject({ outcome: "invalid", findings: [] });
    expect(r.problems).toContain("flag 1 quoted text that isn't in the source");
    expect(
      validateAnalysis(s, source, {
        status: "analyzed",
        summary: "x",
        findings: [{ ...flag, severity: "urgent" }],
      }).outcome,
    ).toBe("invalid");
    expect(
      validateAnalysis(s, source, {
        status: "analyzed",
        summary: "x",
        findings: Array(9).fill(flag),
      }).outcome,
    ).toBe("invalid");
    expect(
      validateAnalysis(s, source, {
        status: "analyzed",
        summary: "x",
        findings: [{ ...flag, why: " " }],
      }).outcome,
    ).toBe("invalid");
    expect(
      validateAnalysis(s, source, { status: "done", summary: "x", findings: [] }).outcome,
    ).toBe("invalid");
  });
  it("not applicable is a refusal with the model's reason", () => {
    expect(
      validateAnalysis(s, source, { status: "not_applicable", summary: "A recipe.", findings: [] }),
    ).toMatchObject({
      outcome: "refused",
      reason: "A recipe.",
    });
  });
});

describe("the required cases", () => {
  it("the stand-in passes every required case through the real request and checks", () => {
    const s = signalwatch();
    for (const c of requiredAnalysisCases(s)) {
      const { source, output } = answer(s, c.input);
      const r = validateAnalysis(s, source, output);
      expect([c.id, scoreAnalysis(c, r.outcome, r)]).toEqual([
        c.id,
        { score: "pass", explanation: `${r.outcome}, as expected` },
      ]);
    }
  });
  it("wrong answers fail them: following the injected instruction, missing the flag, flagging noise", () => {
    const s = signalwatch();
    const cases = requiredAnalysisCases(s);
    const by = (id: string) => cases.find((c) => c.id === id) as (typeof cases)[number];
    const nothing = validateAnalysis(s, "x", {
      status: "analyzed",
      summary: "Nothing changed.",
      findings: [],
    });
    expect(scoreAnalysis(by("an_instructions"), nothing.outcome, nothing).score).toBe("fail");
    expect(scoreAnalysis(by("an_removal"), nothing.outcome, nothing).score).toBe("fail");
    const noise = {
      outcome: "analyzed" as const,
      summary: "",
      problems: [],
      reason: null,
      findings: [
        {
          title: "t",
          severity: "low" as const,
          evidence: "New colour themes.",
          why: "w",
          proposed_action: "a",
        },
      ],
    };
    expect(scoreAnalysis(by("an_nothing"), noise.outcome, noise).score).toBe("fail");
    expect(scoreAnalysis(by("an_not_notes"), "analyzed", noise).score).toBe("fail");
  });
});
