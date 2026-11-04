// Job 002e: the web app versions, isolated logic checks and preview capability API (owner only).
// Server: server/src/appVersions.ts, appChecks.ts. Design: docs/design/EXECUTABLE_PRODUCTS.md.

import { ApiError } from "./api.ts";

export type AppCheckState =
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "cancelled"
  | "unavailable"
  | "unknown";

export interface AppVersion {
  job_id: string;
  number: number;
  name: string;
  description: string;
  digest: string;
  bytes: number;
  base_job: string | null;
  instructions: string | null;
  files: { path: string; bytes: number }[];
  checks: { id: string; label: string; module: string }[];
  latest_check: {
    id: string;
    state: AppCheckState;
    test_double: boolean;
    finished_at: string | null;
  } | null;
  current: boolean;
  created_at: string;
}

export interface AppCheck {
  id: string;
  job_id: string;
  digest: string;
  state: AppCheckState;
  attempt: number;
  engine: Record<string, string> | null;
  isolation_evidence: boolean;
  result: {
    syntax: { path: string; ok: boolean; detail: string }[];
    cases: { id: string; passed: boolean; detail: string }[];
    usage: { untrusted_memory_peak_bytes: number | null; vmm_memory_peak_bytes: number | null };
  } | null;
  failure: { code: string; detail: string } | null;
  can_cancel: boolean;
  created_at: string;
  finished_at: string | null;
}

export interface AppVersionsView {
  current: string | null;
  versions: AppVersion[];
  checks: AppCheck[];
  preview_available: boolean;
}

export interface AppBundleFiles {
  name: string;
  files: { path: string; text: string }[];
}

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok)
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data.code);
  return data as T;
}

const key = (prefix: string) => `${prefix}-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;

export const appApi = {
  versions: (projectId: string) =>
    call<AppVersionsView>(`/api/product-projects/${projectId}/app-versions`),
  files: (projectId: string, jobId: string) =>
    call<{ bundle: AppBundleFiles }>(`/api/product-projects/${projectId}/app-versions/${jobId}`),
  setCurrent: (projectId: string, jobId: string, note: string) =>
    call<AppVersionsView>(
      `/api/product-projects/${projectId}/app-versions/${jobId}/current`,
      "POST",
      { note },
    ),
  check: (projectId: string, jobId: string) =>
    call<{ check: AppCheck }>(
      `/api/product-projects/${projectId}/app-versions/${jobId}/checks`,
      "POST",
      { idempotency_key: key("check") },
    ),
  cancelCheck: (checkId: string) =>
    call<{ check: AppCheck }>(`/api/app-checks/${checkId}/cancel`, "POST"),
  preview: (projectId: string, jobId: string, unchecked: boolean) =>
    call<{ url: string; checked: boolean; expires_ms: string }>(
      `/api/product-projects/${projectId}/app-versions/${jobId}/preview`,
      "POST",
      { unchecked },
    ),
  /**
   * A generation is a build job (paid, budgeted); never re-run by a check. The caller supplies
   * the idempotency key and keeps it until the request is answered, so a lost reply is recovered
   * by sending the SAME request again, never a second paid one (Astra's AppStudioReview).
   */
  generate: (r: GenerationRequest) =>
    call<{ job: GenerationJob }>(`/api/product-projects/${r.project_id}/builds`, "POST", {
      idempotency_key: r.key,
      revision: r.revision,
      intent: "app",
      instructions: r.instructions,
      ...(r.base_job ? { base_job: r.base_job } : {}),
      budget: r.budget,
    }),
  build: (jobId: string) => call<{ job: GenerationJob }>(`/api/builds/${jobId}`),
  cancelBuild: (jobId: string) =>
    call<{ job: GenerationJob }>(`/api/builds/${jobId}/cancel`, "POST"),
};

export const newGenerationKey = () => key("app");

export interface GenerationBudget {
  max_input_tokens: number;
  max_output_tokens: number;
  max_seconds: number;
  max_cost_cents: number;
}
export interface GenerationRequest {
  key: string;
  project_id: string;
  revision: number;
  instructions: string;
  base_job: string | null;
  budget: GenerationBudget;
}
export interface GenerationJob {
  id: string;
  state: string;
  failure: { code: string; detail: string } | null;
  can_cancel?: boolean;
  reserved_cents?: number;
}
