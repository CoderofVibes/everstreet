// Product studio calls: digital product projects, their immutable revisions and the honest
// build availability. Mirrors server/src/products.ts.

import { ApiError } from "./api.ts";

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

export type CheckState = "pass" | "todo" | "unavailable" | "manual";
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
  };
  foundation: { id: Foundation; label: string; summary: string; features: string[] };
  head: Revision;
  revisions: Omit<Revision, "brief" | "prototype">[];
  starter: string[];
  checks: {
    deterministic: { id: string; label: string; state: CheckState; detail: string }[];
    passed: number;
    model_evaluations: { state: CheckState; detail: string };
    journey_tests: { state: CheckState; detail: string };
    manual: { label: string; state: CheckState }[];
    unknowns: string[];
  };
  continuity: {
    promises: { label: string; state: KnownState; detail: string }[];
    dependencies: { label: string; state: KnownState; detail: string }[];
    transfer: { label: string; state: KnownState; detail: string }[];
  };
  build: BuildAvailability;
  created?: boolean;
}

export interface FoundationInfo {
  id: Foundation;
  label: string;
  summary: string;
  example: string;
  needs: string[];
  features: string[];
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
  restore: (id: string, revision: number, base_revision: number) =>
    call<StudioView>(`/api/product-projects/${encodeURIComponent(id)}/restore`, "POST", {
      revision,
      base_revision,
    }),
};

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
