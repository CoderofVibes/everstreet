// Relaydesk/Signalwatch browser pass (Nov 5): a workflow or analysis product takes a filled-in
// form, so its steps never ask for a pasted document, and an accepted request or a delivered
// analysis is a complete result (it was shown as "Not a complete extraction" before).

import { describe, expect, it } from "vitest";
import type { OfferView, ResultView } from "../src/customerApi.ts";
import { completeResult, customerSteps } from "../src/customerView.ts";

const offer = (kind: OfferView["product"]["kind"]) =>
  ({
    product: { kind, name: "x", max_chars: 1, fields: [], stages: [], result_title: null },
  }) as unknown as OfferView;
const result = (outcome: string) =>
  ({ outcome, retention_until_ms: "0", result: { outcome } }) as unknown as ResultView;
const base = { use: null, result: null, check: null, unanswered: null, draft: "", inDoubt: null };

describe("steps follow the product's kind", () => {
  it("a workflow asks for a request, never a document", () => {
    const steps = customerSteps({ ...base, offer: offer("workflow") } as never);
    expect(steps.map((s) => s.title)).toEqual([
      "Your request",
      "Review and authorize one use",
      "Send your request",
      "Your result",
    ]);
    expect(JSON.stringify(steps.map((x) => [x.title, x.detail]))).not.toMatch(/document/i);
  });
  it("an extraction still asks for its document", () => {
    const steps = customerSteps({ ...base, offer: offer("extraction") } as never);
    expect(steps[0]?.detail).toMatch(/Paste the document/);
  });
  it("accepted and analyzed are complete results; refused and invalid are not", () => {
    for (const o of ["extracted", "accepted", "analyzed"])
      expect(completeResult({ result: result(o) })).toBe(true);
    for (const o of ["refused", "invalid", "incomplete"])
      expect(completeResult({ result: result(o) })).toBe(false);
  });
});
