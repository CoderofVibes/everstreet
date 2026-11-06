// Job 002c: the Service page's wording rules.

import { describe, expect, it } from "vitest";
import type { Extraction, Invocation } from "../src/runtimeApi.ts";
import { caseFrom, resultJson, resultRows, SAMPLES, usageLine } from "../src/serviceView.ts";

const result = (over: Partial<Extraction> = {}): Extraction => ({
  outcome: "incomplete",
  fields: [
    {
      key: "vendor",
      label: "Vendor",
      type: "text",
      required: true,
      value: "Quill & Fern",
      note: "",
    },
    {
      key: "invoice_date",
      label: "Invoice date",
      type: "date",
      required: true,
      value: null,
      note: "",
    },
    { key: "currency", label: "Currency", type: "text", required: false, value: null, note: "" },
  ],
  missing: ["invoice_date"],
  problems: [],
  reason: null,
  issues: [],
  model_status: "extracted",
  ...over,
});

const inv = (over: Partial<Invocation>): Invocation =>
  ({
    usage_state: "final",
    input_tokens: 900,
    output_tokens: 120,
    charged_microcents: 150_000,
    reserved_cents: 4,
    ...over,
  }) as Invocation;

describe("the Service page's words", () => {
  it("explains missing values without filling them in", () => {
    const rows = resultRows(result());
    expect(rows[1]).toMatchObject({ value: "—", missing: true });
    expect(rows[1]?.explanation).toMatch(/Required, but not stated.*Nothing was filled in/);
    expect(rows[2]?.explanation).toBe("Not stated in the document.");
  });

  it("never shows unknown cost as zero", () => {
    // First-use review #27/#48: exact and readable (0.15¢), never six-decimal dollars.
    expect(usageLine(inv({}))).toMatch(/^0\.15¢ from the provider's reported usage/);
    expect(usageLine(inv({ usage_state: "unknown", charged_microcents: 0 }))).toMatch(
      /^Unknown: .*4¢ stays reserved/,
    );
    expect(usageLine(inv({ usage_state: "partial" }))).toMatch(/^At least/);
    expect(usageLine(inv({ usage_state: "none" }))).toMatch(/nothing was spent/);
  });

  it("copies values only for a readable result, and no fields for an invalid one", () => {
    expect(JSON.parse(resultJson(result()))).toEqual({
      outcome: "incomplete",
      fields: { vendor: "Quill & Fern", invoice_date: null, currency: null },
      missing: ["invoice_date"],
    });
    const bad = JSON.parse(
      resultJson(result({ outcome: "invalid", fields: [], problems: ["x"], missing: [] })),
    );
    expect(bad.fields).toBeUndefined();
  });

  it("a saved test case expects exactly what the founder saw", () => {
    const c = caseFrom("INVOICE\nQuill & Fern\n…", result(), [
      { id: "case_1", name: "a", input: "a", why: "", expect: { outcomes: ["refused"] } },
    ]);
    expect(c).toMatchObject({
      id: "case_2",
      name: "INVOICE",
      expect: {
        outcomes: ["incomplete"],
        fields: { vendor: "Quill & Fern", invoice_date: null, currency: null },
      },
    });
  });

  it("samples are fictional input text only", () => {
    for (const s of SAMPLES) {
      // Marked fictional on its own line, outside the vendor's name.
      expect(s.text.split("\n")[0]).toMatch(/^FICTIONAL EXAMPLE/);
      expect(s.text).not.toMatch(/linocut|clay|print supply/i);
      expect(Object.keys(s).sort()).toEqual(["label", "text"]);
    }
  });
});
