// Job 003wf2 (docs/design/DIRECT_SALE.md): the browser's port to the Direct sale routes. The
// server reads and verifies; each participant's own wallet signs. Shapes are the server's; the
// controller (saleFlow.ts) re-derives every call it is asked to send before the wallet sees it.

import type { WalletFunctionCall } from "./wallet.ts";

export type SaleKind =
  | "propose"
  | "revise"
  | "fund"
  | "accept"
  | "unfund"
  | "cancel"
  | "expire"
  | "claim"
  | "appoint"
  | "register"
  | "abort"
  | "create_plan"
  | "owner_probe";

export type ActionState =
  | "prepared"
  | "requested"
  | "unknown"
  | "confirmed"
  | "refused"
  | "no_longer_possible"
  | "set_aside";

export type SaleResolution =
  | { kind: "confirmed"; result: string; message: string }
  | { kind: "refused"; reason: string; message: string }
  | { kind: "unknown"; message: string }
  | { kind: "no_longer_possible"; message: string };

export interface SaleAction {
  id: string;
  business_id: string;
  kind: SaleKind;
  account: string;
  network: string;
  contract: string;
  asset: string;
  identity: string;
  deal_seq: string | null;
  version: number | null;
  call: WalletFunctionCall;
  action_digest: string;
  review: Record<string, unknown>;
  replaces: string | null;
  state: ActionState;
  tx_hash: string | null;
  asks: number;
  evidence: SaleResolution | null;
  effects: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface LiveDeal {
  seq: string;
  version: number;
  state: "proposed" | "accepting" | "closing";
  digest: string;
  seller: string;
  buyer: string;
  price: string;
  available_floor: string;
  expires_at_ms: string;
  close_window_ms: string;
  grants: { account: string; caps: number }[];
  terms_hash: string;
  expected_generation: number;
  seller_accepted: boolean;
  buyer_accepted: boolean;
  escrow: string;
  /** Job 003wf3: a Gated closing's timing (zero until both accept). */
  deadline_ms: string;
  closing_started_ms: string;
  closing_control_seq: string;
}

/** Job 003wf3: the business's newest managed handover (participants only). */
export interface SaleHandover {
  id: string;
  state: string;
  deal_seq: string;
  version: number;
  closing_started_ms: string;
  deadline_ms: string;
  waiting_for: string | null;
  checked_at_ms: number | null;
  attention_reason: string | null;
  outcome: unknown;
  orders: {
    n: number;
    issued_at_ms: string;
    /** The order's newest transaction attempt; `broadcasts` counts its actual sends. */
    attempt: { state: string; code: string | null; tx_hash: string; broadcasts?: number } | null;
  }[];
  service: { eligible: boolean; reasons: string[]; note: string } | null;
}

export interface SaleSetup {
  business: { id: string; name: string };
  network: string;
  contract: string;
  account: string;
  local_owner: boolean;
  roles: {
    seller: boolean;
    buyer: boolean;
    former_seller: boolean;
    new_owner: boolean;
    chain_owner: boolean;
    claimant: boolean;
  };
  capability: { supported: boolean; reason: "contract_upgrade" | "gated" | null };
  block: { height: string; hash: string; timestamp_ms: string };
  control: {
    owner: string;
    generation: number;
    control_seq: string;
    close_mode: "direct" | "gated";
    closer: string | null;
    service_manifest: string;
    manifest_seq: string;
    operators: { account: string; caps: number; generation: number }[];
    live_deal: LiveDeal | null;
  };
  outcomes: {
    status: "closed" | "cancelled" | "expired" | "aborted";
    seq: string;
    version: number;
    digest: string;
    seller: string;
    buyer: string;
    price: string;
    escrow_returned: string;
    generation_after: number;
  }[];
  /** Null for a past participant (not the owner, not in the live deal). */
  customer_obligations: null | {
    prepaid_unused: string;
    reserved_in_use: string;
    available: string;
    asset: string;
  };
  party: null | {
    profit_claim: string;
    escrow_return_claim: string;
    sale_proceeds_claim: string;
    pending_refs: number;
  };
  payouts: { slot: number; state: string; kind: string; amount: string; payout_id: string }[];
  terms: null | {
    version: 1;
    next_deal_seq: string;
    plan_count: number;
    min_reserve: string;
    party_exists: boolean;
    party_bytes: string;
    storage_byte_cost: string;
    payout_seq: string;
  };
  token: {
    account: string;
    meta: { symbol: string; name: string; decimals: number } | null;
    balance: string | null;
    registered: boolean;
    business_registered: boolean;
    storage_min: string | null;
  };
  terms_doc: { id: string; hash: string; text: string } | null;
  platform_operator: string | null;
  metering_appointed: boolean;
  intents: { id: string; deal_seq: string; version: number; digest: string; status: string }[];
  actions: SaleAction[];
  open: SaleAction[];
  handover?: SaleHandover | null;
  /** The Closing Ledger: what is still in flight (current participants of a live deal). */
  inventory?: SaleInventory | null;
  /** The Closing Ledger: the signed Gated readiness checklist for this exact deal version. */
  readiness?: SaleReadiness | null;
}

export interface SaleInventory {
  reservations_pending: number;
  reserved_unexecuted: number;
  executions_running: number;
  deliveries_pending: number;
  settlements_pending: number;
  settlements_unsettled: number;
  unresolved: number;
  pending_payouts: number;
  open_wallet_requests: number;
}

export interface SaleReadiness {
  format: "everstreet.readiness";
  version: 1;
  deal: { seq: string; version: number; digest: string };
  generation: number;
  items: { key: string; label: string; ok: boolean; value: string }[];
  input_digest: string;
  issued_at_ms: string;
  valid_until_ms: string;
  signer: string;
  signature: string;
}

export interface SalePreview {
  kind: SaleKind;
  network: string;
  contract: string;
  asset: string;
  account: string;
  block: { height: string; hash: string; timestamp_ms: string };
  call: WalletFunctionCall;
  identity: string;
  review: Record<string, unknown>;
  token: { symbol: string; decimals: number; name: string };
  terms_doc: { text: string; hash: string } | null;
  action_digest: string;
  input: Record<string, unknown>;
}

export interface CheckAnswer {
  action: SaleAction;
  resolution: SaleResolution | null;
  transaction: { hash: string; matched: boolean } | null;
  effects: Record<string, unknown> | null;
}

export interface SalePort {
  setup(businessId: string): Promise<SaleSetup>;
  prepare(businessId: string, kind: SaleKind, input: Record<string, unknown>): Promise<SalePreview>;
  create(
    businessId: string,
    body: {
      kind: SaleKind;
      input: Record<string, unknown>;
      action_digest: string;
      idempotency_key: string;
      replaces?: string;
    },
  ): Promise<{ created: boolean; action: SaleAction }>;
  requested(
    id: string,
    body: { tx_hash?: string; ask_id?: string },
  ): Promise<{ action: SaleAction; ask: "granted" | "already_asked" | null }>;
  check(id: string, body: { tx_hash?: string }): Promise<CheckAnswer>;
  abandon(id: string): Promise<{ action: SaleAction }>;
  /** The existing explicit reconciliation of a recorded intent (V3Intents). */
  reconcile(
    businessId: string,
    intentId: string,
  ): Promise<{ state: string; code: string | null; message: string }>;
}

/** A refusal or failure from the server, with its stable code and detail. */
export class SaleError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | undefined,
    readonly detail: unknown,
  ) {
    super(message);
  }
}

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as
    | (T & { error?: string; code?: string; detail?: unknown })
    | null;
  if (!res.ok || data === null)
    throw new SaleError(
      data?.error ?? `Request failed (${res.status})`,
      res.status,
      data?.code,
      data?.detail,
    );
  return data as T;
}

const enc = encodeURIComponent;
export const saleHttp: SalePort = {
  setup: (b) => call(`/api/sales/${enc(b)}`),
  prepare: (b, kind, input) => call(`/api/sales/${enc(b)}/prepare`, "POST", { kind, input }),
  create: (b, body) => call(`/api/sales/${enc(b)}/actions`, "POST", body),
  requested: (id, body) => call(`/api/sales/actions/${enc(id)}/requested`, "POST", body),
  check: (id, body) => call(`/api/sales/actions/${enc(id)}/check`, "POST", body),
  abandon: (id) => call(`/api/sales/actions/${enc(id)}/abandon`, "POST"),
  reconcile: (b, i) => call(`/api/businesses/${enc(b)}/v3/intents/${enc(i)}/reconcile`, "POST"),
};

// ---------- The handoff proof (Continuity Receipt) ----------

export type EvidenceSource =
  | "synthetic"
  | "local_node"
  | "testnet_final"
  | "testnet_receipt"
  | "light_client"
  | "everstreet";

export interface ProofFact {
  key: string;
  label: string;
  value: string | number | null;
  source: EvidenceSource;
  block?: string | null;
}

export interface ProofProvider {
  name: string;
  owner: string;
  generation: number;
  control_seq: string;
  block_height: string;
  error: string | null;
}

export interface HandoffProofView {
  business: { id: string; name: string };
  network: string;
  contract: string;
  source: EvidenceSource;
  block: { height: string; hash: string; timestamp_ms: string };
  deal: {
    seq: string;
    version: number;
    digest: string;
    seller: string;
    buyer: string;
    price: string;
    generation_after: number;
    at_ms: string;
  };
  asset: string;
  token: { symbol: string; decimals: number } | null;
  viewer: { operates: boolean };
  continuity: {
    customer: { account: string | null; name: string | null } | null;
    at_close: string | null;
    after: string | null;
    charged: number;
    at_close_block: string | null;
    after_block: string | null;
  };
  facts: ProofFact[];
  rights: {
    ended: { what: "owner_role" | "operator"; account: string; generation: number }[];
    carried_over: {
      operators: { account: string; caps: number }[];
      customers: number | null;
      units: string | null;
    };
    operates: { account: string; generation: number; moved: boolean };
    seller_claim: { account: string; owed: string | null; in_flight: string };
    still_possible: { customer: string | null; units: number; until_ms: string }[];
  };
  agreement: {
    status: "agree" | "uncertain" | "single";
    block: { height: string; hash: string };
    providers: ProofProvider[];
    last_coherent: {
      block_height: string;
      owner: string;
      generation: number;
      observed_at: string;
    } | null;
  };
  snapshot: {
    block: { height: string; hash: string; timestamp_ms: string };
    code_hash: string | null;
    keys: number | null;
  } | null;
}

export const proofHttp = {
  proof: (b: string) => call<HandoffProofView>(`/api/sales/${enc(b)}/proof`),
  receiptUrl: (b: string) => `/api/sales/${enc(b)}/receipt`,
};

// ---------- Companions (external asset, supplier allowance) ----------

export interface CompanionPayment {
  supplier: string;
  amount: string;
  invoice: string;
  state: "AwaitingApproval" | "Sending" | "Paid" | "Claim" | "Refused";
  generation: number;
  at_ms: string;
}

export interface CompanionView {
  control: { owner: string; generation: number };
  you_own_it: boolean;
  token?: { symbol: string; decimals: number } | null;
  asset: null | {
    account: string;
    registry: string;
    chain_id: string;
    chain: string | null;
    source: "synthetic" | "testnet" | null;
    controller: string | null;
    controller_generation: number | null;
    addresses: { generation: number; address: string }[];
    move: { id: string; state: string; evm_hash: string; updated_at: string } | null;
  };
  allowance: null | {
    account: string;
    grant: null | {
      agent: string;
      suppliers: string[];
      per_payment: string;
      per_period: string;
      period_ms: string;
      review_above: string;
      generation: number;
      granted_by?: string;
    };
    balance: string;
    reserved: string;
    available: string;
    spent_in_period: string;
    claims_total: string;
    period_start_ms: string;
    active: boolean;
    awaiting: CompanionPayment[];
    recent: CompanionPayment[];
  };
}

export type CompanionKind = "feed_move" | "allowance_grant" | "allowance_approve";

export interface CompanionPrepared {
  id: string;
  kind: CompanionKind;
  call: WalletFunctionCall;
  review: Record<string, unknown>;
}

export interface CompanionAction {
  id: string;
  kind: CompanionKind;
  state:
    | "prepared"
    | "refused"
    | "confirmed"
    | "external_pending"
    | "external_final"
    | "external_failed"
    | "unknown";
  tx_hash: string | null;
  evm_hash: string | null;
  result: { code?: string; value?: unknown; from?: string; to?: string } | null;
}

export const companionHttp = {
  view: (b: string) => call<CompanionView>(`/api/companions/${enc(b)}`),
  prepare: (b: string, kind: CompanionKind, input: Record<string, unknown> = {}) =>
    call<CompanionPrepared>(`/api/companions/${enc(b)}/prepare`, "POST", { kind, input }),
  sent: (id: string, tx_hash: string) =>
    call<CompanionAction>(`/api/companions/actions/${enc(id)}/sent`, "POST", { tx_hash }),
};

// ---------- escrow funding from another token (NEAR intents verifier) ----------

export type IntentsStage =
  | "quoted"
  | "deposited"
  | "swapped"
  | "delivered"
  | "funded"
  | "expired"
  | "refused"
  | "refunded"
  | "unknown";

export interface IntentsFundingView {
  id: string;
  stage: IntentsStage;
  deal_seq: string;
  version: number;
  verifier: string;
  solver: { account: string; source: "synthetic" | "testnet" } | null;
  give: {
    token: string;
    symbol: string | null;
    decimals: number | null;
    amount: string;
    inside: string;
  };
  get: { token: string; amount: string; inside: string; own: string };
  deadline_ms: number;
  exec_hash: string | null;
  error: string | null;
  sign: { message: string; nonce: string; recipient: string } | null;
}

export interface IntentsPanelView {
  verifier: string;
  asset: string;
  account: string;
  offers: { token: string; symbol: string; decimals: number; rate_num: string; rate_den: string }[];
  solver: { account: string; source: "synthetic" | "testnet" } | null;
  funding: IntentsFundingView | null;
}

export const intentsHttp = {
  view: (b: string) => call<IntentsPanelView>(`/api/sales/${enc(b)}/intents`),
  quote: (b: string, token: string) =>
    call<IntentsFundingView>(`/api/sales/${enc(b)}/intents/quote`, "POST", { token }),
  status: (id: string) => call<IntentsFundingView>(`/api/intents/${enc(id)}`),
  sign: (id: string, s: { public_key: string; signature: string; callback_url: string | null }) =>
    call<IntentsFundingView>(`/api/intents/${enc(id)}/sign`, "POST", s),
};
