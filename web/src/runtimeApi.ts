// Calls for running a product (job 002c): trials, test cases, checks and releases. Owner-only
// on the server; every answer is fetched fresh (no-store).

import { ApiError } from "./api.ts";

export type Outcome = "extracted" | "incomplete" | "refused" | "invalid";

export interface FieldResult {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "boolean";
  required: boolean;
  value: string | boolean | null;
  note: string;
}

export interface Extraction {
  outcome: Outcome;
  fields: FieldResult[];
  missing: string[];
  problems: string[];
  reason: string | null;
  issues: string[];
  model_status: string | null;
}

export interface Invocation {
  id: string;
  purpose: "trial" | "evaluation" | "release";
  artifact_job: string;
  artifact_digest: string;
  release_id: string | null;
  model: string | null;
  validator: string;
  state: "running" | "completed" | "failed" | "cancelled" | "unknown";
  outcome: Outcome | null;
  fulfilled: boolean;
  result: Extraction | null;
  failure: { class: string; detail: string } | null;
  input_chars: number;
  input_note: string;
  usage_state: "none" | "final" | "partial" | "unknown";
  input_tokens: number;
  output_tokens: number;
  charged_microcents: number;
  charged_cents: number;
  reserved_cents: number;
  elapsed_ms: number | null;
  cancel_requested: boolean;
  created_at: string;
  finished_at: string | null;
}

export interface RuntimeBudget {
  limit_cents: number | null;
  reserved_cents: number;
  counted_cents: number;
  used_microcents: number;
  unresolved_cents: number;
  available_cents: number | null;
  per_request_cents: number;
  max_settable_cents: number | null;
  basis: string;
}

export interface RuntimeList {
  availability: { available: boolean; provider: string | null; reason: string };
  budget: RuntimeBudget;
  limits: { maxInputChars: number };
  invocations: Invocation[];
}

export interface EvalCase {
  id: string;
  name: string;
  input: string;
  why: string;
  expect: {
    outcomes: (Outcome | "not_sent")[];
    fields?: Record<string, string | null>;
    issues?: boolean;
  };
}

export interface Fixtures {
  version: number | null;
  source: string | null;
  cases: EvalCase[];
  versions: { version: number; source: string; created_at: string }[];
  /** The platform's required release checks; they always run and can't be edited here. */
  required: { policy: string; name: string; cases: EvalCase[]; note: string };
  note: string;
}

export interface CaseResult {
  id: string;
  name: string;
  required: boolean;
  raw: { state: string; outcome: string | null; invocation: string | null; failure: string | null };
  score: "pass" | "fail" | "error" | "not_applicable";
  fields: {
    key: string;
    expected: string | null;
    actual: string | boolean | null;
    match: boolean;
  }[];
  explanation: string;
}

export interface EvalRun {
  id: string;
  artifact_job: string;
  artifact_digest: string;
  fixture_version: number;
  policy: string;
  validator: string;
  provider_config: { model?: string };
  state: "running" | "complete" | "stopped";
  total: number;
  passed: number;
  failed: number;
  errors: number;
  not_applicable: number;
  invalid_answers: number;
  results: CaseResult[];
  current: boolean;
  release_ready: boolean;
  reasons: string[];
  used_microcents: number;
  held_cents: number;
  basis: string;
  created_at: string;
}

export interface Release {
  id: string;
  artifact_job: string;
  artifact_digest: string;
  eval_run: string;
  fixture_version: number;
  policy: string;
  state: "active" | "retired";
  rolled_back_from: string | null;
  activated_at: string;
  retired_at: string | null;
  checks_current: boolean;
  reasons: string[];
}

export interface Candidate {
  artifact_job: string;
  artifact_digest: string;
  revision: number;
  built_at: string;
  current_owner: boolean;
  latest_check: {
    id: string;
    passed: number;
    total: number;
    release_ready: boolean;
    reasons: string[];
  } | null;
  status: "candidate" | "checked" | "active";
}

export interface Releases {
  active: Release | null;
  releases: Release[];
  candidates: Candidate[];
  note: string;
}

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const runtimeApi = {
  list: (projectId: string) => call<RuntimeList>(`/api/product-projects/${projectId}/runtime`),
  invoke: (
    projectId: string,
    body: { idempotency_key: string; text: string; artifact_job?: string; release?: boolean },
  ) =>
    call<{ invocation: Invocation }>(
      `/api/product-projects/${projectId}/runtime/invocations`,
      "POST",
      body,
    ),
  cancel: (id: string) =>
    call<{ invocation: Invocation }>(`/api/runtime/invocations/${id}/cancel`, "POST"),
  setBudget: (businessId: string, limit_cents: number) =>
    call<RuntimeBudget>(`/api/businesses/${businessId}/runtime-budget`, "PUT", { limit_cents }),
  fixtures: (projectId: string) => call<Fixtures>(`/api/product-projects/${projectId}/test-cases`),
  saveFixtures: (projectId: string, body: { cases: EvalCase[]; base_version: number | null }) =>
    call<Fixtures>(`/api/product-projects/${projectId}/test-cases`, "POST", body),
  runs: (projectId: string) =>
    call<{ runs: EvalRun[] }>(`/api/product-projects/${projectId}/evaluations`),
  check: (projectId: string, artifact_job: string) =>
    call<{ run: EvalRun }>(`/api/product-projects/${projectId}/evaluations`, "POST", {
      artifact_job,
    }),
  run: (id: string) => call<{ run: EvalRun }>(`/api/evaluations/${id}`),
  releases: (projectId: string) => call<Releases>(`/api/product-projects/${projectId}/releases`),
  release: (projectId: string, artifact_job: string, eval_run: string) =>
    call<Releases>(`/api/product-projects/${projectId}/releases`, "POST", {
      artifact_job,
      eval_run,
    }),
  rollback: (projectId: string, releaseId: string) =>
    call<Releases>(`/api/product-projects/${projectId}/releases/${releaseId}/rollback`, "POST"),
};
