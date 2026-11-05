// The Signalwatch showcase sample (docs/design/SHOWCASE_SPEC.md §2, docs/design/AGENT_ANALYSIS.md):
// three fictional release notes, each sent through the product's own analysis request to the
// LABELLED stand-in analyst (no AI provider), and its answer run through the product's own
// checks. The output is committed as web/src/showcase/signalwatch.json and shown with no
// request; a test regenerates it and must get the same bytes, so the panel can't drift from
// what the product does.

import {
  analysisContent,
  compileAnalysis,
  parseAnalysisInput,
  validateAnalysis,
} from "../../server/src/analysis.ts";
import { canonicalSubmission } from "../../server/src/workflow.ts";
import {
  SIGNALWATCH_BRIEF,
  SIGNALWATCH_PROTOTYPE,
  standInFromContent,
} from "../../server/test/analyst.ts";

const RELIES = "We call the Ledger Export API every night and sign in with SSO.";

export const SIGNALWATCH_SAMPLES = [
  {
    id: "sw_removal",
    title: "A removal you rely on",
    why: "The endpoint you call every night is going away: flagged, quoting the line.",
    notes:
      "FICTIONAL EXAMPLE. Northbeam API v4.2 release notes\n- Added dark mode to the dashboard.\n- Removed the Ledger Export API endpoint /v1/export on 2026-12-01.\n- The Ledger Export API is deprecated; use Reports API v2.",
  },
  {
    id: "sw_quiet",
    title: "Nothing that affects you",
    why: "Cosmetic changes only: a delivered analysis with no flags.",
    notes:
      "FICTIONAL EXAMPLE. Northbeam v4.3 release notes\n- New colour themes.\n- Faster page loads on the dashboard.\n- Fixed a typo in the help centre.",
  },
  {
    id: "sw_not_notes",
    title: "Not release notes",
    why: "A recipe isn't release notes: refused, so nothing is charged.",
    notes:
      "FICTIONAL EXAMPLE. Lemon cake: beat 200 g butter with 200 g sugar, add four eggs, bake for 40 minutes.",
  },
] as const;

export function buildSignalwatchSamples() {
  const compiled = compileAnalysis(SIGNALWATCH_PROTOTYPE, SIGNALWATCH_BRIEF);
  if (!compiled.ok) throw new Error(compiled.reason);
  const spec = compiled.spec;
  return {
    format: "everstreet-showcase-analysis-samples",
    version: 1,
    model: "stand-in (a deterministic analyst prepared in advance; no AI provider)",
    product: {
      name: "Signalwatch",
      result_title: spec.result_title,
      source_label: spec.source.label,
      context_label: spec.context[0]?.label ?? "",
    },
    relies: RELIES,
    charging_rule:
      "A unit is charged only for a delivered analysis, including one that finds nothing. A refused or invalid answer returns the unit.",
    samples: SIGNALWATCH_SAMPLES.map((s) => {
      const input = parseAnalysisInput(
        spec,
        canonicalSubmission({ notes: s.notes, relies: RELIES }),
      );
      if (!input.ok) throw new Error(input.reason);
      const output = standInFromContent(analysisContent(spec, input));
      const analysis = validateAnalysis(spec, input.source, output);
      return {
        id: s.id,
        title: s.title,
        why: s.why,
        notes: s.notes,
        analysis,
        charged_on_a_real_run: analysis.outcome === "analyzed",
      };
    }),
  };
}

export const signalwatchJson = () => `${JSON.stringify(buildSignalwatchSamples(), null, 2)}\n`;
