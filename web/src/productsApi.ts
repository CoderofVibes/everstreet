// Product studio calls: digital product projects, their immutable revisions and the honest
// build availability. Mirrors server/src/products.ts.

import { ApiError } from "./api.ts";
import type { ProjectSource } from "./opportunitiesApi.ts";

export type Foundation = "ai_api" | "saas_workflow" | "agent_service" | "client_portal";
export type PriceModel = "per_use" | "monthly" | "one_time" | "free" | "undecided";
export type FieldType = "text" | "long_text" | "number" | "choice" | "file_name";

export interface Brief {
  name: string;
  audience: string;
  problem: string;
  promise: string;
  features: string[];
  price: { model: PriceModel; amount_cents: number | null; note: string };
}

export interface ProtoField {
  key: string;
  label: string;
  type: FieldType;
  options: string[];
}

export type Screen =
  | { id: string; kind: "form"; title: string; fields: ProtoField[]; submit_label: string }
  | { id: string; kind: "list"; title: string; source: string; stages: string[] }
  | { id: string; kind: "model"; title: string; source: string; outputs: ProtoField[] };

export interface Prototype {
  schema: 1;
  screens: Screen[];
}

export interface Revision {
  number: number;
  brief: Brief;
  prototype: Prototype;
  content_hash: string;
  note: string;
  restored_from: number | null;
  author: string;
  created_at: string;
}

export interface BuildAvailability {
  available: boolean;
  provider: string | null;
  reason: string;
}

export type CheckState = "pass" | "todo" | "unavailable" | "manual" | "fail";
export type KnownState = "ok" | "missing" | "manual" | "assumption" | "known" | "unknown";

export interface StudioView {
  project: {
    id: string;
    business_id: string;
    foundation: Foundation;
    idea: string;
    created_at: string;
    updated_at: string;
  };
  business: {
    id: string;
    name: string;
    slug: string;
    stage: string;
    published_at: string | null;
    /** Changes when the business changes hands; scopes unsaved browser drafts. */
    owner_epoch: string;
  };
  foundation: { id: Foundation; label: string; summary: string; features: string[] };
  head: Revision;
  revisions: Omit<Revision, "brief" | "prototype">[];
  starter: string[];
  checks: {
    deterministic: { id: string; label: string; state: CheckState; detail: string }[];
    passed: number;
    /** Phase B: what the records show for the saved revision's build. */
    build: { state: CheckState; detail: string };
    model_evaluations: { state: CheckState; detail: string };
    journey_tests: { state: CheckState; detail: string };
    manual: {
      key: "audience_walkthrough" | "manual_fallback";
      label: string;
      state: CheckState;
      /** Self-reported by the founder; never an automated pass. */
      recorded: { outcome: "done" | "issues"; note: string; by: string; at: string } | null;
    }[];
    unknowns: string[];
  };
  continuity: {
    promises: { label: string; state: KnownState; detail: string }[];
    dependencies: { label: string; state: KnownState; detail: string }[];
    transfer: { label: string; state: KnownState; detail: string }[];
  };
  build: BuildAvailability;
  created?: boolean;
  /** Job 005a: the publicly shared request that inspired the project, if any. */
  source?: ProjectSource | null;
}

export interface FoundationInfo {
  id: Foundation;
  label: string;
  summary: string;
  example: string;
  needs: string[];
  features: string[];
  /** Review #19: whether this kind can be built here (some compile without a model provider). */
  build?: { available: boolean };
}

export interface ProjectSummary {
  id: string;
  business_id: string;
  business_name: string;
  foundation: Foundation;
  foundation_label: string;
  name: string;
  promise: string;
  revision: number;
  updated_at: string;
}

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const productsApi = {
  foundations: () =>
    call<{ foundations: FoundationInfo[]; build: BuildAvailability }>("/api/product-foundations"),
  list: () => call<{ projects: ProjectSummary[] }>("/api/product-projects"),
  create: (fields: { idea: string; foundation: Foundation; name?: string; business_id?: string }) =>
    call<StudioView>("/api/product-projects", "POST", fields),
  get: (id: string) => call<StudioView>(`/api/product-projects/${encodeURIComponent(id)}`),
  revision: (id: string, n: number) =>
    call<Revision>(`/api/product-projects/${encodeURIComponent(id)}/revisions/${n}`),
  save: (
    id: string,
    fields: { base_revision: number; brief: Brief; prototype: Prototype; note?: string },
  ) =>
    call<StudioView>(`/api/product-projects/${encodeURIComponent(id)}/revisions`, "POST", fields),
  recordManualCheck: (
    id: string,
    input: { revision: number; check_key: string; outcome: "done" | "issues"; note: string },
  ) =>
    call<StudioView>(
      `/api/product-projects/${encodeURIComponent(id)}/manual-checks`,
      "POST",
      input,
    ),
  restore: (id: string, revision: number, base_revision: number) =>
    call<StudioView>(`/api/product-projects/${encodeURIComponent(id)}/restore`, "POST", {
      revision,
      base_revision,
    }),

  builds: (projectId: string, intent: "build" | "propose" | null = null) =>
    call<BuildList>(
      `/api/product-projects/${encodeURIComponent(projectId)}/builds${intent ? `?intent=${intent}` : ""}`,
    ),
  setBudget: (businessId: string, limit_cents: number) =>
    call<AiBudget>(`/api/businesses/${encodeURIComponent(businessId)}/build-budget`, "PUT", {
      limit_cents,
    }),
  /** The newest page of the work log, or with `before`, the page just older than it. */
  conversation: (projectId: string, before?: number) =>
    call<Conversation>(
      `/api/product-projects/${encodeURIComponent(projectId)}/conversation${before ? `?before=${before}` : ""}`,
    ),
  say: (projectId: string, text: string, idempotency_key: string) =>
    call<{ message: WorkLogMessage; created: boolean }>(
      `/api/product-projects/${encodeURIComponent(projectId)}/conversation`,
      "POST",
      { text, idempotency_key },
    ),
  proposal: (projectId: string, proposalId: string) =>
    call<ProposalDetail>(
      `/api/product-projects/${encodeURIComponent(projectId)}/proposals/${encodeURIComponent(proposalId)}`,
    ),
  applyProposal: (projectId: string, proposalId: string) =>
    call<StudioView & { applied: { revision: number; created: boolean; already: boolean } }>(
      `/api/product-projects/${encodeURIComponent(projectId)}/proposals/${encodeURIComponent(proposalId)}/apply`,
      "POST",
    ),
  startBuild: (
    projectId: string,
    /** A SaaS workflow's compile takes no budget (WORKFLOW_ENGINE.md); every other build does. */
    fields: { idempotency_key: string; revision: number; budget?: BuildBudget },
  ) =>
    call<{ job: BuildJob; created: boolean }>(
      `/api/product-projects/${encodeURIComponent(projectId)}/builds`,
      "POST",
      { intent: "build", ...fields },
    ),
  build: (jobId: string) => call<{ job: BuildJob }>(`/api/builds/${encodeURIComponent(jobId)}`),
  buildEvents: (jobId: string, after: number) =>
    call<{
      job_state: BuildState;
      events: BuildEventRow[];
      last_seq: number;
      next_after: number;
      has_more: boolean;
    }>(`/api/builds/${encodeURIComponent(jobId)}/events?after=${after}&limit=100`),
  cancelBuild: (jobId: string) =>
    call<{ job: BuildJob }>(`/api/builds/${encodeURIComponent(jobId)}/cancel`, "POST"),
  retryBuild: (jobId: string, idempotency_key: string, acknowledge_unknown_cost: boolean) =>
    call<{ job: BuildJob; created: boolean }>(
      `/api/builds/${encodeURIComponent(jobId)}/retry`,
      "POST",
      { idempotency_key, acknowledge_unknown_cost },
    ),
};

// ---------- build jobs (server/src/builds.ts) ----------

export type BuildState =
  | "queued"
  | "running"
  | "validating"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "needs_reconciliation";

export interface BuildBudget {
  max_input_tokens: number;
  max_output_tokens: number;
  max_seconds: number;
  max_cost_cents: number;
}

export interface BuildJob {
  id: string;
  revision: number;
  content_hash: string;
  provider: string;
  state: BuildState;
  attempt: number;
  budget: BuildBudget;
  reserved_cents: number;
  charged_cents: number;
  /** Exact computed cost in millionths of a cent (tokens × declared price). */
  charged_microcents: number;
  /** final: the provider's complete receipt; partial: some usage, not the full bill. */
  usage_state: "none" | "partial" | "final" | "unknown";
  provider_config: { id?: string; model?: string; version?: string } | null;
  input_tokens: number;
  output_tokens: number;
  dispatched: boolean;
  cancel_requested: boolean;
  failure: { code: string; detail: string } | null;
  retry_of: string | null;
  requested_by: string;
  artifact_digest: string | null;
  artifact: {
    kind: string;
    schema_version: number;
    digest: string;
    bytes: number;
    spec: {
      name?: string;
      fields?: { key: string; label: string; type: string }[];
      /** A compiled workflow (kind workflow_spec): its request form and its stages. */
      intake?: { fields: { key: string; label: string; type: string }[] };
      stages?: { key: string; label: string }[];
      /** A compiled analysis (kind analysis_spec): what customers submit. */
      source?: { key: string; label: string };
      context?: { key: string; label: string }[];
    };
    checks: { id: string; label: string; passed: boolean; detail: string }[];
  } | null;
  event_count: number;
  can_cancel: boolean;
  can_retry: boolean;
  retry_needs_ack: boolean;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface BuildEventRow {
  seq: number;
  attempt: number;
  type: string;
  data: Record<string, unknown>;
  at: string;
}

/** The business's AI budget. Exact use and rounded budget consumption are different numbers. */
export interface AiBudget {
  limit_cents: number | null;
  /** Worst case held for work not yet settled. */
  reserved_cents: number;
  /** What the budget is charged: each job rounded up to whole cents. */
  counted_cents: number;
  /** Exact computed use, in millionths of a cent, from reported tokens at declared prices. */
  used_microcents: number;
  unresolved_cents: number;
  available_cents: number | null;
  /** The most this business may set, from the operator's ceiling; null if none is set. */
  max_settable_cents: number | null;
  basis: string;
}

export interface WorkLogMessage {
  id: string;
  seq: number;
  role: "founder" | "assistant";
  text: string;
  author: string;
  created_at: string;
  proposal_id: string | null;
  job: BuildJob | null;
}

export interface ProposalSummary {
  id: string;
  status: "open" | "applied" | "superseded";
  summary: string;
  base_revision: number;
  applied_revision: number | null;
  created_at: string;
  provider: { id?: string; model?: string };
  current_owner: boolean;
}

export interface ProposalDetail extends ProposalSummary {
  brief: Brief;
  prototype: Prototype;
  assumptions: string[];
  questions: string[];
  head: { number: number; content_hash: string };
  base_is_head: boolean;
  note: string;
}

export interface Conversation {
  log: { label: string; note: string };
  messages: WorkLogMessage[];
  last_seq: number;
  oldest_returned: number | null;
  has_older: boolean;
  has_more: boolean;
  proposals: ProposalSummary[];
  pending: BuildJob | null;
  availability: BuildAvailability;
  budget: AiBudget;
  per_request: { reserve_cents: number; limits: BuildBudget } | null;
}

export interface BuildList {
  /** A SaaS workflow's build is a deterministic compile (no AI provider, nothing spent). */
  engine?: "workflow" | "analysis" | "model";
  availability: BuildAvailability;
  pricing: { inputCentsPerMillionTokens: number; outputCentsPerMillionTokens: number } | null;
  provider: { id: string; model: string; version: string } | null;
  budget: AiBudget;
  limits: {
    maxInputTokens: number;
    maxOutputTokens: number;
    minSeconds: number;
    maxSeconds: number;
  };
  jobs: BuildJob[];
}

export const BUILD_STATE_LABEL: Record<BuildState, string> = {
  queued: "Queued",
  running: "Running",
  validating: "Checking output",
  succeeded: "Built and checked",
  failed: "Failed",
  cancelled: "Cancelled",
  needs_reconciliation: "Outcome unknown",
};

export const isLive = (s: BuildState) => s === "queued" || s === "running" || s === "validating";

/** Exact computed cost, to four decimal places of a dollar (a hundredth of a cent). */
export const exactUsd = (microcents: number) => `$${(microcents / 100_000_000).toFixed(4)}`;

/** Whole cents as dollars, for budgets and reservations. */
export const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const PRICE_LABEL: Record<PriceModel, string> = {
  per_use: "Per use",
  monthly: "Monthly",
  one_time: "One-time",
  free: "Free",
  undecided: "Undecided",
};

export function priceText(price: Brief["price"]): string | null {
  if (price.model === "undecided") return null;
  if (price.model === "free") return "Free";
  if (price.amount_cents === null) return null;
  const amount = (price.amount_cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: price.amount_cents % 100 === 0 ? 0 : 2,
  });
  return `${amount} ${{ per_use: "per use", monthly: "per month", one_time: "once" }[price.model]}`;
}

export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
