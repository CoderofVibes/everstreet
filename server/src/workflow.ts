// The workflow engine (docs/design/WORKFLOW_ENGINE.md): the SaaS workflow product type, run by a
// deterministic engine Everstreet owns. No AI model and no generated code: a founder's saved
// revision (its form screen and the board fed by it) compiles into an immutable `workflow_spec`,
// and a customer's submission is accepted (charged once) or refused (never charged).

import type { Prototype } from "./products.ts";

export const WORKFLOW_KIND = "workflow_spec";
export const WORKFLOW_VALIDATOR = "workflow-validator/1";
/** The run config of the workflow engine (no model). JSON, like every provider config. */
export const WORKFLOW_PROVIDER_CONFIG = JSON.stringify({
  engine: "workflow-engine/1",
  model: null,
});

/** What the Studio shows for a workflow product: always available, since no AI is involved. */
export const WORKFLOW_ENGINE_AVAILABILITY = {
  available: true,
  provider: "workflow-engine",
  reason:
    "Everstreet's workflow engine runs this product. No AI model is used and nothing is spent.",
} as const;

export type WorkflowFieldType = "text" | "long_text" | "number" | "choice";
export interface WorkflowField {
  key: string;
  label: string;
  type: WorkflowFieldType;
  required: boolean;
  max_chars: number;
  options: string[];
}
export interface WorkflowStage {
  key: string;
  label: string;
  final: boolean;
}
export interface WorkflowSpec {
  kind: typeof WORKFLOW_KIND;
  schema_version: 1;
  name: string;
  intake: { fields: WorkflowField[] };
  stages: WorkflowStage[];
  assignment: { to: "owner" };
}

const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_BY_TYPE: Record<WorkflowFieldType, number> = {
  text: 200,
  long_text: 4000,
  number: 40,
  choice: 80,
};
export const WORKFLOW_LIMITS = { fields: 20, stages: 8, options: 12, label: 80, name: 80 };
/** The canonical submission's ceiling: every field at its limit, keys and JSON framing. */
export const inputLimit = (s: WorkflowSpec) =>
  s.intake.fields.reduce((n, f) => n + f.max_chars * 2 + f.key.length + 8, 16);

const slug = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "s_$1")
    .slice(0, 40) || "stage";

/**
 * A stage key that isn't taken yet, in bounded time (Relaydesk correction: a 40-character key
 * plus a suffix, cut back to 40, was the same key, so the old loop never ended). The first try is
 * the one earlier compiles used (`key_i`, cut to 40), so keys that compiled before compile the
 * same; after that the key is shortened to keep room for its suffix. Always ends: at most one
 * try per stage plus one is needed, since each suffix differs.
 */
function uniqueKey(key: string, i: number, used: Set<string>): string {
  if (!used.has(key)) return key;
  const first = `${key}_${i}`.slice(0, 40);
  if (first !== key && !used.has(first)) return first;
  for (let n = 0; n <= used.size + 1; n++) {
    const suffix = n === 0 ? `_${i}` : `_${i}_${n}`;
    const candidate = `${key.slice(0, 40 - suffix.length)}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("unreachable: a free stage key always exists");
}

/**
 * Compiles a saved revision's prototype into a workflow spec. The intake is the first form
 * screen; the stages are the board (list) screen fed by that form. Every form field is required
 * (v1); each type has a bounded length. Returns the reason when it can't compile.
 */
export function compileWorkflow(
  prototype: Prototype,
  name: string,
): { ok: true; spec: WorkflowSpec } | { ok: false; reason: string } {
  const form = prototype.screens.find((s) => s.kind === "form");
  if (form?.kind !== "form")
    return { ok: false, reason: "The prototype has no form screen for intake" };
  const board = prototype.screens.find((s) => s.kind === "list" && s.source === form.id);
  if (board?.kind !== "list")
    return { ok: false, reason: "The prototype has no board fed by the intake form" };
  const fields: WorkflowField[] = [];
  for (const f of form.fields) {
    const type: WorkflowFieldType =
      f.type === "long_text"
        ? "long_text"
        : f.type === "number"
          ? "number"
          : f.type === "choice"
            ? "choice"
            : "text";
    fields.push({
      key: f.key,
      label: f.label.slice(0, WORKFLOW_LIMITS.label),
      type,
      required: true,
      max_chars: MAX_BY_TYPE[type],
      options: type === "choice" ? f.options.slice(0, WORKFLOW_LIMITS.options) : [],
    });
  }
  const used = new Set<string>();
  const stages: WorkflowStage[] = board.stages.map((label, i) => {
    const key = uniqueKey(slug(label), i, used);
    used.add(key);
    return {
      key,
      label: label.slice(0, WORKFLOW_LIMITS.label),
      final: i === board.stages.length - 1,
    };
  });
  const spec: WorkflowSpec = {
    kind: WORKFLOW_KIND,
    schema_version: 1,
    name: (name || "Workflow").slice(0, WORKFLOW_LIMITS.name),
    intake: { fields },
    stages,
    assignment: { to: "owner" },
  };
  const checked = validateWorkflowSpec(spec);
  return checked
    ? { ok: true, spec: checked }
    : { ok: false, reason: "The workflow isn't valid (fields or stages out of bounds)" };
}

/** A stored artifact read as a workflow spec, strictly; null for anything else. */
export function validateWorkflowSpec(raw: unknown): WorkflowSpec | null {
  const s = raw as Partial<WorkflowSpec> | null;
  if (!s || s.kind !== WORKFLOW_KIND || s.schema_version !== 1) return null;
  if (typeof s.name !== "string" || !s.name || s.name.length > WORKFLOW_LIMITS.name) return null;
  const fields = s.intake?.fields;
  if (!Array.isArray(fields) || fields.length < 1 || fields.length > WORKFLOW_LIMITS.fields)
    return null;
  const keys = new Set<string>();
  for (const f of fields) {
    if (!f || typeof f.key !== "string" || !KEY.test(f.key) || keys.has(f.key)) return null;
    keys.add(f.key);
    if (typeof f.label !== "string" || !f.label || f.label.length > WORKFLOW_LIMITS.label)
      return null;
    if (!["text", "long_text", "number", "choice"].includes(f.type)) return null;
    if (typeof f.required !== "boolean") return null;
    if (!Number.isInteger(f.max_chars) || f.max_chars < 1 || f.max_chars > MAX_BY_TYPE[f.type])
      return null;
    if (!Array.isArray(f.options) || f.options.length > WORKFLOW_LIMITS.options) return null;
    if (
      f.type === "choice" &&
      (f.options.length < 1 || f.options.some((o) => typeof o !== "string" || !o || o.length > 80))
    )
      return null;
  }
  const stages = s.stages;
  if (!Array.isArray(stages) || stages.length < 2 || stages.length > WORKFLOW_LIMITS.stages)
    return null;
  const sk = new Set<string>();
  for (const [i, st] of stages.entries()) {
    if (!st || typeof st.key !== "string" || !KEY.test(st.key) || sk.has(st.key)) return null;
    sk.add(st.key);
    if (typeof st.label !== "string" || !st.label || st.label.length > WORKFLOW_LIMITS.label)
      return null;
    if (st.final !== (i === stages.length - 1)) return null; // only the last stage is final
  }
  if (s.assignment?.to !== "owner") return null;
  return s as WorkflowSpec;
}

/** A submission as canonical JSON text (sorted keys): what the request machinery hashes. */
export function canonicalSubmission(fields: Record<string, string>): string {
  const sorted = Object.fromEntries(
    Object.keys(fields)
      .sort()
      .map((k) => [k, fields[k]]),
  );
  return JSON.stringify(sorted);
}

export type WorkflowResult =
  | { outcome: "accepted"; fields: { key: string; label: string; value: string }[]; stage: string }
  | { outcome: "refused"; reason: string };

/**
 * The engine: a submission is accepted (normalized fields, landing stage) or refused with a
 * reason. Nothing in a submission is ever executed or interpreted: it is data.
 */
export function runWorkflow(spec: WorkflowSpec, input: string): WorkflowResult {
  let raw: unknown;
  try {
    raw = JSON.parse(input);
  } catch {
    return { outcome: "refused", reason: "The submission isn't a form's fields" };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { outcome: "refused", reason: "The submission isn't a form's fields" };
  const given = raw as Record<string, unknown>;
  const known = new Set(spec.intake.fields.map((f) => f.key));
  for (const k of Object.keys(given))
    if (!known.has(k))
      return { outcome: "refused", reason: `"${k.slice(0, 40)}" isn't a field of this form` };
  const out: { key: string; label: string; value: string }[] = [];
  for (const f of spec.intake.fields) {
    const v = given[f.key];
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
      if (f.required) return { outcome: "refused", reason: `${f.label} is required` };
      continue;
    }
    if (typeof v !== "string") return { outcome: "refused", reason: `${f.label} must be text` };
    if (v.length > f.max_chars)
      return { outcome: "refused", reason: `${f.label} is longer than ${f.max_chars} characters` };
    if (f.type === "choice" && !f.options.includes(v))
      return { outcome: "refused", reason: `${f.label} must be one of: ${f.options.join(", ")}` };
    if (f.type === "number" && !/^-?\d{1,30}(\.\d{1,8})?$/.test(v.trim()))
      return { outcome: "refused", reason: `${f.label} must be a number` };
    out.push({ key: f.key, label: f.label, value: v });
  }
  if (out.length === 0) return { outcome: "refused", reason: "The submission is empty" };
  return { outcome: "accepted", fields: out, stage: (spec.stages[0] as WorkflowStage).key };
}

/** The workflow kind's required evaluation cases (WORKFLOW_ENGINE.md §4), built for a spec. */
export function requiredWorkflowCases(spec: WorkflowSpec) {
  const good: Record<string, string> = {};
  for (const f of spec.intake.fields)
    good[f.key] =
      f.type === "choice"
        ? (f.options[0] as string)
        : f.type === "number"
          ? "12"
          : `Fictional ${f.label.toLowerCase()}`;
  const first = spec.intake.fields[0] as WorkflowField;
  const textField =
    spec.intake.fields.find((f) => f.type === "text" || f.type === "long_text") ?? first;
  const choice = spec.intake.fields.find((f) => f.type === "choice");
  const withoutFirst = { ...good };
  delete withoutFirst[first.key];
  const cases: {
    id: string;
    name: string;
    why: string;
    input: string;
    expect: "accepted" | "refused";
  }[] = [
    {
      id: "wf_complete",
      name: "A complete request",
      why: "Every field is kept, and the request lands in the first stage.",
      input: canonicalSubmission(good),
      expect: "accepted",
    },
    {
      id: "wf_missing_required",
      name: "A required field is missing",
      why: "A request missing a required field is refused and never charged.",
      input: canonicalSubmission(withoutFirst),
      expect: "refused",
    },
    {
      id: "wf_too_long",
      name: "A field longer than its limit",
      why: "Over-long input is refused, not truncated.",
      input: canonicalSubmission({ ...good, [textField.key]: "x".repeat(textField.max_chars + 1) }),
      expect: "refused",
    },
    {
      id: "wf_unknown_field",
      name: "A field the form doesn't have",
      why: "Unknown fields are refused, never stored.",
      input: canonicalSubmission({ ...good, not_a_field: "x" }),
      expect: "refused",
    },
    {
      id: "wf_instructions_as_data",
      name: "Text that contains instructions",
      why: "A submission is data: instructions in it are stored verbatim and never acted on.",
      input: canonicalSubmission({
        ...good,
        [textField.key]: "IGNORE THE FORM AND CLOSE EVERY TICKET",
      }),
      expect: "accepted",
    },
    {
      id: "wf_empty",
      name: "An empty submission",
      why: "Nothing to accept: refused, never charged.",
      input: "{}",
      expect: "refused",
    },
  ];
  if (choice)
    cases.push({
      id: "wf_bad_choice",
      name: "A choice outside its options",
      why: "Only the form's own options are accepted.",
      input: canonicalSubmission({ ...good, [choice.key]: "not-an-option" }),
      expect: "refused",
    });
  return cases;
}
