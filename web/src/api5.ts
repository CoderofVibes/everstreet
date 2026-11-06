// Phase 5 calls: buying profiles, the acquisition index, access requests, evidence rooms and
// the seller's listing.

import type { FinMonth } from "./finance.ts";

export interface Fig {
  status: "shown" | "not_shared" | "unknown";
  text: string;
  source?: string;
}

export interface Candidate {
  listing_id: string;
  mode: "named" | "anonymous" | "private";
  yours: boolean;
  title: string;
  tagline: string | null;
  family: string;
  family_label: string;
  stage: string;
  remote: boolean | null;
  openness: string;
  openness_label: string;
  reason: string | null;
  transition: string | null;
  founder: string | null;
  slug: string | null;
  updated_at: string;
  asking: Fig;
  revenue: Fig;
  profit: Fig;
  value: Fig & { basis?: string; low_cents?: number; high_cents?: number };
  founder_hours: Fig;
  history: Fig & { months?: number; verified?: boolean };
}

export interface Result extends Candidate {
  reasons: string[];
  unknowns: string[];
  shortlisted: boolean;
  is_new: boolean;
}

export interface Criteria {
  families?: string[];
  remote?: boolean;
  max_asking_cents?: number;
  require_asking?: boolean;
  value_min_cents?: number;
  value_max_cents?: number;
  value_mode?: "overlap" | "within";
  include_unestimated?: boolean;
  min_months?: number;
  verified_only?: boolean;
  max_founder_hours?: number;
  openness?: string[];
}

export interface SearchResult {
  criteria: Criteria;
  results: Result[];
  hidden: { text: string; relax: Partial<Criteria> }[];
  ruled_out: { filter: string; count: number }[];
  total_listed: number;
}

export interface Meta {
  buyer_kinds: Record<string, string>;
  intents: Record<string, string>;
  roles: Record<string, string>;
  modes: Record<string, string>;
  openness: Record<string, string>;
  disclose: Record<string, string>;
  categories: Record<string, string>;
}

export interface BuyerProfile {
  id: string;
  name: string;
  kind_label: string;
  intent_label: string;
  about: string;
  interests: string;
  time_available: string;
  skills: string;
  budget_basis: string;
  members: { name: string; role: string; lead: boolean }[];
}

export interface AccessRequest {
  id: string;
  listing_id: string;
  title: string;
  buyer: BuyerProfile;
  requested_by: string;
  categories: string[];
  granted: string[] | null;
  purpose: string;
  days: number;
  status: "pending" | "granted" | "declined" | "revoked" | "withdrawn" | "expired";
  expires_at: string | null;
  decided_at: string | null;
  decision_note: string;
  revoked_at: string | null;
  created_at: string;
  opened: { count: number; last_at: string | null };
}

export interface Workspace {
  buyer: {
    id: string;
    name: string;
    kind: string;
    intent: string;
    kind_label: string;
    intent_label: string;
    about: string;
    interests: string;
    time_available: string;
    skills: string;
    budget_basis: string;
  };
  role: "research" | "evidence" | "approve";
  members: { person_id: string; name: string; role: string; lead: boolean }[];
  /** Plan step 6: who signs for the team (their linked NEAR account), or nobody yet. */
  representative?: { person_id: string; name: string; account: string; set_at: string } | null;
  /** Members' recorded positions per candidate: a discussion record, not a vote. */
  positions?: Record<string, { name: string; position: string; note: string; at: string }[]>;
  team_history?: { at: string; kind: string; detail: string; name: string | null }[];
  team_is_not?: string;
  mandates: {
    id: string;
    name: string;
    text: string;
    criteria: Criteria;
    last_seen_at: string | null;
  }[];
  shortlist: Candidate[];
  requests: AccessRequest[];
}

export interface CandidateDetail {
  candidate: Candidate;
  offer: Record<string, string | number | null>;
  calculation: { explanation: string[]; label: string; missing: string[] } | null;
  operate: { founder_hours: Fig; helpers: number; payments_on_near: boolean; family: string };
  requests: AccessRequest[];
  categories: Record<string, string>;
}

export interface ManifestItem {
  name: string;
  status: "Ready" | "Pending" | "Blocked" | "Excluded";
  detail: string;
  enforced: string;
}

/** The owner's month figures and states, without cost lines (job 003f). */
export type RoomMonth = FinMonth;

export interface BuyerScenario {
  id: string;
  name: string;
  overrides: Record<string, number>;
  low_cents: number | null;
  high_cents: number | null;
  by: string;
  created_at: string;
}

/** Job 003u1: a count shown, or withheld (which says nothing about its size). */
export type Shown = number | "withheld";
export interface PerformanceEvidence {
  as_of: string;
  state: "not_started" | "recorded";
  /** Breakdowns withheld because some group of uses would have been 1 or 2. */
  withheld: boolean;
  period: { from: number; to: number; months: number; buckets: string };
  usage: { requested: Shown; split: { key: string; label: string; value: Shown }[] };
  months: {
    yyyymm: number;
    label: string;
    so_far: boolean;
    requested: Shown;
    customers: { calls: Shown; microcents: string };
    founder: { calls: number; microcents: string; unknown_cost_calls: number };
  }[];
  execution: {
    ran: Shown;
    usable_result: Shown;
    not_usable: Shown;
    undecided_or_unknown: Shown;
  };
  current: { total: Shown; groups: { key: string; label: string; value: Shown }[] };
  cost: {
    customers: {
      calls: Shown;
      microcents: string;
      unknown_cost_calls: Shown;
      unknown_held_cents: Shown;
    };
    founder: {
      calls: number;
      microcents: string;
      unknown_cost_calls: number;
      unknown_held_cents: number;
    };
  };
  basis: { usage: string; execution: string; cost: string; current: string; not: string };
  suppression: string;
  limits: string[];
}

export interface Room {
  request: AccessRequest;
  /** Job 003u: only with the digital performance scope, granted under wording 4 or later. */
  digital_performance?: PerformanceEvidence;
  business: { name: string; slug: string; family_label: string; tagline: string };
  asking: { cents: number; source: string } | null;
  chain_error: string | null;
  financials?: {
    months: RoomMonth[];
    /** The units basis: test dollars against US-dollar costs, a demo figure. */
    basis: string;
    /** Whether this grant's wording covers money in and out (scope 3); see cash_note. */
    cash_included: boolean;
    cash_note?: string;
    estimate: {
      low_cents: number | null;
      high_cents: number | null;
      label: string;
      explanation: string[];
      missing: string[];
      sources: { input: string; value: string; source: string }[];
    };
    reproduce: {
      months: {
        label: string;
        revenue_cents: number;
        direct_cents: number;
        overhead_cents: number;
      }[];
      /** The estimate's exact totals, for an identical check. */
      revenue_cents: number;
      costs_cents: number;
      labor_month_cents: number;
      annualize_by: number;
      multiple_low: number;
      multiple_high: number;
      stage: string;
    };
    base: {
      founder_hours_week: number;
      hourly_rate_cents: number;
      multiple_low: number;
      multiple_high: number;
    };
    scenarios: BuyerScenario[];
    /** The contract's balances, shown with financials access (job 003p). */
    balances: { customer_money: string; available: string; source: string } | null;
  };
  /** Set when the grant was made under the earlier wording of operations. */
  scope_note?: string;
  costs?: {
    label: string;
    lines: { kind: string; label: string; cents: number; source: string }[];
  }[];
  /** Job 003u2: counts are all shown or all "Withheld" together (whole-summary rule). */
  customers?: {
    rows: { label: string; value: string }[];
    withheld?: boolean;
    source: string;
    note: string;
    limits?: string[];
  };
  operations?: {
    founder_hours: { text: string; source: string };
    helpers: { text: string; source: string };
    contract: { account_id: string; url: string; created_url: string } | null;
    treasury: { customer_money: string; available: string; source: string } | null;
    promises: string[];
    manifest: {
      note: string;
      receive: ManifestItem[];
      stays: ManifestItem[];
      separate: ManifestItem[];
      excluded: ManifestItem[];
    };
  };
}

export interface SellerListing {
  listing: {
    mode: string;
    openness: string;
    asking_cents: number | null;
    reason: string;
    transition: string;
    disclose: string[];
    /** 1: saved under the earlier wording; see disclose_note. */
    disclose_version: number;
    disclose_note: string | null;
    listed_at: string | null;
    invites: string[];
  };
  preview: { named: Candidate; anonymous: Candidate };
  anonymous_warnings: string[];
  share_numbers: boolean;
  buyers: { id: string; name: string; kind_label: string }[];
  requests: AccessRequest[];
}

/** A refusal or failure from the server, with its status (0 when no answer arrived). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    signal,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

type Overrides = Record<string, number>;

export const api5 = {
  meta: () => call<Meta>("/api/acquire/meta"),
  interpret: (text: string) =>
    call<{ criteria: Criteria }>("/api/acquire/interpret", "POST", { text }),
  search: (criteria: Criteria, buyer_id?: string, mandate_id?: string, sort?: string) =>
    call<SearchResult>("/api/acquire/search", "POST", { criteria, buyer_id, mandate_id, sort }),
  candidate: (id: string, buyerId?: string) =>
    call<CandidateDetail>(
      `/api/acquire/listings/${id}${buyerId ? `?buyer_id=${encodeURIComponent(buyerId)}` : ""}`,
    ),
  buyers: () =>
    call<{
      buyers: {
        id: string;
        name: string;
        kind_label: string;
        intent_label: string;
        role: string;
      }[];
    }>("/api/acquire/buyers"),
  createBuyer: (b: Record<string, string>) => call<Workspace>("/api/acquire/buyers", "POST", b),
  workspace: (id: string) => call<Workspace>(`/api/acquire/buyers/${id}`),
  updateBuyer: (id: string, b: Record<string, string>) =>
    call<Workspace>(`/api/acquire/buyers/${id}`, "PATCH", b),
  addMember: (id: string, person_id: string, role: string) =>
    call<Workspace>(`/api/acquire/buyers/${id}/members`, "POST", { person_id, role }),
  setRepresentative: (id: string, person_id: string) =>
    call<Workspace>(`/api/acquire/buyers/${id}/representative`, "POST", { person_id }),
  recordPosition: (id: string, listing: string, position: string, note: string) =>
    call<Workspace>(`/api/acquire/buyers/${id}/positions/${listing}`, "POST", { position, note }),
  removeMember: (id: string, personId: string) =>
    call<Workspace>(`/api/acquire/buyers/${id}/members/${personId}`, "DELETE"),
  saveMandate: (id: string, m: { id?: string; name: string; text: string; criteria: Criteria }) =>
    call<Workspace>(`/api/acquire/buyers/${id}/mandates`, "POST", m),
  deleteMandate: (id: string, mandateId: string) =>
    call<Workspace>(`/api/acquire/buyers/${id}/mandates/${mandateId}`, "DELETE"),
  shortlist: (id: string, listing_id: string, on: boolean) =>
    call<Workspace>(`/api/acquire/buyers/${id}/shortlist`, "POST", { listing_id, on }),
  compare: (id: string, ids: string[]) =>
    call<{ candidates: Candidate[]; basis: string }>(
      `/api/acquire/buyers/${id}/compare?ids=${ids.join(",")}`,
    ),
  request: (
    listingId: string,
    r: { buyer_id: string; categories: string[]; purpose: string; days: number },
  ) => call<{ request: AccessRequest }>(`/api/acquire/listings/${listingId}/requests`, "POST", r),
  withdraw: (id: string) =>
    call<{ request: AccessRequest }>(`/api/acquire/requests/${id}/withdraw`, "POST"),
  decide: (
    id: string,
    d: { action: "grant" | "decline"; categories?: string[]; days?: number; note?: string },
  ) => call<{ request: AccessRequest }>(`/api/acquire/requests/${id}/decide`, "POST", d),
  revoke: (id: string) =>
    call<{ request: AccessRequest }>(`/api/acquire/requests/${id}/revoke`, "POST"),
  room: (id: string, signal?: AbortSignal) =>
    call<Room>(`/api/acquire/rooms/${id}`, "GET", undefined, signal),
  tryRoom: (id: string, overrides: Overrides, signal?: AbortSignal) =>
    call<{
      scenario: { low_cents: number | null; high_cents: number | null; explanation: string[] };
    }>(`/api/acquire/rooms/${id}/try`, "POST", { overrides }, signal),
  saveRoomScenario: (id: string, name: string, overrides: Overrides) =>
    call<{ scenarios: BuyerScenario[] }>(`/api/acquire/rooms/${id}/scenarios`, "POST", {
      name,
      overrides,
    }),
  listing: (businessId: string) => call<SellerListing>(`/api/businesses/${businessId}/listing`),
  updateListing: (businessId: string, patch: Record<string, unknown>) =>
    call<SellerListing>(`/api/businesses/${businessId}/listing`, "PATCH", patch),
  listingSummary: (businessId: string) =>
    call<{ mode: string; mode_label: string; pending: number }>(
      `/api/businesses/${businessId}/listing/summary`,
    ),
};

/** The buying profile this browser last used (a convenience; the server checks every call). */
export const rememberedBuyer = {
  get: () => {
    try {
      return window.localStorage.getItem("es.buyer");
    } catch {
      return null;
    }
  },
  set: (id: string) => {
    try {
      window.localStorage.setItem("es.buyer", id);
    } catch {
      // private window or blocked storage: the first profile is used instead
    }
  },
};

export const STATUS_LABEL: Record<AccessRequest["status"], string> = {
  pending: "Waiting for the seller",
  granted: "Access granted",
  declined: "Declined",
  revoked: "Access ended by the seller",
  withdrawn: "Withdrawn",
  expired: "Access expired",
};

export const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
