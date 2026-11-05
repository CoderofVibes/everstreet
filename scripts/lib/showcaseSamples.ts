// Showcase stage A (docs/design/SHOWCASE_SPEC.md §2): the homepage's three sample runs, produced
// from the product's own required evaluation cases and the labelled stand-in model's scripted
// answers, run through the product's own validation step. The output is committed as
// web/src/showcase/samples.json and shown with no request; a test regenerates it and must get
// the same bytes, so the panel can't drift from what the product does.

import { REQUIRED_INVOICE_CASES } from "../../server/src/evaluations.ts";
import { validateExtraction } from "../../server/src/extract.ts";
import { correct, INVOICE_SPEC } from "../../server/test/runtime-world.ts";

export const SAMPLE_CASES = ["req_clean", "req_totals_disagree", "req_unrelated_text"] as const;

export async function buildShowcaseSamples() {
  const samples = [];
  for (const id of SAMPLE_CASES) {
    const c = REQUIRED_INVOICE_CASES.find((x) => x.id === id);
    if (!c) throw new Error(`no required case ${id}`);
    const answer = await correct({
      invocationId: `showcase-${id}`,
      spec: INVOICE_SPEC,
      document: c.input,
      limits: { maxInputTokens: 30_000, maxOutputTokens: 2_000 },
    });
    const extraction = validateExtraction(INVOICE_SPEC, answer.output);
    samples.push({
      id,
      title: c.name,
      why: c.why,
      input: c.input,
      extraction,
      // The product's rule (customerUse.ts eligible): charged only for a delivered `extracted`.
      charged_on_a_real_run: extraction.outcome === "extracted",
    });
  }
  return {
    format: "everstreet-showcase-samples",
    version: 1,
    model: "stand-in (scripted answers prepared in advance; no AI provider)",
    product: {
      name: "Ledgerline",
      spec_name: INVOICE_SPEC.name,
      fields: INVOICE_SPEC.fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        required: f.required,
      })),
    },
    charging_rule:
      "A unit is charged only for a delivered result whose outcome is extracted. A refused or failed run returns the unit.",
    samples,
  };
}

export const samplesJson = async () => `${JSON.stringify(await buildShowcaseSamples(), null, 2)}\n`;
