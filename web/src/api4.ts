// Phase 4 calls: books, value, team and the helper's desk.

import { ApiError, type Inquiry, type Receipt } from "./api.ts";
import type { FinMonth } from "./finance.ts";

/** A month of the books with its states and provenance (job 003f); see finance.ts. */
export type Month = FinMonth & { lines: NonNullable<FinMonth["lines"]> };

export interface CostRow {
  id: string;
  yyyymm: number;
  until_yyyymm: number | null;
  category: string;
  kind: "direct" | "overhead";
  amount_cents: number;
  recurring: number;
  note: string;
  origin: "founder" | "seeded";
  voided_at: string | null;
  void_note: string;
}

/** Today's balances on the contract: a current stock, never a monthly flow. */
export type Balances =
  | {
      state: "observed";
      read_at: string;
      customer_money_cents: number | null;
      customer_credit_cents: number | null;
      available_cents: number | null;
      withdrawable_cents: number | null;
      pending_payouts_cents: number | null;
      buyer_escrow_cents: number | null;
      seller_proceeds_cents: number | null;
      source: string;
    }
  | { state: "unavailable" | "not_connected" | "not_applicable"; reason: string };

export interface SpendLedger {
  months: {
    yyyymm: number;
    used_microcents: number;
    requests: number;
    unknown_cost_requests: number;
    held_cents: number;
  }[];
  /** The selected period. */
  period_microcents: number;
  period_unknown_cost_requests: number;
  /** All time. */
  total_microcents: number;
  unknown_cost_requests: number;
  note: string;
}

/** Job 003t: digital operations, from this app's own customer and runtime records (owner only). */
export interface OpsUsage {
  requested: number;
  charged: number;
  returned: number;
  settling: number;
  needs_attention: number;
  reserved_unsettled: number;
  awaiting_reservation: number;
  never_reserved: number;
}
export interface OpsExecution {
  ran: number;
  usable_result: number;
  not_usable: number;
  undecided: number;
  unknown: number;
}
export interface OpsCost {
  /** Exact millionths of a cent, as a decimal string. */
  microcents: string;
  calls: number;
  unknown_cost_calls: number;
  unknown_held_cents: number;
}
export interface OpsMonth {
  yyyymm: number;
  label: string;
  so_far: boolean;
  usage: OpsUsage;
  execution: OpsExecution;
  cost: { customers: OpsCost; founder: OpsCost };
}
export interface Operations {
  state: "not_started" | "recorded";
  period: { from: number; to: number; months: number; buckets: string };
  months: OpsMonth[];
  totals: {
    usage: OpsUsage;
    execution: OpsExecution;
    cost: { customers: OpsCost; founder: OpsCost };
  };
  /** The one instant every figure is read as of (003t1). */
  as_of: string;
  /** Current work up to `as_of` (not a period figure), in exclusive groups (003t1). */
  current: OpsCurrent;
  /** Whether anything settles customer units by itself, from the worker's health (003t1). */
  settlement: {
    worker: "running" | "stopped" | "overdue" | "not_scheduled" | "not_started" | "unknown";
    heartbeat_at: string | null;
    paused_by_authority: number;
  };
  products: { project_id: string; active_offers: number; retired_offers: number }[];
  basis: { current: string; usage: string; execution: string; cost: string; value: string };
}
export interface OpsCurrent {
  awaiting_settlement: number;
  needs_attention: number;
  reserved_not_settled: number;
  awaiting_reservation: number;
  awaiting_signature: number;
}

/** Job 001c: the digital business desk (owner only, read only, as of one instant). */
export interface DeskProduct {
  project_id: string;
  name: string | null;
  foundation_label: string;
  revision: number;
  updated_at: string;
  release: { state: "active"; activated_at: string } | { state: "none" | "retired_only" };
  offers: { active: number; retired: number };
  offer: {
    id: string;
    plan_id: number;
    unit_price: string | null;
    asset: string;
    token?: { symbol: string; decimals: number } | null;
  } | null;
  /** Job 001h: the active release's identity (what customers see), apart from the draft `name`. */
  released?: { name: string | null; revision: number } | null;
  status: "brief_only" | "released" | "offered" | "offer_retired";
}
export interface DeskWorkItem {
  key: string;
  who: "you" | "system";
  count: number;
  label: string;
  link: {
    to: "customers" | "studio" | "inquiries" | "checklist" | "continuity" | "cases" | "sale";
    project?: string;
  };
}
export interface DigitalDeskView {
  as_of: string;
  kind: "digital" | "legacy";
  page: { published: boolean };
  products: { total: number; shown: DeskProduct[] };
  imports: { total: number };
  legacy_offering: { configured: boolean; title: string | null };
  work: DeskWorkItem[];
  current: OpsCurrent;
  settlement: Operations["settlement"];
}

export interface BooksView {
  months: Month[];
  chain_error: string | null;
  costs: CostRow[];
  categories: { category: string; kind: string; hint: string }[];
  now: Balances;
  spend: { unit: "USD"; basis: string; runtime: SpendLedger; build: SpendLedger };
  operations?: Operations;
  basis: string;
  /** Review #45: revenue is per use in a token; no dollar revenue or contribution here. */
  token_revenue?: boolean;
  period_months: number;
}

export interface Estimate {
  inputs: {
    stage: "plan" | "early" | "operating" | "unavailable";
    gaps?: string[];
    months_used: number[];
    revenue_cents: number;
    costs_cents: number;
    labor_month_cents: number;
    founder_hours_week: number;
    hourly_rate_cents: number;
    multiple_low: number;
    multiple_high: number;
    plan_customers_month: number | null;
    price_cents: number | null;
    model: string;
  };
  normalized_annual_cents: number;
  low_cents: number | null;
  high_cents: number | null;
  label: string;
  explanation: string[];
  missing: string[];
  sources: { input: string; value: string; source: string }[];
}

export interface ValueSettings {
  founder_hours_week: number | null;
  hourly_rate_cents: number | null;
  multiple_low: number | null;
  multiple_high: number | null;
  plan_customers_month: number | null;
  share_numbers: boolean;
}

export interface Overrides {
  extra_customers_month?: number;
  price_cents?: number;
  founder_hours_week?: number;
  hourly_rate_cents?: number;
  extra_monthly_costs_cents?: number;
  multiple_low?: number;
  multiple_high?: number;
}

export interface ValueView {
  estimate: Estimate;
  settings: ValueSettings;
  what_changed: {
    from: string;
    to: string;
    changes: string[];
    range_before: string;
    range_after: string;
  } | null;
  history: { at: string; low_cents: number | null; high_cents: number | null; label: string }[];
  scenarios: {
    id: string;
    name: string;
    overrides: Overrides;
    low_cents: number | null;
    high_cents: number | null;
    created_at: string;
  }[];
  months: Month[];
  chain_error: string | null;
}

export interface TeamMember {
  person_id: string;
  name: string;
  account_id: string | null;
  capabilities: string[];
  active: boolean;
  appointed_url: string | null;
  revoked_url: string | null;
  since: string;
}

/** Job 005b: one capability's state now (Everstreet's record and the business's contract). */
export interface HelperCapabilityNow {
  state: "authorized" | "denied" | "unconfirmed" | "ended";
  reason: string;
}
export interface HelperDesk {
  business: { id: string; name: string; slug: string };
  /** Job 005b: active (some capability confirmed now), denied, unconfirmed or ended. */
  access: "active" | "denied" | "unconfirmed" | "ended";
  active_in_everstreet: boolean;
  capabilities: { support: HelperCapabilityNow; fulfillment: HelperCapabilityNow };
  chain_check: { authorized: boolean; reason: string };
  business_account: string | null;
  /** Null unless support is confirmed now (never an empty list standing in for "not allowed"). */
  inquiries:
    | (Pick<Inquiry, "id" | "kind" | "message" | "share_contact" | "from_name" | "reply"> & {
        created_at: string;
        replied_at: string | null;
      })[]
    | null;
  /** Null unless fulfillment is confirmed now. */
  orders: (Receipt & { session_starts_at: string | null; customer: string })[] | null;
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

export const api4 = {
  books: (id: string, months = 12) =>
    call<BooksView>(`/api/businesses/${id}/books?months=${months}`),
  digitalDesk: (id: string) => call<DigitalDeskView>(`/api/businesses/${id}/digital-desk`),
  addCost: (
    id: string,
    c: { category: string; amount_cents: number; recurring: boolean; yyyymm: number; note: string },
  ) => call<{ costs: CostRow[] }>(`/api/businesses/${id}/costs`, "POST", c),
  endCost: (id: string, costId: string) =>
    call<{ costs: CostRow[] }>(`/api/businesses/${id}/costs/${costId}`, "DELETE"),
  value: (id: string) => call<ValueView>(`/api/businesses/${id}/value`),
  settings: (id: string, s: Partial<ValueSettings>) =>
    call<ValueSettings>(`/api/businesses/${id}/value/settings`, "PATCH", s),
  tryChange: (id: string, o: Overrides) =>
    call<{ base: Estimate; scenario: Estimate }>(`/api/businesses/${id}/value/try`, "POST", o),
  saveScenario: (id: string, name: string, overrides: Overrides) =>
    call<{ scenarios: ValueView["scenarios"] }>(`/api/businesses/${id}/value/scenarios`, "POST", {
      name,
      overrides,
    }),
  team: (id: string) => call<{ team: TeamMember[] }>(`/api/businesses/${id}/team`),
  addHelper: (id: string, person_id: string) =>
    call<{ team: TeamMember[] }>(`/api/businesses/${id}/team`, "POST", { person_id }),
  removeHelper: (id: string, personId: string) =>
    call<{ team: TeamMember[] }>(`/api/businesses/${id}/team/${personId}`, "DELETE"),
  helping: () =>
    call<{ businesses: { business_id: string; name: string; slug: string }[] }>("/api/helping"),
  helperDesk: (id: string) => call<HelperDesk>(`/api/helping/${id}`),
  helperReply: (id: string, inquiryId: string, text: string) =>
    call<HelperDesk>(`/api/helping/${id}/inquiries/${inquiryId}/reply`, "POST", { text }),
  deliverAsHelper: (orderId: string) =>
    call<HelperDesk>(`/api/payments/${orderId}/deliver`, "POST"),
};

export const usd = (cents: number | null | undefined) =>
  cents === null || cents === undefined
    ? "—"
    : `${cents < 0 ? "−" : ""}$${Math.abs(Math.round(cents / 100)).toLocaleString("en-US")}`;
