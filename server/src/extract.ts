// Turning a model's answer into a founder's extraction result (docs/design/MANAGED_RUNTIME.md
// §4). Pure and deterministic: the model reports every value as text or null, and the platform
// alone decides whether that is a clean extraction. A partly valid answer is never presented as
// a successful one, missing values are never filled in, and numbers stay exact decimal strings.

import type { ExtractionSpec } from "./artifacts.ts";

/** Changes whenever these rules change; evaluations and releases are bound to it. */
// 2 (job 002c1): an overlong value makes the answer invalid instead of being shortened.
export const EXTRACT_VALIDATOR = "extract-validator/2";

/** What the model may say about the document as a whole. */
export const MODEL_STATUSES = [
  "extracted",
  "not_a_document",
  "multiple_documents",
  "ambiguous",
] as const;
export type ModelStatus = (typeof MODEL_STATUSES)[number];

export type Outcome = "extracted" | "incomplete" | "refused" | "invalid";

export interface FieldResult {
  key: string;
  label: string;
  type: ExtractionSpec["fields"][number]["type"];
  required: boolean;
  /** Text, an exact decimal string, `YYYY-MM-DD`, a boolean, or null when missing. */
  value: string | boolean | null;
  note: string;
}

export interface Extraction {
  outcome: Outcome;
  /** Present only for `extracted` and `incomplete`; never for a refused or invalid answer. */
  fields: FieldResult[];
  missing: string[];
  problems: string[];
  /** The model's reason when it declined (`refused`), in its words, bounded. */
  reason: string | null;
  /**
   * Disagreements the model noticed in the source (e.g. line items vs the stated total), kept
   * as evidence beside the stated values; never used to change them.
   */
  issues: string[];
  model_status: ModelStatus | null;
}

const MAX_TEXT = 2000;
const MAX_DIGITS = 15;
// biome-ignore lint/suspicious/noControlCharactersInRegex: removing control characters is the point
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;
const DECIMAL = /^-?(0|[1-9]\d*)(\.\d+)?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const clean = (s: string, max = MAX_TEXT) => s.replace(CONTROL, " ").trim().slice(0, max);
/**
 * Truncation policy (job 002c1): a field *value* is never shortened; one longer than
 * MAX_TEXT makes the answer invalid. Commentary (notes, issues) is bounded and visibly marked
 * with "…" when shortened, because it is never part of the result a customer receives.
 */
const bounded = (s: string, max: number) => {
  const c = s.replace(CONTROL, " ").trim();
  return c.length > max ? `${c.slice(0, max - 1)}…` : c;
};

/** An exact decimal, or the reason it isn't one this platform will keep. */
export function decimal(raw: string): { ok: true; value: string } | { ok: false; why: string } {
  const s = raw.trim();
  if (!DECIMAL.test(s)) return { ok: false, why: "is not a plain decimal number" };
  const digits = s
    .replace(/^-/, "")
    .replace(".", "")
    .replace(/^0+(?=\d)/, "");
  if (digits.length > MAX_DIGITS)
    return { ok: false, why: `has more than ${MAX_DIGITS} digits, so it can't be kept exactly` };
  return { ok: true, value: s };
}

/** Compares decimals by value without floating point: "12.50" equals "12.5". */
export function normalDecimal(s: string): string {
  let [int = "0", frac = ""] = s.replace(/^-/, "").split(".");
  int = int.replace(/^0+(?=\d)/, "");
  frac = frac.replace(/0+$/, "");
  const neg = s.startsWith("-") && (int !== "0" || frac !== "");
  return `${neg ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}

/** A real calendar date in YYYY-MM-DD, years 1900 to 2200. */
export function calendarDate(raw: string): boolean {
  const m = DATE.exec(raw.trim());
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2200) return false;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

const invalid = (problems: string[], status: ModelStatus | null = null): Extraction => ({
  outcome: "invalid",
  fields: [],
  missing: [],
  problems: problems.slice(0, 20),
  reason: null,
  issues: [],
  model_status: status,
});

/** Validates a model's answer against the artifact's declared fields. */
export function validateExtraction(spec: ExtractionSpec, raw: unknown): Extraction {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return invalid(["The answer was not a structured result"]);
  const o = raw as Record<string, unknown>;
  const status = MODEL_STATUSES.includes(o.status as ModelStatus)
    ? (o.status as ModelStatus)
    : null;
  if (!status) return invalid(["The answer had no recognised status"]);
  const issues = Array.isArray(o.issues)
    ? o.issues
        .filter((x): x is string => typeof x === "string")
        .slice(0, 10)
        .map((x) => bounded(x, 300))
    : [];
  if (status !== "extracted")
    return {
      outcome: "refused",
      fields: [],
      missing: [],
      problems: [],
      reason:
        issues.slice(0, 3).join("; ") ||
        {
          not_a_document: "The text doesn't contain the document this service reads",
          multiple_documents: "The text contains more than one document; send one at a time",
          ambiguous: "The document is ambiguous, so no value was guessed",
        }[status],
      issues,
      model_status: status,
    };
  if (!Array.isArray(o.fields)) return invalid(["The answer had no list of fields"], status);

  const declared = new Map(spec.fields.map((f) => [f.key, f]));
  const seen = new Map<string, { value: unknown; note: string }>();
  const problems: string[] = [];
  for (const item of o.fields) {
    const it = (item ?? {}) as Record<string, unknown>;
    const key = typeof it.key === "string" ? it.key : "";
    if (!declared.has(key)) {
      problems.push(`returned a field that wasn't asked for ("${clean(key, 40)}")`);
      continue;
    }
    if (seen.has(key)) {
      problems.push(`returned "${key}" more than once`);
      continue;
    }
    seen.set(key, {
      value: it.value,
      note: typeof it.note === "string" ? bounded(it.note, 300) : "",
    });
  }
  const fields: FieldResult[] = [];
  for (const f of spec.fields) {
    const got = seen.get(f.key);
    if (!got) {
      problems.push(`left out "${f.key}" entirely (it must be returned, as null if absent)`);
      continue;
    }
    const v = got.value;
    let value: FieldResult["value"] = null;
    if (v === null || (typeof v === "string" && v.trim() === "")) value = null;
    else if (typeof v !== "string") problems.push(`"${f.key}" was not given as text`);
    else if (f.type === "number") {
      const d = decimal(v);
      if (d.ok) value = d.value;
      else problems.push(`"${f.key}" ${d.why}`);
    } else if (f.type === "date") {
      if (calendarDate(v)) value = v.trim();
      else problems.push(`"${f.key}" is not a real date in YYYY-MM-DD form`);
    } else if (f.type === "boolean") {
      const b = v.trim().toLowerCase();
      if (b === "true" || b === "false") value = b === "true";
      else problems.push(`"${f.key}" is not true or false`);
    } else if (v.trim().length > MAX_TEXT)
      problems.push(
        `"${f.key}" is ${v.trim().length} characters, over the ${MAX_TEXT} this service returns; it was not shortened into a result`,
      );
    else value = clean(v);
    fields.push({
      key: f.key,
      label: f.label,
      type: f.type,
      required: f.required,
      value,
      note: got.note,
    });
  }
  // Any problem makes the whole answer invalid: its valid fields are not a clean result.
  if (problems.length) return invalid(problems, status);
  const missing = fields.filter((f) => f.required && f.value === null).map((f) => f.key);
  return {
    outcome: missing.length ? "incomplete" : "extracted",
    fields,
    missing,
    problems: [],
    reason: missing.length ? issues.slice(0, 3).join("; ") || null : null,
    issues,
    model_status: status,
  };
}
