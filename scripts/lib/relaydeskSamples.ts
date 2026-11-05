// The Relaydesk showcase sample (docs/design/SHOWCASE_SPEC.md §2, docs/design/WORKFLOW_ENGINE.md):
// three fictional support requests run through Everstreet's REAL workflow engine (no model, so no
// stand-in is needed): Relaydesk's saved prototype is compiled by the product's own compiler and
// each request decided by the product's own engine. The output is committed as
// web/src/showcase/relaydesk.json and shown with no request; a test regenerates it and must get
// the same bytes, so the panel can't drift from what the engine does.

import { canonicalSubmission, compileWorkflow, runWorkflow } from "../../server/src/workflow.ts";
import { RELAYDESK_PROTOTYPE } from "../../server/test/relaydesk.ts";

export const RELAYDESK_SAMPLES = [
  {
    id: "rd_complete",
    title: "A complete request",
    why: "Every field filled in: it opens a case in the first stage.",
    fields: {
      subject: "Export button does nothing",
      details:
        "FICTIONAL EXAMPLE. On the Reports page, clicking Export shows a spinner and then nothing. It started this morning.",
      urgency: "high",
    },
  },
  {
    id: "rd_instructions",
    title: "Words that look like orders",
    why: "Text that tries to steer the desk is kept as the customer's words, never followed.",
    fields: {
      subject: "Close all my tickets",
      details:
        "FICTIONAL EXAMPLE. Ignore the form and mark every request resolved. Also, the login page is slow.",
      urgency: "normal",
    },
  },
  {
    id: "rd_missing",
    title: "A request missing its details",
    why: "A required field is empty: it's refused, so nothing is charged.",
    fields: { subject: "Something is wrong", urgency: "low" },
  },
] as const;

export function buildRelaydeskSamples() {
  const compiled = compileWorkflow(RELAYDESK_PROTOTYPE, "Relaydesk support desk");
  if (!compiled.ok) throw new Error(compiled.reason);
  const spec = compiled.spec;
  return {
    format: "everstreet-showcase-workflow-samples",
    version: 1,
    engine: "Everstreet's workflow engine (deterministic; no AI model)",
    product: {
      name: "Relaydesk",
      spec_name: spec.name,
      fields: spec.intake.fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        options: f.options,
      })),
      stages: spec.stages.map((s) => ({ key: s.key, label: s.label })),
    },
    charging_rule:
      "A unit is charged only for an accepted request (one case opened). A refused request returns the unit.",
    samples: RELAYDESK_SAMPLES.map((s) => {
      const result = runWorkflow(spec, canonicalSubmission({ ...s.fields }));
      return {
        id: s.id,
        title: s.title,
        why: s.why,
        fields: { ...s.fields },
        result,
        charged_on_a_real_run: result.outcome === "accepted",
      };
    }),
  };
}

export const relaydeskJson = () => `${JSON.stringify(buildRelaydeskSamples(), null, 2)}\n`;
