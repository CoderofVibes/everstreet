// Phase 6 calls: deals, both acceptances on NEAR, proceeds and the buyer's first shift.

export interface Terms {
  business: { name: string; account: string };
  seller: { name: string; account: string };
  buyer: { team: string; kind: string; representative: string; account: string };
  network: string;
  asset: string;
  price_cents: number;
  expires_at: string;
  control: string[];
  stays: string[];
  separate: string[];
  excluded: string[];
  handover: string;
  conditions: string;
  evidence: {
    estimate: string;
    basis: string;
    months: string[];
    revenue_month: string;
    profit_month: string;
    customer_money: string;
    snapshot_at: string;
  };
}

export interface DealView {
  deal: {
    id: string;
    status: "open" | "closed" | "cancelled" | "expired" | "void";
    version: number;
    price_cents: number;
    expires_at: string;
    digest: string;
    terms_hash: string;
    business: { id: string; name: string; slug: string; account: string; url: string };
    seller: { name: string; account: string };
    buyer: { id: string; team: string; representative: string; account: string };
    closed_at: string | null;
    generation_after: number | null;
    close_tx_url: string | null;
  };
  you: "seller" | "representative" | "team";
  terms: Terms;
  changes: string[];
  previous_version: number | null;
  chain: {
    status: string;
    version: number;
    held_cents: number;
    funded: boolean;
    seller_accepted: boolean;
    buyer_accepted: boolean;
    digest: string;
    matches_terms: boolean;
  } | null;
  wallet: { account_id: string; balance_cents: number | null; explorer: string } | null;
  proceeds: {
    held_cents: number | null;
    claimed_at: string | null;
    claim_tx_url: string | null;
    error: string | null;
  } | null;
  steps: {
    kind: string;
    by: string | null;
    version: number | null;
    ok: boolean;
    tx_url: string | null;
    detail: string;
    at: string;
  }[];
  items: { key: string; name: string; status: string; detail: string; note: string }[];
  first_shift: {
    control: { owner: string; generation: number; operators: number; is_buyer: boolean } | null;
    customer_money: { in_terms: string; now: string; source: string };
    pre_sale_orders: {
      order_id: string;
      customer: string;
      amount_cents: number;
      paid_at: string;
      session_starts_at: string | null;
    }[];
    business_id: string;
  } | null;
  /** Your acceptance was sent but its result couldn't be read back yet (job 003b). */
  confirmation?: { state: "unknown"; detail: string } | null;
  /** The contract shows a close Everstreet hasn't followed, and why (job 003b). */
  reconciliation?: { state: "pending" | "unknown" | "needed"; detail: string } | null;
  /** More than one ownership entry recorded for this deal; shown, never auto-repaired. */
  history_conflict?: boolean;
  check?: {
    refused: boolean;
    error: string | null;
    tx: string;
    operator_check: { authorized: boolean; reason: string; generation: number };
  };
}

export interface DealSummary {
  id: string;
  business_id: string;
  business: string;
  buyer_id: string;
  buyer: string;
  role: "seller" | "buyer";
  status: DealView["deal"]["status"];
  version: number;
  price_cents: number;
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

export interface TermsInput {
  price_cents: number;
  days: number;
  handover: string;
  conditions: string;
}

export const api6 = {
  deals: () => call<{ deals: DealSummary[] }>("/api/deals"),
  propose: (businessId: string, t: TermsInput & { buyer_id: string }) =>
    call<DealView>(`/api/businesses/${businessId}/deals`, "POST", t),
  deal: (id: string) => call<DealView>(`/api/deals/${id}`),
  revise: (id: string, t: TermsInput) => call<DealView>(`/api/deals/${id}/revise`, "POST", t),
  testDollars: (id: string) => call<DealView>(`/api/deals/${id}/test-dollars`, "POST"),
  fund: (id: string) => call<DealView>(`/api/deals/${id}/fund`, "POST"),
  withdrawHold: (id: string) => call<DealView>(`/api/deals/${id}/withdraw-hold`, "POST"),
  accept: (id: string, digest: string) =>
    call<DealView>(`/api/deals/${id}/accept`, "POST", { digest }),
  cancel: (id: string) => call<DealView>(`/api/deals/${id}/cancel`, "POST"),
  claim: (id: string) => call<DealView>(`/api/deals/${id}/claim`, "POST"),
  formerOwnerCheck: (id: string) => call<DealView>(`/api/deals/${id}/former-owner-check`, "POST"),
  markItem: (id: string, key: string, note: string) =>
    call<DealView>(`/api/deals/${id}/items/${key}`, "POST", { note }),
  deliver: (orderId: string) => call<unknown>(`/api/payments/${orderId}/deliver`, "POST"),
};

export const DEAL_STATUS: Record<DealView["deal"]["status"], string> = {
  open: "Open",
  closed: "Closed on NEAR",
  cancelled: "Cancelled",
  expired: "Expired",
  void: "Void: another deal closed",
};
