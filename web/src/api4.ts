// Phase 4 calls: books, value, team and the helper's desk.

import type { Inquiry, Receipt } from "./api.ts";
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
  total_microcents: number;
  unknown_cost_requests: number;
  note: string;
}

export interface BooksView {
  months: Month[];
  chain_error: string | null;
  costs: CostRow[];
  categories: { category: string; kind: string; hint: string }[];
  now: Balances;
  spend: { unit: "USD"; basis: string; runtime: SpendLedger; build: SpendLedger };
  basis: string;
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

export interface HelperDesk {
  business: { id: string; name: string; slug: string };
  active_in_everstreet: boolean;
  chain_check: { authorized: boolean; reason: string };
  business_account: string | null;
  inquiries: Inquiry[];
  orders: (Receipt & { session_starts_at: string | null; customer: string })[];
}

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api4 = {
  books: (id: string, months = 12) =>
    call<BooksView>(`/api/businesses/${id}/books?months=${months}`),
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
