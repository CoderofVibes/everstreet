// Job 003j: the owner's read of business-v3 observations (GET /api/businesses/:id/v3) and a
// deliberate refresh (POST .../v3/refresh). Browser-side types only (no server imports). Every
// answer is validated before it is shown: amounts, heights and sequences stay decimal strings and
// are never turned into JavaScript numbers.

import { ApiError } from "./api.ts";

export type Freshness = "fresh" | "stale";

export interface Counter {
  amount: string;
  exact: boolean;
}

export interface PeriodEvidence {
  yyyymm: number;
  status: "recorded" | "no_activity" | "not_retained" | "invalid";
  period: Record<string, Counter> | null;
  block: { height: string; hash: string };
  at_core_block: boolean;
  observed_at: string;
}

export interface LiveDeal {
  seq: string;
  version: number;
  state: "proposed" | "accepting" | "closing";
  seller: string;
  buyer: string;
  price: string;
  escrow: string;
  seller_accepted: boolean;
  buyer_accepted: boolean;
  expires_at_ms: string;
  deadline_ms: string;
  expected_generation: number;
}

export interface Outcome {
  status: "closed" | "cancelled" | "expired" | "aborted";
  seq: string;
  version: number;
  generation_after: number;
  at_ms: string;
  seller: string;
  buyer: string;
  price: string;
  escrow_returned: string;
  observed_from_block: string;
}

export interface Treasury {
  asset: string;
  held: string;
  ent_free_value: string;
  ent_held_value: string;
  available: string;
  withdrawable: string;
  pending_total: string;
  claims_total: string;
  escrow_total: string;
}

export interface Observed {
  state: "observed";
  owner_epoch: string;
  served_at: string;
  stale_after_ms: number;
  binding: { network: string; account: string };
  binding_matches_record: boolean;
  transport: "configured" | "unavailable";
  source: { network: string; account: string; schema: string };
  block: { height: string; hash: string };
  provenance: string;
  network_identity: string;
  observed_at: string;
  high_water: { block_height: string; control_seq: string };
  flag: { code: string; detail: string | null; message: string } | null;
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
    manifest_note: string;
    closer_note: string;
  };
  owner_match: "matches" | "mismatch" | "unknown_mapping";
  owner_note: string;
  treasury: Treasury;
  /** Review #42: the token's details as read on chain (TokenAmount parses them). */
  token?: unknown;
  claims_note: string;
  pending: { slot: number; state: string; kind: string; amount: string; to: string }[];
  periods: PeriodEvidence[];
  periods_note: string;
  outcomes: Outcome[];
  history: { complete: boolean; missing_count: string; first_missing: string[]; note: string };
}

export type ContinuityView =
  | { state: "unbound"; owner_epoch: string; message: string }
  | { state: "paused"; owner_epoch: string; code: string; message: string }
  | {
      state: "never_observed";
      owner_epoch: string;
      binding: { network: string; account: string };
      transport: "configured" | "unavailable";
    }
  | Observed;

export interface RefreshAnswer {
  outcome: string;
  code?: string;
  message: string;
  period?: { yyyymm: number; outcome: string } | null;
  view?: ContinuityView;
}

// ---------- validation (nothing unchecked is ever displayed) ----------

export class MalformedView extends Error {}

const DEC = /^(0|[1-9][0-9]{0,77})$/;
const bad = (what: string): never => {
  throw new MalformedView(what);
};
const str = (v: unknown, what: string) => (typeof v === "string" ? v : bad(what));
const dec = (v: unknown, what: string) => (typeof v === "string" && DEC.test(v) ? v : bad(what));
const int = (v: unknown, what: string) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : bad(what);
const iso = (v: unknown, what: string) =>
  typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : bad(what);
const obj = (v: unknown, what: string) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : bad(what);
const list = (v: unknown, what: string) => (Array.isArray(v) ? v : bad(what));

/** Checks an answer's shape and every value the page shows; throws MalformedView otherwise. */
export function parseView(raw: unknown): ContinuityView {
  const v = obj(raw, "the answer");
  str(v.owner_epoch, "owner_epoch");
  switch (v.state) {
    case "unbound":
      str(v.message, "message");
      return v as unknown as ContinuityView;
    case "paused":
      str(v.code, "code");
      str(v.message, "message");
      return v as unknown as ContinuityView;
    case "never_observed":
      obj(v.binding, "binding");
      return v as unknown as ContinuityView;
    case "observed":
      break;
    default:
      return bad("state");
  }
  iso(v.served_at, "served_at");
  iso(v.observed_at, "observed_at");
  int(v.stale_after_ms, "stale_after_ms");
  const block = obj(v.block, "block");
  dec(block.height, "block height");
  str(block.hash, "block hash");
  const hw = obj(v.high_water, "high_water");
  dec(hw.block_height, "high-water height");
  dec(hw.control_seq, "high-water sequence");
  const c = obj(v.control, "control");
  str(c.owner, "owner");
  int(c.generation, "generation");
  dec(c.control_seq, "control_seq");
  dec(c.manifest_seq, "manifest_seq");
  list(c.operators, "operators");
  if (c.live_deal !== null) {
    const d = obj(c.live_deal, "live deal");
    for (const k of ["seq", "price", "escrow", "expires_at_ms", "deadline_ms"])
      dec(d[k], `live deal ${k}`);
    int(d.version, "live deal version");
  }
  const t = obj(v.treasury, "treasury");
  str(t.asset, "asset");
  for (const k of [
    "held",
    "ent_free_value",
    "ent_held_value",
    "available",
    "withdrawable",
    "pending_total",
    "claims_total",
    "escrow_total",
  ])
    dec(t[k], `treasury ${k}`);
  for (const p of list(v.pending, "pending")) dec(obj(p, "payout").amount, "payout amount");
  for (const m of list(v.periods, "periods")) {
    const p = obj(m, "month");
    int(p.yyyymm, "month");
    iso(p.observed_at, "month observed_at");
    dec(obj(p.block, "month block").height, "month height");
    if (p.period !== null)
      for (const [k, x] of Object.entries(obj(p.period, "month counters"))) {
        if (k === "yyyymm") continue;
        const counter = obj(x, `counter ${k}`);
        dec(counter.amount, `counter ${k}`);
        if (typeof counter.exact !== "boolean") bad(`counter ${k} exactness`);
      }
  }
  for (const o of list(v.outcomes, "outcomes")) {
    const x = obj(o, "outcome");
    for (const k of ["seq", "price", "escrow_returned", "at_ms", "observed_from_block"])
      dec(x[k], `outcome ${k}`);
  }
  const h = obj(v.history, "history");
  dec(h.missing_count, "missing count");
  list(h.first_missing, "first missing");
  return v as unknown as Observed;
}

// ---------- the refresh answer (job 003j1) ----------

/** What a completed (non-refused) refresh can say; each carries the resulting view. */
const OBSERVATION_OUTCOMES = [
  "accepted",
  "duplicate",
  "stale",
  "conflict",
  "contradictory",
  "source_changed",
] as const;
const PERIOD_OUTCOMES = ["accepted", "duplicate", "stale", "conflict", "not_recorded"] as const;

export type ValidRefresh =
  | { outcome: "refused"; code: string; message: string }
  | {
      outcome: (typeof OBSERVATION_OUTCOMES)[number];
      message: string;
      period: { yyyymm: number; outcome: (typeof PERIOD_OUTCOMES)[number] } | null;
      view: Observed;
    };

/**
 * Checks a whole refresh answer before anything is announced: a supported outcome, a text
 * message, a refusal's code, a completed observation's (valid, observed) view, and any month
 * result. Throws MalformedView otherwise; nothing unknown is cast and trusted.
 */
export function parseRefreshAnswer(raw: unknown): ValidRefresh {
  const r = obj(raw, "the refresh answer");
  const message = str(r.message, "the refresh message");
  if (r.outcome === "refused")
    return { outcome: "refused", code: str(r.code, "the refusal code"), message };
  const outcome = r.outcome as (typeof OBSERVATION_OUTCOMES)[number];
  if (typeof r.outcome !== "string" || !OBSERVATION_OUTCOMES.includes(outcome))
    bad("the refresh outcome");
  const view = parseView(r.view);
  if (view.state !== "observed") bad("the view after a refresh");
  let period: { yyyymm: number; outcome: (typeof PERIOD_OUTCOMES)[number] } | null = null;
  if (r.period !== undefined && r.period !== null) {
    const p = obj(r.period, "the month result");
    const m = int(p.yyyymm, "the month");
    const po = p.outcome as (typeof PERIOD_OUTCOMES)[number];
    if (m < 197_001 || m > 999_912 || m % 100 < 1 || m % 100 > 12) bad("the month");
    if (typeof p.outcome !== "string" || !PERIOD_OUTCOMES.includes(po)) bad("the month outcome");
    period = { yyyymm: m, outcome: po };
  }
  return { outcome, message, period, view: view as Observed };
}

// ---------- display helpers (strings in, strings out) ----------

/** "400000000000000000000" → "400,000,000,000,000,000,000"; exact, never rounded. */
export function groupDigits(s: string): string {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A month 202611 → "November 2026". */
export function monthLabel(yyyymm: number): string {
  const y = Math.floor(yyyymm / 100);
  const m = yyyymm % 100;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** A millisecond timestamp held as a decimal string, as a date (null when it is 0, i.e. unset). */
export function msDate(ms: string): string | null {
  if (ms === "0" || ms.length > 15) return ms === "0" ? null : `${ms} ms`;
  return new Date(Number(ms)).toISOString();
}

// ---------- calls ----------

async function call(path: string, method = "GET", body?: unknown): Promise<unknown> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok)
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data.code);
  return data;
}

export const continuityApi = {
  get: (businessId: string) => call(`/api/businesses/${encodeURIComponent(businessId)}/v3`),
  refresh: (businessId: string, body: { period?: number }) =>
    call(`/api/businesses/${encodeURIComponent(businessId)}/v3/refresh`, "POST", body),
};
