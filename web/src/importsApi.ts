// Bringing an existing product (job 004a): private import workspaces. Mirrors
// server/src/imports.ts. Nothing here is verified; detection is from a supplied manifest only.

import { ApiError } from "./api.ts";

export type Category =
  | "source_ownership"
  | "hosting"
  | "database"
  | "model_provider"
  | "authentication"
  | "payments"
  | "domain"
  | "customer_promises";

export type ProductKind =
  | "saas"
  | "api"
  | "ai_tool"
  | "agent"
  | "website"
  | "online_service"
  | "near_app"
  | "other";

export const PRODUCT_KIND_LABEL: Record<ProductKind, string> = {
  saas: "SaaS",
  api: "API",
  ai_tool: "AI tool",
  agent: "Agent",
  website: "Website",
  online_service: "Online service",
  near_app: "App on NEAR",
  other: "Something else",
};

export type ItemStatus = "verified" | "detected" | "declared" | "unknown";

export const STATUS_LABEL: Record<ItemStatus, string> = {
  verified: "Verified",
  detected: "Detected in manifest",
  declared: "You said",
  unknown: "Unknown",
};

export interface Detection {
  category: Category | "framework" | "tooling";
  label: string;
  packages: string[];
  dev_only: boolean;
}

export interface Facts {
  package: {
    name: string | null;
    version: string | null;
    description: string | null;
    license: string | null;
    private: boolean | null;
    module_type: string | null;
    node_engine: string | null;
    package_manager: string | null;
    scripts_count: number;
    repository_field: boolean;
  };
  dependencies: { name: string; group: string; ref_kind: string; ref: string | null }[];
  counts: { total: number; by_group: Record<string, number>; by_ref_kind: Record<string, number> };
  detections: Detection[];
  shape: { guess: "web_app" | "api_service" | "unknown"; basis: string };
  skipped: { invalid_names: number };
}

export interface ReportItem {
  category: Category;
  label: string;
  status: ItemStatus;
  evidence: { kind: "detected" | "declared" | "verified"; text: string }[];
  mechanism: string;
  risk: "high" | "medium";
  risk_text: string;
  who: string;
  next_step: string;
}

export interface Report {
  headline: string;
  counts: Record<ItemStatus, number>;
  next_action: { category: Category | null; text: string };
  items: ReportItem[];
  inspection_number: number | null;
  basis: string;
}

export interface Assertion {
  uses: boolean;
  note: string;
  by: string;
  at: string;
}

export interface ImportView {
  workspace: {
    id: string;
    name: string;
    description: string;
    product_kind: ProductKind;
    version: number;
    private: true;
    created_at: string;
    updated_at: string;
    business: { id: string; name: string; slug: string; published: boolean };
    owner_epoch: string;
  };
  scope: string;
  source: {
    latest: {
      number: number;
      inspector: string;
      inspector_version: string;
      input_digest: string;
      input_bytes: number;
      created_at: string;
      facts: Facts;
    } | null;
    history: {
      number: number;
      inspector: string;
      inspector_version: string;
      input_digest: string;
      input_bytes: number;
      dependency_count: number;
      by: string;
      created_at: string;
    }[];
  };
  inventory: { category: Category; label: string; assertion: Assertion | null; version: number }[];
  report: {
    live: Report;
    history: {
      number: number;
      inspection_number: number;
      counts: Record<ItemStatus, number>;
      created_at: string;
    }[];
  };
  created?: boolean;
}

export interface ImportSummary {
  id: string;
  business_id: string;
  business_name: string;
  name: string;
  product_kind: ProductKind;
  inspections: number;
  counts: Record<ItemStatus, number>;
  unresolved: number;
  updated_at: string;
}

export interface Manifest {
  file_name: string | null;
  content: string;
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

const at = (id: string) => `/api/imports/${encodeURIComponent(id)}`;

export const importsApi = {
  list: () => call<{ imports: ImportSummary[] }>("/api/imports"),
  forBusiness: (businessId: string) =>
    call<{ imports: ImportSummary[] }>(`/api/businesses/${encodeURIComponent(businessId)}/imports`),
  create: (fields: {
    idempotency_key: string;
    business_id?: string;
    new_business_name?: string;
    name: string;
    description: string;
    product_kind: ProductKind;
    manifest?: Manifest;
  }) => call<ImportView>("/api/imports", "POST", fields),
  get: (id: string) => call<ImportView>(at(id)),
  update: (
    id: string,
    fields: { version: number; name?: string; description?: string; product_kind?: ProductKind },
  ) => call<ImportView>(at(id), "PATCH", fields),
  inspect: (id: string, fields: Manifest & { idempotency_key: string }) =>
    call<ImportView>(`${at(id)}/inspections`, "POST", fields),
  report: (id: string, n: number) =>
    call<{ number: number; inspection_number: number; created_at: string; report: Report }>(
      `${at(id)}/reports/${n}`,
    ),
  declare: (
    id: string,
    category: Category,
    fields: { version: number; uses: boolean | null; note?: string },
  ) => call<ImportView>(`${at(id)}/dependencies/${category}`, "PUT", fields),
};

/** 64 KiB, the most the inspector reads. */
export const MAX_MANIFEST_BYTES = 64 * 1024;

export const byteLength = (s: string) => new TextEncoder().encode(s).length;
