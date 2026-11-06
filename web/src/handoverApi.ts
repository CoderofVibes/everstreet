// Job 003s: the digital acquisition workspace's answers, parsed strictly. Owner reads: the
// recorded v3 evidence (GET /api/businesses/:id/v3) and the business's sale intents (GET
// .../v3/intents). Participant reads: the minimal receipt (GET .../v3/intents/:intent) and their
// own receipts (GET /api/me/v3/handovers). Amounts, heights and sequences stay decimal strings.

import { call, MalformedAnswer } from "./customerApi.ts";

const fail = (where: string): never => {
  throw new MalformedAnswer(`The answer wasn't in the expected form (${where}).`);
};
const obj = (v: unknown, where: string) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : fail(where);
const str = (v: unknown, where: string) => (typeof v === "string" ? v : fail(where));
const dec = (v: unknown, where: string) =>
  typeof v === "string" && /^(0|[1-9][0-9]{0,77})$/.test(v) ? v : fail(where);
const int = (v: unknown, where: string) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : fail(where);
const bool = (v: unknown, where: string) => (typeof v === "boolean" ? v : fail(where));
const hex32 = (v: unknown, where: string) =>
  typeof v === "string" && /^[0-9a-f]{64}$/.test(v) ? v : fail(where);
const nullable = <T>(v: unknown, f: (x: unknown) => T) =>
  v === null || v === undefined ? null : f(v);
const list = (v: unknown, where: string, max: number) =>
  Array.isArray(v) && v.length <= max ? v : fail(where);
const oneOf = <T extends string>(v: unknown, all: readonly T[], where: string): T =>
  typeof v === "string" && (all as readonly string[]).includes(v) ? (v as T) : fail(where);

// ---------- the observed sale (owner) ----------

export interface Grant {
  account: string;
  caps: number;
}

export interface ObservedDeal {
  seq: string;
  version: number;
  state: "proposed" | "accepting" | "closing";
  digest: string;
  seller: string;
  buyer: string;
  price: string;
  escrow: string;
  available_floor: string;
  expires_at_ms: string;
  close_window_ms: string;
  deadline_ms: string;
  grants: Grant[];
  terms_hash: string;
  expected_generation: number;
  seller_accepted: boolean;
  buyer_accepted: boolean;
}

export interface SaleEvidence {
  state: "observed" | "never_observed" | "unbound" | "paused";
  owner_epoch: string;
  message: string | null;
  /** Present when observed. */
  observed: {
    block: { height: string; hash: string };
    observed_at: string;
    freshness: "fresh" | "stale";
    flag: { code: string; message: string } | null;
    owner: string;
    generation: number;
    close_mode: "direct" | "gated";
    closer: string | null;
    deal: ObservedDeal | null;
    asset: string;
    /** The token's details as read on chain (TokenAmount parses them; unknown shows base units). */
    token: unknown;
    customers: { prepaid_unused: string; reserved_in_use: string };
    owner_match: "matches" | "mismatch" | "unknown_mapping";
    outcomes: { seq: string; version: number; status: string }[];
  } | null;
}

const DEAL_STATES = ["proposed", "accepting", "closing"] as const;

function parseDeal(raw: unknown): ObservedDeal {
  const d = obj(raw, "live_deal");
  return {
    seq: dec(d.seq, "deal.seq"),
    version: int(d.version, "deal.version"),
    state: oneOf(d.state, DEAL_STATES, "deal.state"),
    digest: hex32(d.digest, "deal.digest"),
    seller: str(d.seller, "deal.seller"),
    buyer: str(d.buyer, "deal.buyer"),
    price: dec(d.price, "deal.price"),
    escrow: dec(d.escrow, "deal.escrow"),
    available_floor: dec(d.available_floor, "deal.available_floor"),
    expires_at_ms: dec(d.expires_at_ms, "deal.expires_at_ms"),
    close_window_ms: dec(d.close_window_ms, "deal.close_window_ms"),
    deadline_ms: dec(d.deadline_ms, "deal.deadline_ms"),
    grants: list(d.grants, "deal.grants", 16).map((g) => {
      const x = obj(g, "grant");
      return { account: str(x.account, "grant.account"), caps: int(x.caps, "grant.caps") };
    }),
    terms_hash: hex32(d.terms_hash, "deal.terms_hash"),
    expected_generation: int(d.expected_generation, "deal.expected_generation"),
    seller_accepted: bool(d.seller_accepted, "deal.seller_accepted"),
    buyer_accepted: bool(d.buyer_accepted, "deal.buyer_accepted"),
  };
}

export function parseEvidence(raw: unknown): SaleEvidence {
  const v = obj(raw, "evidence");
  const state = oneOf(
    v.state,
    ["observed", "never_observed", "unbound", "paused"] as const,
    "evidence.state",
  );
  const owner_epoch = str(v.owner_epoch, "evidence.owner_epoch");
  if (state !== "observed")
    return {
      state,
      owner_epoch,
      message: nullable(v.message, (m) => str(m, "evidence.message")),
      observed: null,
    };
  const c = obj(v.control, "evidence.control");
  const t = obj(v.treasury, "evidence.treasury");
  const b = obj(v.block, "evidence.block");
  const flag = nullable(v.flag, (f) => {
    const x = obj(f, "evidence.flag");
    return { code: str(x.code, "flag.code"), message: str(x.message, "flag.message") };
  });
  return {
    state,
    owner_epoch,
    message: null,
    observed: {
      block: { height: dec(b.height, "block.height"), hash: str(b.hash, "block.hash") },
      observed_at: str(v.observed_at, "evidence.observed_at"),
      freshness: oneOf(v.freshness, ["fresh", "stale"] as const, "evidence.freshness"),
      flag,
      owner: str(c.owner, "control.owner"),
      generation: int(c.generation, "control.generation"),
      close_mode: oneOf(c.close_mode, ["direct", "gated"] as const, "control.close_mode"),
      closer: nullable(c.closer, (x) => str(x, "control.closer")),
      deal: nullable(c.live_deal, parseDeal),
      asset: str(t.asset, "treasury.asset"),
      // Review #42: parsed by TokenAmount (unknown or disputed details show exact base units).
      token: v.token ?? null,
      customers: {
        prepaid_unused: dec(t.ent_free_value, "treasury.ent_free_value"),
        reserved_in_use: dec(t.ent_held_value, "treasury.ent_held_value"),
      },
      owner_match: oneOf(
        v.owner_match,
        ["matches", "mismatch", "unknown_mapping"] as const,
        "evidence.owner_match",
      ),
      outcomes: list(v.outcomes, "evidence.outcomes", 64).map((o) => {
        const x = obj(o, "outcome");
        return {
          seq: dec(x.seq, "outcome.seq"),
          version: int(x.version, "outcome.version"),
          status: str(x.status, "outcome.status"),
        };
      }),
    },
  };
}

// ---------- intents (owner) and receipts (participants) ----------

export type IntentStatus = "recorded" | "applied" | "ended" | "superseded";
const STATUSES = ["recorded", "applied", "ended", "superseded"] as const;

export interface Intent {
  id: string;
  status: IntentStatus;
  source: { network: string; account: string };
  deal: { seq: string; version: number; digest: string };
  terms: {
    price: string;
    available_floor: string;
    expires_at_ms: string;
    close_window_ms: string;
    grants: Grant[];
    close_mode: "direct" | "gated";
    closer: string | null;
  };
  seller_account: string;
  buyer_account: string;
  expected_generation: number;
  recorded_block: { height: string };
  created_at: string;
}

export function parseIntent(raw: unknown): Intent {
  const i = obj(raw, "intent");
  const src = obj(i.source, "intent.source");
  const d = obj(i.deal, "intent.deal");
  const t = obj(i.terms, "intent.terms");
  return {
    id: str(i.id, "intent.id"),
    status: oneOf(i.status, STATUSES, "intent.status"),
    source: {
      network: str(src.network, "source.network"),
      account: str(src.account, "source.account"),
    },
    deal: {
      seq: dec(d.seq, "intent.seq"),
      version: int(d.version, "intent.version"),
      digest: hex32(d.digest, "intent.digest"),
    },
    terms: {
      price: dec(t.price, "terms.price"),
      available_floor: dec(t.available_floor, "terms.available_floor"),
      expires_at_ms: dec(t.expires_at_ms, "terms.expires_at_ms"),
      close_window_ms: dec(t.close_window_ms, "terms.close_window_ms"),
      grants: list(t.grants, "terms.grants", 16).map((g) => {
        const x = obj(g, "grant");
        return { account: str(x.account, "grant.account"), caps: int(x.caps, "grant.caps") };
      }),
      close_mode: oneOf(t.close_mode, ["direct", "gated"] as const, "terms.close_mode"),
      closer: nullable(t.closer, (x) => str(x, "terms.closer")),
    },
    seller_account: str(i.seller_account, "intent.seller_account"),
    buyer_account: str(i.buyer_account, "intent.buyer_account"),
    expected_generation: int(i.expected_generation, "intent.expected_generation"),
    recorded_block: { height: dec(obj(i.recorded_block, "recorded_block").height, "block") },
    created_at: str(i.created_at, "intent.created_at"),
  };
}

export function parseIntents(raw: unknown): Intent[] {
  return list(obj(raw, "answer").intents, "intents", 20).map(parseIntent);
}

export interface Receipt {
  intent_id: string;
  business_id: string;
  role: "seller" | "buyer";
  status: IntentStatus;
  deal: { seq: string; version: number; digest: string };
  target_generation: number;
  recorded_at: string;
  applied_at: string | null;
  outcome_control_seq: string | null;
}

export function parseReceipt(raw: unknown): Receipt {
  const r = obj(raw, "receipt");
  const d = obj(r.deal, "receipt.deal");
  return {
    intent_id: str(r.intent_id, "receipt.intent_id"),
    business_id: str(r.business_id, "receipt.business_id"),
    role: oneOf(r.role, ["seller", "buyer"] as const, "receipt.role"),
    status: oneOf(r.status, STATUSES, "receipt.status"),
    deal: {
      seq: dec(d.seq, "receipt.seq"),
      version: int(d.version, "receipt.version"),
      digest: hex32(d.digest, "receipt.digest"),
    },
    target_generation: int(r.target_generation, "receipt.target_generation"),
    recorded_at: str(r.recorded_at, "receipt.recorded_at"),
    applied_at: nullable(r.applied_at, (x) => str(x, "receipt.applied_at")),
    outcome_control_seq: nullable(r.outcome_control_seq, (x) => dec(x, "receipt.control_seq")),
  };
}

export type ReconcileState =
  | "pending"
  | "unavailable"
  | "conflict"
  | "ended"
  | "applied"
  | "already"
  | "superseded";

export interface ReconcileAnswer {
  state: ReconcileState;
  code: string | null;
  message: string;
  receipt: Receipt;
}

export function parseReconcile(raw: unknown): ReconcileAnswer {
  const a = obj(raw, "answer");
  return {
    state: oneOf(
      a.state,
      ["pending", "unavailable", "conflict", "ended", "applied", "already", "superseded"] as const,
      "reconcile.state",
    ),
    code: nullable(a.code, (x) => str(x, "reconcile.code")),
    message: str(a.message, "reconcile.message"),
    receipt: parseReceipt(a.receipt),
  };
}

export interface Handover {
  business: { id: string; name: string | null };
  you_own_it_now: boolean;
  receipt: Receipt;
}

export function parseHandovers(raw: unknown): Handover[] {
  return list(obj(raw, "answer").handovers, "handovers", 20).map((h) => {
    const x = obj(h, "handover");
    const b = obj(x.business, "handover.business");
    return {
      business: {
        id: str(b.id, "business.id"),
        name: nullable(b.name, (n) => str(n, "business.name")),
      },
      you_own_it_now: bool(x.you_own_it_now, "handover.you_own_it_now"),
      receipt: parseReceipt(x.receipt),
    };
  });
}

// ---------- refresh answers (job 003s1) ----------

const RECORDED = [
  "accepted",
  "duplicate",
  "stale",
  "conflict",
  "contradictory",
  "source_changed",
] as const;

export type RefreshAnswer =
  | {
      outcome: (typeof RECORDED)[number];
      message: string;
      period: { yyyymm: number; outcome: string } | null;
      view: SaleEvidence;
    }
  | { outcome: "refused"; code: string; message: string };

/**
 * The finite forms POST .../v3/refresh answers in (server/src/v3observe.ts refresh): a refusal
 * with a code and no view, or a recording outcome with its period and the owner's view. Anything
 * else, including a view that doesn't fit its outcome, is malformed.
 */
export function parseRefresh(raw: unknown): RefreshAnswer {
  const a = obj(raw, "refresh");
  const message = str(a.message, "refresh.message");
  if (a.outcome === "refused") {
    if (a.view !== undefined || a.period !== undefined) fail("refresh.refused");
    return { outcome: "refused", code: str(a.code, "refresh.code"), message };
  }
  const outcome = oneOf(a.outcome, RECORDED, "refresh.outcome");
  const period = nullable(a.period, (p) => {
    const x = obj(p, "refresh.period");
    return { yyyymm: int(x.yyyymm, "period.yyyymm"), outcome: str(x.outcome, "period.outcome") };
  });
  const view = parseEvidence(a.view);
  // A recorded reading has an observed view; a conflict leaves the evidence flagged.
  if ((outcome === "accepted" || outcome === "duplicate") && view.state !== "observed")
    fail("refresh.view");
  if (outcome === "conflict" && !view.observed?.flag) fail("refresh.flag");
  return { outcome, message, period, view };
}

/**
 * Whether a contract deadline had passed when the evidence was read (job 003s1). "0" means unset.
 * It describes the reading only: whether a sale can still be accepted is for the contract to show.
 */
export function elapsedAt(deadlineMs: string, observedAt: string): boolean {
  const at = Date.parse(observedAt);
  if (!/^[0-9]{1,20}$/.test(deadlineMs) || deadlineMs === "0" || Number.isNaN(at)) return false;
  return Number(deadlineMs) <= at;
}

// ---------- the port ----------

export interface HandoverPort {
  evidence(businessId: string): Promise<unknown>;
  refresh(businessId: string): Promise<unknown>;
  intents(businessId: string): Promise<unknown>;
  record(
    businessId: string,
    body: { idempotency_key: string; deal_seq: string; version: number; digest: string },
  ): Promise<unknown>;
  receipt(businessId: string, intentId: string): Promise<unknown>;
  reconcile(businessId: string, intentId: string): Promise<unknown>;
  mine(): Promise<unknown>;
}

const enc = encodeURIComponent;
const biz = (b: string) => `/api/businesses/${enc(b)}`;
export const handoverHttp: HandoverPort = {
  evidence: (b) => call(`${biz(b)}/v3`),
  refresh: (b) => call(`${biz(b)}/v3/refresh`, "POST", {}),
  intents: (b) => call(`${biz(b)}/v3/intents`),
  record: (b, body) => call(`${biz(b)}/v3/intents`, "POST", body),
  receipt: (b, i) => call(`${biz(b)}/v3/intents/${enc(i)}`),
  reconcile: (b, i) => call(`${biz(b)}/v3/intents/${enc(i)}/reconcile`, "POST"),
  mine: () => call("/api/me/v3/handovers"),
};

/** Groups a base-unit amount for reading; never converts units or adds decimals. */
export const grouped = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
