// Job 005a: the opportunities board and the request-to-project bridge.

import { ApiError, type Constraints } from "./api.ts";
import type { Foundation, StudioView } from "./productsApi.ts";

export type DigitalKind =
  | "near_app"
  | "agent"
  | "ai_tool"
  | "api"
  | "saas"
  | "website"
  | "online_service"
  | "other";

export interface Opportunity {
  id: string;
  text: string;
  constraints: Constraints;
  allow_replies: boolean;
  expires_at: string;
  created_at: string;
  responses: number;
  classification: {
    kind: DigitalKind;
    label: string;
    basis: string[];
    suggested_foundation: Foundation;
    note: string;
  };
  matches: { business_id: string; name: string; published: boolean; words: string[] }[];
}

export interface ProjectSource {
  kind: "public_request";
  label: string;
  captured_at: string;
  snapshot: {
    text: string;
    constraints: Constraints;
    posted_at: string;
    open_until: string;
    replies_allowed: boolean;
  };
  state: "open" | "closed" | "expired" | "unavailable";
  need_id: string | null;
  can_reply: boolean;
  notes: string[];
}

export interface CreateFromRequest {
  idempotency_key: string;
  idea: string;
  foundation: Foundation;
  name: string;
  business_id: string | null;
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

export const opportunitiesApi = {
  list: () => call<{ opportunities: Opportunity[]; note: string }>("/api/opportunities"),
  get: (id: string) => call<Opportunity>(`/api/opportunities/${encodeURIComponent(id)}`),
  createProject: (id: string, body: CreateFromRequest) =>
    call<{ created: boolean; view: StudioView }>(
      `/api/opportunities/${encodeURIComponent(id)}/projects`,
      "POST",
      body,
    ),
};
