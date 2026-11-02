// The one build artifact this version accepts: `extraction_spec/1`, a declarative description
// of a document-to-data service (what it reads, which fields it returns, instructions and
// worked examples). It is data, never code: the platform parses it, rebuilds it from checked
// parts, canonicalizes and hashes it, and runs deterministic checks against the revision it
// was built from. Anything else a provider returns, including plain model text, is refused.

import { createHash } from "node:crypto";
import type { Prototype } from "./products.ts";

export const ARTIFACT_SCHEMA = "extraction_spec/1" as const;
export const MAX_ARTIFACT_BYTES = 64 * 1024;

export const SPEC_FIELD_TYPES = ["text", "number", "date", "boolean"] as const;
type SpecFieldType = (typeof SPEC_FIELD_TYPES)[number];

export interface ExtractionSpec {
  kind: "extraction_spec";
  schema_version: 1;
  name: string;
  input: { kind: "text" | "document_text"; max_chars: number };
  fields: {
    key: string;
    label: string;
    type: SpecFieldType;
    required: boolean;
    description: string;
  }[];
  instructions: string;
  examples: { input: string; output: Record<string, string | number | boolean | null> }[];
}

export interface ArtifactCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export type ArtifactResult =
  | {
      ok: true;
      spec: ExtractionSpec;
      canonical: string;
      digest: string;
      bytes: number;
      checks: ArtifactCheck[];
    }
  | { ok: false; reason: string; checks: ArtifactCheck[] };

class Invalid extends Error {}
function fail(message: string): never {
  throw new Invalid(message);
}

const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function obj(v: unknown, what: string): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail(`${what} must be an object`);
  return v as Record<string, unknown>;
}

function str(v: unknown, max: number, what: string, required = true): string {
  if (v === undefined && !required) return "";
  if (typeof v !== "string") return fail(`${what} must be text`);
  const s = v.trim();
  if (required && !s) fail(`${what} is empty`);
  if (s.length > max) fail(`${what} is longer than ${max} characters`);
  return s;
}

function int(v: unknown, min: number, max: number, what: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max)
    fail(`${what} must be a whole number from ${min} to ${max}`);
  return v as number;
}

/** Stable JSON: sorted keys, so the same content always has the same digest. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function parseSpec(raw: unknown): ExtractionSpec {
  let value = raw;
  if (typeof raw === "string") {
    if (raw.length > MAX_ARTIFACT_BYTES) fail("The output is larger than 64 KB");
    try {
      value = JSON.parse(raw);
    } catch {
      fail("The output is text, not a structured artifact; model text is not a build");
    }
  }
  const o = obj(value, "The artifact");
  if (o.kind !== "extraction_spec" || o.schema_version !== 1)
    fail(`Unsupported artifact: only ${ARTIFACT_SCHEMA} is accepted`);
  const input = obj(o.input, "input");
  if (input.kind !== "text" && input.kind !== "document_text")
    fail("input.kind must be text or document_text");
  if (!Array.isArray(o.fields) || o.fields.length < 1 || o.fields.length > 30)
    fail("fields must list 1 to 30 fields");
  const keys = new Set<string>();
  const fields = (o.fields as unknown[]).map((x, i) => {
    const fl = obj(x, `fields[${i}]`);
    if (typeof fl.key !== "string" || !KEY.test(fl.key))
      fail(`fields[${i}].key must be a short lowercase key`);
    const key = fl.key as string;
    if (keys.has(key)) fail(`Two fields share the key "${key}"`);
    keys.add(key);
    if (!SPEC_FIELD_TYPES.includes(fl.type as SpecFieldType))
      fail(`fields[${i}].type must be one of ${SPEC_FIELD_TYPES.join(", ")}`);
    return {
      key,
      label: str(fl.label, 80, `fields[${i}].label`),
      type: fl.type as SpecFieldType,
      required: fl.required === true,
      description: str(fl.description, 200, `fields[${i}].description`, false),
    };
  });
  const examples = o.examples === undefined ? [] : o.examples;
  if (!Array.isArray(examples) || examples.length > 5) fail("examples must list at most 5");
  return {
    kind: "extraction_spec",
    schema_version: 1,
    name: str(o.name, 80, "name"),
    input: {
      kind: input.kind as "text" | "document_text",
      max_chars: int(input.max_chars, 1, 100_000, "input.max_chars"),
    },
    fields,
    instructions: str(o.instructions, 4000, "instructions"),
    examples: (examples as unknown[]).map((x, i) => {
      const ex = obj(x, `examples[${i}]`);
      const out = obj(ex.output, `examples[${i}].output`);
      const output: Record<string, string | number | boolean | null> = {};
      for (const [k, v] of Object.entries(out)) {
        if (
          !(typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null)
        )
          fail(`examples[${i}].output.${k} must be a plain value`);
        output[k] = typeof v === "string" ? v.slice(0, 2000) : v;
      }
      return { input: str(ex.input, 4000, `examples[${i}].input`), output };
    }),
  };
}

function typeMatches(type: SpecFieldType, v: unknown) {
  if (v === null) return true;
  if (type === "number") return typeof v === "number" && Number.isFinite(v);
  if (type === "boolean") return typeof v === "boolean";
  if (type === "date") return typeof v === "string" && DATE.test(v);
  return typeof v === "string";
}

/** Parse, rebuild, hash and check an artifact against the revision it was built from. */
export function validateArtifact(raw: unknown, prototype: Prototype): ArtifactResult {
  let spec: ExtractionSpec;
  try {
    spec = parseSpec(raw);
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, reason: e.message, checks: [] };
    return { ok: false, reason: "The output could not be read", checks: [] };
  }
  const keys = new Set(spec.fields.map((x) => x.key));
  const exampleProblems: string[] = [];
  spec.examples.forEach((ex, i) => {
    for (const k of Object.keys(ex.output))
      if (!keys.has(k)) exampleProblems.push(`example ${i + 1} returns unknown field "${k}"`);
    for (const fl of spec.fields) {
      const v = ex.output[fl.key];
      if (v === undefined || v === null) {
        if (fl.required) exampleProblems.push(`example ${i + 1} is missing required "${fl.key}"`);
      } else if (!typeMatches(fl.type, v))
        exampleProblems.push(`example ${i + 1}: "${fl.key}" is not a ${fl.type}`);
    }
  });
  const promised = prototype.screens.flatMap((s) =>
    s.kind === "model" ? s.outputs.map((o) => o.key) : [],
  );
  const uncovered = promised.filter((k) => !keys.has(k));
  const checks: ArtifactCheck[] = [
    {
      id: "examples_match_fields",
      label: "Worked examples return only declared fields, with the declared types",
      passed: exampleProblems.length === 0,
      detail: exampleProblems.slice(0, 5).join("; "),
    },
    {
      id: "covers_prototype",
      label: "Returns every result field the prototype's model steps promise",
      passed: uncovered.length === 0,
      detail: uncovered.length ? `Missing: ${uncovered.join(", ")}` : "",
    },
    {
      id: "has_examples",
      label: "Includes at least one worked example",
      passed: spec.examples.length > 0,
      detail: spec.examples.length ? "" : "No examples to check the fields against",
    },
  ];
  const canonical = canonicalJson(spec);
  const bytes = Buffer.byteLength(canonical, "utf8");
  if (bytes > MAX_ARTIFACT_BYTES)
    return { ok: false, reason: "The artifact is larger than 64 KB", checks };
  const failed = checks.filter((c) => !c.passed);
  if (failed.length)
    return {
      ok: false,
      reason: `Deterministic checks failed: ${failed.map((c) => c.label.toLowerCase()).join("; ")}`,
      checks,
    };
  return {
    ok: true,
    spec,
    canonical,
    digest: createHash("sha256").update(canonical).digest("hex"),
    bytes,
    checks,
  };
}
