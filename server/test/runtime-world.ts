// Shared fixtures for the managed runtime tests (job 002c). Fictional data only.

import type { ExtractionSpec } from "../src/artifacts.ts";

export const INVOICE_SPEC: ExtractionSpec = {
  kind: "extraction_spec",
  schema_version: 1,
  name: "Invoice reader",
  input: { kind: "document_text", max_chars: 8000 },
  fields: [
    { key: "vendor", label: "Vendor", type: "text", required: true, description: "" },
    {
      key: "invoice_number",
      label: "Invoice number",
      type: "text",
      required: true,
      description: "",
    },
    { key: "invoice_date", label: "Invoice date", type: "date", required: true, description: "" },
    { key: "total", label: "Total", type: "number", required: true, description: "" },
    { key: "currency", label: "Currency", type: "text", required: false, description: "" },
  ],
  instructions: "Read one invoice.",
  examples: [],
};
