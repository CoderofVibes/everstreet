// Job 003q: the customer's product workspace talks only to the real customer-use routes
// (server/src/customerUse.ts). Every answer is checked before it is shown: unexpected shapes are
// refused as malformed, amounts and block heights stay decimal strings, and nothing private is
// written to storage or the URL here. Browser-side types only.

import { ApiError } from "./api.ts";
import type { SigningEnvelope } from "./customerEnvelope.ts";
import { parseToken, type TokenInfo } from "./TokenAmount.tsx";

export class MalformedAnswer extends Error {}

export interface OfferView {
  offer_id: string;
  offer_state: "active" | "retired";
  business: { name: string; slug: string };
  product: {
    /** The workflow engine takes a request form; an extraction product takes pasted text. */
    kind: "workflow" | "extraction";
    name: string;
    max_chars: number;
    fields: {
      key: string;
      label: string;
      type: string;
      required: boolean;
      max_chars?: number;
      options?: string[];
    }[];
    /** A workflow's stages, in order (empty for an extraction product). */
    stages: { key: string; label: string }[];
  };
  terms: {
    units_per_use: number;
    unit_price: string;
    asset: string;
    retention_days: number;
    network: string;
    contract: string;
    /** The token as read on the chain, or null (exact base units are shown). */
    token: TokenInfo | null;
  };
}

export type UseState =
  | "prepared"
  | "reserve_requested"
  | "reserve_unknown"
  | "reserved"
  | "refused"
  | "unresolved"
  | "cancelled"
  | "expired";

export type UnitState =
  /** 003q1: nothing held (prepared, cancelled, expired or refused). */
  | "not_held"
  /** 003q1: an authorization sent, not yet confirmed by the contract. */
  | "reservation_pending"
  | "reserved_awaiting_settlement"
  | "charge_pending"
  | "release_pending"
  | "charged"
  | "returned"
  | "conflict"
  | "unknown";

export interface ExecutionView {
  state: "running" | "completed" | "failed" | "cancelled" | "unknown";
  outcome: string | null;
  delivery: "pending" | "delivered" | "not_delivered";
  validated: boolean;
  delivered: boolean;
  fulfilled: boolean;
  failure: string | null;
  result: "pending" | "available" | "expired" | "unavailable" | "none";
  retention_until_ms: string | null;
}

export interface UnitsView {
  unit: UnitState;
  reason: string | null;
  source: {
    block: { height: string; hash: string; timestamp_ms: string };
    observed: { free: string | null; consumed: string | null };
  } | null;
  retryable: boolean;
}

/** What the request is now, composed by the server (003q1); `state`/`label` stay the protocol's. */
export interface Headline {
  title: string;
  detail: string;
}

export interface UseView {
  id: string;
  state: UseState;
  label: string;
  explanation: string;
  headline: Headline;
  /**
   * 003r1: for a request that ended unconfirmed, whether a new one for the same units may start:
   * "wait" until its authorization deadline, or "check" (a new request reads the contract first).
   */
  next_use: { state: "wait"; until_ms: string } | { state: "check"; until_ms: null } | null;
  offer: OfferView;
  reason: string | null;
  evidence_conflict: string | null;
  reservation: {
    hold_seq: number;
    serve_until_ms: string;
    settle_until_ms: string;
    sign_by_ms: string;
    customer_account: string;
  };
  input: { sha256: string; chars: number; retained: boolean };
  envelope: SigningEnvelope | null;
  execution: ExecutionView | null;
  units: UnitsView;
  created_at: string;
  updated_at: string;
}

export interface UseSummary {
  id: string;
  state: UseState;
  label: string;
  offer_id: string;
  business: { name: string; slug: string };
  product: { name: string };
  execution: { state: string; result: string; fulfilled: boolean; delivery: string } | null;
  unit: UnitState;
  headline: Headline;
  created_at: string;
}

export interface ResultField {
  key: string;
  label: string;
  required: boolean;
  value: string | boolean | null;
  note: string;
}
export interface ResultView {
  outcome: string | null;
  retention_until_ms: string;
  result: {
    outcome: string;
    fields: ResultField[];
    missing: string[];
    problems: string[];
    issues: string[];
    reason: string | null;
    /** A workflow request's first stage, when it was accepted. */
    stage: string | null;
  };
}

// ---------- strict checks ----------

const fail = (where: string): never => {
  throw new MalformedAnswer(`The answer wasn't in the expected form (${where}).`);
};
const obj = (v: unknown, where: string) =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : fail(where);
const str = (v: unknown, where: string) => (typeof v === "string" ? v : fail(where));
const dec = (v: unknown, where: string) =>
  typeof v === "string" && /^(0|[1-9][0-9]{0,38})$/.test(v) ? v : fail(where);
const int = (v: unknown, where: string) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : fail(where);
const bool = (v: unknown, where: string) => (typeof v === "boolean" ? v : fail(where));
const oneOf = <T extends string>(v: unknown, all: readonly T[], where: string): T =>
  typeof v === "string" && (all as readonly string[]).includes(v) ? (v as T) : fail(where);
const nullable = <T>(v: unknown, f: (x: unknown) => T) => (v === null ? null : f(v));

const USE_STATES = [
  "prepared",
  "reserve_requested",
  "reserve_unknown",
  "reserved",
  "refused",
  "unresolved",
  "cancelled",
  "expired",
] as const;
const UNIT_STATES = [
  "not_held",
  "reservation_pending",
  "reserved_awaiting_settlement",
  "charge_pending",
  "release_pending",
  "charged",
  "returned",
  "conflict",
  "unknown",
] as const;

function parseHeadline(raw: unknown): Headline {
  const h = obj(raw, "headline");
  return { title: str(h.title, "headline.title"), detail: str(h.detail, "headline.detail") };
}

export function parseOffer(raw: unknown): OfferView {
  const o = obj(raw, "offer");
  const b = obj(o.business, "offer.business");
  const p = obj(o.product, "offer.product");
  const t = obj(o.terms, "offer.terms");
  const fields = Array.isArray(p.fields) ? p.fields : fail("offer.product.fields");
  return {
    offer_id: str(o.offer_id, "offer.id"),
    offer_state: oneOf(o.offer_state, ["active", "retired"] as const, "offer.state"),
    business: { name: str(b.name, "business.name"), slug: str(b.slug, "business.slug") },
    product: {
      kind: p.kind === "workflow" ? "workflow" : "extraction",
      name: str(p.name, "product.name"),
      max_chars: int(p.max_chars, "product.max_chars"),
      fields: fields.slice(0, 40).map((f) => {
        const x = obj(f, "field");
        return {
          key: str(x.key, "field.key"),
          label: str(x.label, "field.label"),
          type: str(x.type, "field.type"),
          required: bool(x.required, "field.required"),
          ...(x.max_chars === undefined ? {} : { max_chars: int(x.max_chars, "field.max_chars") }),
          ...(Array.isArray(x.options)
            ? { options: x.options.slice(0, 40).map((o) => str(o, "field.option")) }
            : {}),
        };
      }),
      stages: (Array.isArray(p.stages) ? p.stages : []).slice(0, 12).map((st) => {
        const x = obj(st, "stage");
        return { key: str(x.key, "stage.key"), label: str(x.label, "stage.label") };
      }),
    },
    terms: {
      units_per_use: int(t.units_per_use, "terms.units"),
      unit_price: dec(t.unit_price, "terms.unit_price"),
      asset: str(t.asset, "terms.asset"),
      retention_days: int(t.retention_days, "terms.retention_days"),
      network: str(t.network, "terms.network"),
      contract: str(t.contract, "terms.contract"),
      token: parseToken(t.token),
    },
  };
}

function parseEnvelope(raw: unknown): SigningEnvelope {
  const e = obj(raw, "envelope");
  // Shape only here; the browser recomputes every byte before anything is authorized.
  for (const k of [
    "version",
    "request_id",
    "offer_id",
    "release_id",
    "artifact_digest",
    "network",
    "business_account",
    "customer_account",
    "reg_id",
    "public_key",
    "envelope_digest",
  ])
    str(e[k], `envelope.${k}`);
  for (const k of ["plan_id", "key_slot", "key_epoch"]) int(e[k], `envelope.${k}`);
  for (const k of ["hold", "use", "commitment", "consent"]) obj(e[k], `envelope.${k}`);
  return e as unknown as SigningEnvelope;
}

function parseExecution(raw: unknown): ExecutionView {
  const x = obj(raw, "execution");
  return {
    state: oneOf(
      x.state,
      ["running", "completed", "failed", "cancelled", "unknown"] as const,
      "execution.state",
    ),
    outcome: nullable(x.outcome, (v) => str(v, "execution.outcome")),
    delivery: oneOf(
      x.delivery,
      ["pending", "delivered", "not_delivered"] as const,
      "execution.delivery",
    ),
    validated: bool(x.validated, "execution.validated"),
    delivered: bool(x.delivered, "execution.delivered"),
    fulfilled: bool(x.fulfilled, "execution.fulfilled"),
    failure: nullable(x.failure, (v) => str(v, "execution.failure")),
    result: oneOf(
      x.result,
      ["pending", "available", "expired", "unavailable", "none"] as const,
      "execution.result",
    ),
    retention_until_ms: nullable(x.retention_until_ms, (v) => dec(v, "execution.retention")),
  };
}

function parseUnits(raw: unknown): UnitsView {
  const u = obj(raw, "units");
  const source = nullable(u.source, (v) => {
    const s = obj(v, "units.source");
    const b = obj(s.block, "units.source.block");
    const o = obj(s.observed, "units.source.observed");
    return {
      block: {
        height: dec(b.height, "units.block.height"),
        hash: str(b.hash, "units.block.hash"),
        timestamp_ms: dec(b.timestamp_ms, "units.block.time"),
      },
      observed: {
        free: nullable(o.free, (x) => dec(x, "units.free")),
        consumed: nullable(o.consumed, (x) => dec(x, "units.consumed")),
      },
    };
  });
  return {
    unit: oneOf(u.unit, UNIT_STATES, "units.unit"),
    reason: nullable(u.reason, (v) => str(v, "units.reason")),
    source,
    retryable: bool(u.retryable, "units.retryable"),
  };
}

export function parseUse(raw: unknown): UseView {
  const w = obj(obj(raw, "answer").use, "use");
  const r = obj(w.reservation, "reservation");
  const i = obj(w.input, "input");
  return {
    id: str(w.id, "use.id"),
    state: oneOf(w.state, USE_STATES, "use.state"),
    label: str(w.label, "use.label"),
    explanation: str(w.explanation, "use.explanation"),
    headline: parseHeadline(w.headline),
    next_use: nullable(w.next_use, (v) => {
      const n = obj(v, "use.next_use");
      if (n.state === "wait")
        return { state: "wait" as const, until_ms: dec(n.until_ms, "next_use.until_ms") };
      if (n.state === "check" && n.until_ms === null)
        return { state: "check" as const, until_ms: null };
      return fail("use.next_use");
    }),
    offer: parseOffer(w.offer),
    reason: nullable(w.reason, (v) => str(v, "use.reason")),
    evidence_conflict: nullable(w.evidence_conflict, (v) => str(v, "use.conflict")),
    reservation: {
      hold_seq: int(r.hold_seq, "reservation.hold_seq"),
      serve_until_ms: dec(r.serve_until_ms, "reservation.serve_until"),
      settle_until_ms: dec(r.settle_until_ms, "reservation.settle_until"),
      sign_by_ms: dec(r.sign_by_ms, "reservation.sign_by"),
      customer_account: str(r.customer_account, "reservation.account"),
    },
    input: {
      sha256: str(i.sha256, "input.sha256"),
      chars: int(i.chars, "input.chars"),
      retained: bool(i.retained, "input.retained"),
    },
    envelope: nullable(w.envelope, parseEnvelope),
    execution: nullable(w.execution, parseExecution),
    units: parseUnits(w.units),
    created_at: str(w.created_at, "use.created_at"),
    updated_at: str(w.updated_at, "use.updated_at"),
  };
}

export function parseUses(raw: unknown): UseSummary[] {
  const list = obj(raw, "answer").uses;
  if (!Array.isArray(list)) return fail("uses");
  return list.slice(0, 50).map((u) => {
    const x = obj(u, "summary");
    const b = obj(x.business, "summary.business");
    const p = obj(x.product, "summary.product");
    const e = nullable(x.execution, (v) => {
      const o = obj(v, "summary.execution");
      return {
        state: str(o.state, "summary.execution.state"),
        result: str(o.result, "summary.execution.result"),
        fulfilled: bool(o.fulfilled, "summary.execution.fulfilled"),
        delivery: str(o.delivery, "summary.execution.delivery"),
      };
    });
    return {
      id: str(x.id, "summary.id"),
      state: oneOf(x.state, USE_STATES, "summary.state"),
      label: str(x.label, "summary.label"),
      offer_id: str(x.offer_id, "summary.offer"),
      business: {
        name: str(b.name, "summary.business.name"),
        slug: str(b.slug, "summary.business.slug"),
      },
      product: { name: str(p.name, "summary.product.name") },
      execution: e,
      unit: oneOf(x.unit, UNIT_STATES, "summary.unit"),
      headline: parseHeadline(x.headline),
      created_at: str(x.created_at, "summary.created_at"),
    };
  });
}

export function parseResult(raw: unknown): ResultView {
  const o = obj(raw, "answer");
  const r = obj(o.result, "result");
  const fields = Array.isArray(r.fields) ? r.fields : fail("result.fields");
  const list = (v: unknown, where: string) =>
    Array.isArray(v) ? v.slice(0, 50).map((x) => str(x, where)) : [];
  return {
    outcome: nullable(o.outcome, (v) => str(v, "result.outcome")),
    retention_until_ms: dec(o.retention_until_ms, "result.retention"),
    result: {
      outcome: str(r.outcome, "result.outcome"),
      fields: fields.slice(0, 60).map((f) => {
        const x = obj(f, "result.field");
        return {
          key: str(x.key, "result.field.key"),
          label: str(x.label, "result.field.label"),
          // A workflow request's fields are all required, and its answer doesn't repeat it.
          required: x.required === undefined ? true : bool(x.required, "result.field.required"),
          value:
            x.value === null || typeof x.value === "boolean"
              ? x.value
              : str(x.value, "result.field.value"),
          note: typeof x.note === "string" ? x.note : "",
        };
      }),
      missing: list(r.missing, "result.missing"),
      problems: list(r.problems, "result.problems"),
      issues: list(r.issues, "result.issues"),
      reason: nullable(r.reason ?? null, (v) => str(v, "result.reason")),
      stage: nullable(r.stage ?? null, (v) => str(v, "result.stage")),
    },
  };
}

// ---------- requests ----------

export async function call(path: string, method = "GET", body?: unknown): Promise<unknown> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as {
    error?: string;
    code?: string;
    detail?: unknown;
  } | null;
  if (!res.ok)
    throw new ApiError(
      res.status,
      data?.error ?? `Request failed (${res.status})`,
      data?.code,
      data?.detail && typeof data.detail === "object" && !Array.isArray(data.detail)
        ? (data.detail as Record<string, unknown>)
        : undefined,
    );
  if (data === null) throw new MalformedAnswer("The answer wasn't readable.");
  return data;
}

/** The port the workspace controller uses; tests pass their own over the real app. */
export interface CustomerPort {
  offer(offerId: string): Promise<unknown>;
  use(id: string): Promise<unknown>;
  uses(): Promise<unknown>;
  /** 003q1: the caller's own request under an exact opaque key (reload recovery). */
  byKey(key: string): Promise<unknown>;
  prepare(
    offerId: string,
    body: { idempotency_key: string; input: string; key_slot?: number },
  ): Promise<unknown>;
  confirm(
    id: string,
    body: { envelope_digest: string; hold_signature: string; use_signature: string },
  ): Promise<unknown>;
  cancel(id: string): Promise<unknown>;
  reconcile(id: string): Promise<unknown>;
  execute(id: string, body: { input?: string }): Promise<unknown>;
  result(id: string): Promise<unknown>;
  units(id: string): Promise<unknown>;
  release(id: string): Promise<unknown>;
}

export const customerHttp: CustomerPort = {
  offer: (id) => call(`/api/public/customer-offers/${encodeURIComponent(id)}`),
  use: (id) => call(`/api/customer/uses/${encodeURIComponent(id)}`),
  uses: () => call("/api/customer/uses?limit=20"),
  byKey: (key) => call(`/api/customer/requests/by-key/${encodeURIComponent(key)}`),
  prepare: (offerId, body) =>
    call(`/api/customer/offers/${encodeURIComponent(offerId)}/prepare`, "POST", body),
  confirm: (id, body) => call(`/api/customer/uses/${encodeURIComponent(id)}/confirm`, "POST", body),
  cancel: (id) => call(`/api/customer/uses/${encodeURIComponent(id)}/cancel`, "POST"),
  reconcile: (id) => call(`/api/customer/uses/${encodeURIComponent(id)}/reconcile`, "POST"),
  execute: (id, body) => call(`/api/customer/uses/${encodeURIComponent(id)}/execute`, "POST", body),
  result: (id) => call(`/api/customer/uses/${encodeURIComponent(id)}/result`),
  units: (id) => call(`/api/customer/uses/${encodeURIComponent(id)}/units/reconcile`, "POST"),
  release: (id) => call(`/api/customer/uses/${encodeURIComponent(id)}/release`, "POST"),
};

/** Public offers of a published business (its page's "Use this product" section). */
export async function businessOffers(slug: string): Promise<OfferView[]> {
  const raw = obj(
    await call(`/api/public/businesses/${encodeURIComponent(slug)}/customer-offers`),
    "answer",
  );
  if (!Array.isArray(raw.offers)) return fail("offers");
  return raw.offers.slice(0, 10).map(parseOffer);
}

export async function myUses(): Promise<UseSummary[]> {
  return parseUses(await call("/api/customer/uses?limit=20"));
}
