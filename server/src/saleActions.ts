// Job 003wf2 (docs/design/DIRECT_SALE.md): a Direct sale through each participant's own wallet.
// The server reads and verifies only; it never signs or sends. Every request it prepares is one
// exact FunctionCall the participant's own wallet signs.
//
// - Prepare: one pinned final read (control, outcomes, treasury, pending, the viewer's party
//   record, the contract's declared sale terms, the token) and the exact call with its digest.
// - Create: a fresh read must reproduce the same digest; the row (and, for a proposal or a
//   revision, its immutable terms document) is stored in one BEGIN IMMEDIATE transaction under the
//   admission rule (§5): an open prepared row is returned for recovery; an asked one admits a new
//   action only with the same exclusivity identity and an explicit `replaces`.
// - Requested: the wallet ask is durable BEFORE the wallet is invoked; the hash after it answers.
// - Check: only THIS action's own FINAL transaction resolves it, through its exact receipt graph.
//   A readback never confirms one; it can only show that the request can no longer take effect.
// - Effects: a confirmed proposal or revision records that exact version through V3Intents; a
//   confirmed closing acceptance runs the existing reconciliation for that participant. Ownership
//   is never written here.

import { createHash, randomUUID } from "node:crypto";
import {
  type TokenMeta,
  validMetadata,
  u128 as validU128,
  type WalletCall,
} from "./customerPurchase.ts";
import type { CustomerViewTransport, PinnedBlock } from "./customerRead.ts";
import type { Db } from "./db.ts";
import { armHandover, latestHandover } from "./handover.ts";
import type { ReadinessSigner } from "./readiness.ts";
import {
  abortCall,
  acceptCall,
  appointCall,
  CLAIM_ESCROW_RETURN,
  CLAIM_PROFIT,
  CLAIM_SALE_PROCEEDS,
  canonicalTerms,
  claimCall,
  claimOf,
  createPlanCall,
  dealDigest,
  dealStepCall,
  decodeParty,
  decodePlanTerms,
  decodeSaleTerms,
  exclusivity,
  fundCall,
  INCLUDED,
  METERING,
  NOT_INCLUDED,
  offerWindow,
  type PartyV3,
  type PlanInputV3,
  type PlanTermsV3,
  proposeCall,
  readableAmount,
  registerCall,
  reviseCall,
  SALE_KINDS,
  type SaleKind,
  type SaleTermsV3,
  SUPPORT,
  sha256hex,
  type TermsDoc,
  termsArg,
  validSellerText,
} from "./saleTerms.ts";
import { HttpError, type Person, type Store } from "./store.ts";
import { recordTokenMeta } from "./tokenMeta.ts";
import type { V3Intents } from "./v3intents.ts";
import type { V3Observations } from "./v3observe.ts";
import {
  type ControlV3,
  checkBlock,
  coherent,
  decodeControl,
  decodeOutcomes,
  decodePending,
  decodeTreasury,
  isAccountId,
  type OutcomeV3,
  type PendingV3,
  type TreasuryV3,
  V3ReadError,
} from "./v3read.ts";

type Viewer = Pick<Person, "id">;
const KEY = /^[A-Za-z0-9_-]{8,80}$/;
const TX_HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const DAY_MS = 86_400_000n;
const MAX_RESULT = 64 * 1024;

const bad = (status: number, message: string, code?: string, detail?: unknown): never => {
  throw new HttpError(status as 400, message, code, detail as never);
};
const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

type State =
  | "prepared"
  | "requested"
  | "unknown"
  | "confirmed"
  | "refused"
  | "no_longer_possible"
  | "set_aside";
const OPEN: State[] = ["prepared", "requested", "unknown"];
/**
 * Kinds whose guard admits at most one success among identical requests (DIRECT_SALE.md §5):
 * control_seq and payout_seq only rise. Not accept (unfund clears an acceptance without a new
 * version) and not register (the token can unregister): those are recovered by their own
 * transaction only.
 */
const EXCLUSIVE = new Set<SaleKind>([
  "propose",
  "revise",
  "fund",
  "unfund",
  "cancel",
  "expire",
  "appoint",
  "claim",
  "abort",
  "create_plan",
]);
/** States a check may still resolve by the action's own transaction. */
const CHECKABLE: State[] = ["prepared", "requested", "unknown", "no_longer_possible"];
const CHECKABLE_SQL = `state IN (${CHECKABLE.map((s) => `'${s}'`).join(",")})`;

export interface SaleActionRow {
  id: string;
  business_id: string;
  person_id: string;
  account: string;
  network: string;
  contract: string;
  asset: string;
  kind: SaleKind;
  identity: string;
  deal_seq: string | null;
  version: number | null;
  call: string;
  action_digest: string;
  review: string;
  terms_id: string | null;
  replaces: string | null;
  idempotency_key: string;
  state: State;
  tx_hash: string | null;
  asks: number;
  evidence: string | null;
  effects: string | null;
  /** Rises with every update: a compare-and-set names the revision it read. */
  rev: number;
  /** The winning ask claimant's id (its retry after a lost answer is answered the same). */
  ask_id: string | null;
  created_at: string;
  updated_at: string;
}

export function migrateSaleActions(db: Db) {
  const existing = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sale_actions'")
    .get() as { sql: string } | undefined;
  if (existing && SALE_KINDS.some((k) => !existing.sql.includes(`'${k}'`))) {
    // Jobs 003wf3 (abort) and 003wf4 (create_plan): a new kind. SQLite can't alter a CHECK, so
    // the table is copied once, every row kept as it was.
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec("ALTER TABLE sale_actions RENAME TO sale_actions_before_kinds");
      db.exec("DROP INDEX IF EXISTS sale_actions_by_business");
      db.exec(saleActionsTable());
      db.exec("INSERT INTO sale_actions SELECT * FROM sale_actions_before_kinds");
      db.exec("DROP TABLE sale_actions_before_kinds");
      db.exec("COMMIT");
    } catch (e) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw e;
    }
  }
  db.exec(saleActionsTable());
  db.exec(saleTermsDocsTable());
}

function saleActionsTable() {
  return `
    CREATE TABLE IF NOT EXISTS sale_actions (
      id TEXT PRIMARY KEY, business_id TEXT NOT NULL, person_id TEXT NOT NULL, account TEXT NOT NULL,
      network TEXT NOT NULL, contract TEXT NOT NULL, asset TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN (${SALE_KINDS.map((k) => `'${k}'`).join(",")})),
      identity TEXT NOT NULL, deal_seq TEXT, version INTEGER,
      call TEXT NOT NULL, action_digest TEXT NOT NULL, review TEXT NOT NULL,
      terms_id TEXT, replaces TEXT, idempotency_key TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('prepared','requested','unknown','confirmed','refused','no_longer_possible','set_aside')),
      tx_hash TEXT, asks INTEGER NOT NULL DEFAULT 0, evidence TEXT, effects TEXT,
      rev INTEGER NOT NULL DEFAULT 0, ask_id TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE (person_id, idempotency_key)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS sale_actions_by_business ON sale_actions (business_id, account, state);
  `;
}

function saleTermsDocsTable() {
  return `
    CREATE TABLE IF NOT EXISTS sale_terms_docs (
      id TEXT PRIMARY KEY, business_id TEXT NOT NULL, hash TEXT NOT NULL, text TEXT NOT NULL,
      seller_person_id TEXT NOT NULL, buyer_person_id TEXT NOT NULL, buyer_account TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (business_id, hash)
    ) STRICT;
  `;
}

// ---------- one pinned reading ----------

export interface SaleReading {
  block: PinnedBlock;
  control: ControlV3;
  outcomes: OutcomeV3[];
  treasury: TreasuryV3;
  pending: PendingV3[];
  /** The viewer's own party record. */
  party: PartyV3 | null;
  /** The contract's declared sale terms (for `termsFor`); null on code without them. */
  terms: SaleTermsV3 | null;
  /**
   * Job 003wf4: the guarded plan-creation terms, when asked for; null on code without them
   * (guided plans are then unavailable), undefined when not read.
   */
  plan_terms?: PlanTermsV3 | null;
  token: {
    meta: TokenMeta | null;
    balance: string | null;
    registered: boolean;
    business_registered: boolean;
    storage_min: string | null;
  };
}

/** The resolution of one action's own transaction (or what a readback can say). */
export type SaleResolution =
  | { kind: "confirmed"; result: string; message: string }
  | { kind: "refused"; reason: string; message: string }
  | { kind: "unknown"; message: string }
  | { kind: "no_longer_possible"; message: string };

type Receipt = {
  executor_id?: unknown;
  logs?: unknown[];
  receipt_ids?: unknown[];
  status?: Record<string, unknown>;
};
/** Affirmative, well-formed success: exactly { SuccessValue: <string> }. */
const succeeded = (r: Receipt | undefined) =>
  Boolean(
    r?.status &&
      typeof r.status === "object" &&
      !Array.isArray(r.status) &&
      Object.keys(r.status).length === 1 &&
      typeof r.status.SuccessValue === "string",
  );
/** Affirmative, well-formed failure: exactly { Failure: <object> }. */
const failedReceipt = (r: Receipt | undefined) =>
  Boolean(
    r?.status &&
      typeof r.status === "object" &&
      !Array.isArray(r.status) &&
      Object.keys(r.status).length === 1 &&
      typeof r.status.Failure === "object" &&
      r.status.Failure !== null,
  );
const receiptValue = (r: Receipt | undefined): unknown => {
  try {
    const raw = Buffer.from(String(r?.status?.SuccessValue ?? ""), "base64").toString("utf8");
    return raw === "" ? undefined : JSON.parse(raw);
  } catch {
    return Symbol("malformed");
  }
};
/**
 * A gas refund the runtime appends to a receipt's children (Astra's addendum): executed for the
 * signer (or the system), an empty success, no logs, nothing further. It proves nothing itself.
 */
const isRefund = (r: Receipt, signer: string) =>
  (r.executor_id === signer || r.executor_id === "system") &&
  succeeded(r) &&
  r.status?.SuccessValue === "" &&
  (r.logs ?? []).length === 0 &&
  (r.receipt_ids ?? []).length === 0;
const failureText = (r: Receipt | undefined) =>
  failedReceipt(r) ? JSON.stringify(r?.status?.Failure).slice(0, 400) : null;
function eventsOf(r: Receipt | undefined, name: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const log of r?.logs ?? []) {
    if (typeof log !== "string" || !log.startsWith("EVENT_JSON:")) continue;
    try {
      const e = JSON.parse(log.slice(11)) as {
        standard?: string;
        event?: string;
        data?: Record<string, unknown>[];
      };
      if (e.standard === "business_core" && e.event === name && e.data?.[0]) out.push(e.data[0]);
    } catch {}
  }
  return out;
}
const REASON = /E_[A-Z_]+/;

/**
 * One FINAL transaction, checked to be EXACTLY this action's request, then its receipt graph
 * (DIRECT_SALE.md §5.1). Anything else (a non-final answer, another request, a status that merely
 * lacks a Failure, a missing or disconnected receipt) is no evidence: null.
 */
export function resolveSaleTx(
  p: SaleActionRow,
  r: unknown,
  hash: string | null = p.tx_hash,
): SaleResolution | null {
  const o = r as {
    final_execution_status?: unknown;
    status?: Record<string, unknown>;
    transaction?: {
      hash?: unknown;
      signer_id?: unknown;
      receiver_id?: unknown;
      actions?: unknown[];
    };
    transaction_outcome?: { id?: unknown; outcome?: Receipt };
    receipts_outcome?: { id?: unknown; outcome?: Receipt }[];
  } | null;
  if (o?.final_execution_status !== "FINAL" || !hash) return null;
  const call = JSON.parse(p.call) as WalletCall;
  const review = JSON.parse(p.review) as Record<string, unknown>;
  const t = o.transaction;
  if (!t || t.hash !== hash || t.signer_id !== p.account || t.receiver_id !== call.receiverId)
    return null;
  if (!Array.isArray(t.actions) || t.actions.length !== 1) return null;
  const fc = (t.actions[0] as { FunctionCall?: Record<string, unknown> })?.FunctionCall;
  if (
    fc?.method_name !== call.methodName ||
    String(fc.deposit) !== call.deposit ||
    String(fc.gas) !== call.gas
  )
    return null;
  let args: unknown;
  try {
    args = JSON.parse(Buffer.from(String(fc.args), "base64").toString("utf8"));
  } catch {
    return null;
  }
  if (JSON.stringify(args) !== JSON.stringify(call.args)) return null;
  if (o.transaction_outcome?.id !== hash) return null;
  const byId = new Map<string, Receipt>();
  for (const x of o.receipts_outcome ?? []) {
    if (typeof x.id !== "string" || !x.outcome) return null;
    // A receipt id appearing twice makes the graph ambiguous: no evidence.
    if (byId.has(x.id)) return null;
    byId.set(x.id, x.outcome);
  }
  const firstIds = o.transaction_outcome?.outcome?.receipt_ids;
  if (!Array.isArray(firstIds) || firstIds.length !== 1) return null;
  const first = byId.get(String(firstIds[0]));
  if (!first || first.executor_id !== call.receiverId) return null;
  const top = o.status;
  const topOk =
    top &&
    typeof top === "object" &&
    !Array.isArray(top) &&
    Object.keys(top).length === 1 &&
    typeof top.SuccessValue === "string";
  const refused = (why: string | null): SaleResolution | null => {
    // A contract refusal rolls the receipt back: definitive for this transaction (each row is
    // asked at most once; another request is another row with its own transaction).
    if (!failedReceipt({ status: top }) || !why) return null;
    const code = REASON.exec(why)?.[0] ?? "refused";
    return {
      kind: "refused",
      reason: code,
      message: `The contract refused this request (${code}); nothing changed.`,
    };
  };

  if (p.kind === "register") {
    if (!succeeded(first)) return refused(failureText(first));
    return topOk
      ? { kind: "confirmed", result: "registered", message: "Registered with the token." }
      : null;
  }

  if (p.kind === "fund") {
    // The token's transfer, the business's receiver outcome and the token's resolution.
    if (failedReceipt(first)) return refused(failureText(first));
    // The token's transfer returns its resolution promise: exactly { SuccessReceiptId }.
    const fst = first.status;
    if (!fst || Object.keys(fst).length !== 1 || typeof fst.SuccessReceiptId !== "string")
      return null;
    const ids = (first.receipt_ids ?? []).map(String);
    if (new Set(ids).size !== ids.length) return null;
    const kids = ids.map((id) => ({ id, r: byId.get(id) }));
    // Exactly one receiver outcome and one resolution; any other child must be a refund.
    const receivers = kids.filter((k) => k.r?.executor_id === p.contract);
    const resolutions = kids.filter((k) => k.r?.executor_id === p.asset);
    if (receivers.length !== 1 || resolutions.length !== 1) return null;
    if (fst.SuccessReceiptId !== resolutions[0]?.id) return null;
    if (
      kids.some(
        (k) =>
          !k.r ||
          (k.r.executor_id !== p.contract &&
            k.r.executor_id !== p.asset &&
            !isRefund(k.r, p.account)),
      )
    )
      return null;
    const receiver = receivers[0]?.r;
    const resolution = resolutions[0]?.r;
    if (!receiver || !resolution || !succeeded(receiver) || !succeeded(resolution) || !topOk)
      return null;
    const unused = receiptValue(receiver);
    const used = receiptValue(resolution);
    if (used !== receiptValue({ status: top })) return null;
    const price = String(review.price);
    const funded = eventsOf(receiver, "sale_funded").find(
      (d) => d.deal_seq === p.deal_seq && d.amount === price,
    );
    if (funded && unused === "0" && used === price)
      return {
        kind: "confirmed",
        result: "funded",
        message: "Escrow is funded: the contract holds the price for this deal.",
      };
    const back = eventsOf(receiver, "funding_returned").find(
      (d) => d.sender === p.account && d.amount === price,
    );
    if (back && unused === price && used === "0") {
      return {
        kind: "refused",
        reason: String(back.reason ?? "returned"),
        message: `The contract returned the whole amount to you (${String(back.reason ?? "returned")}); escrow is not funded by this transaction.`,
      };
    }
    return null;
  }

  // A claim returns its transfer.then(on_payout) promise: its own result is the callback's.
  if (p.kind === "claim") return resolveClaim(p, review, first, byId, top, refused);

  // The business's own methods.
  if (!succeeded(first)) return refused(failureText(first));
  if (!topOk) return null;
  const seq = p.deal_seq;
  switch (p.kind) {
    case "propose": {
      const ok = eventsOf(first, "sale_proposed").some(
        (d) =>
          d.deal_seq === review.deal_seq && d.buyer === review.buyer && d.price === review.price,
      );
      return ok && receiptValue(first) === review.deal_seq
        ? {
            kind: "confirmed",
            result: "proposed",
            message: `Deal ${String(review.deal_seq)} is proposed on the contract with these exact terms.`,
          }
        : null;
    }
    case "revise": {
      const ok = eventsOf(first, "sale_revised").some(
        (d) => d.deal_seq === seq && d.version === review.next_version,
      );
      return ok
        ? {
            kind: "confirmed",
            result: "revised",
            message: `Deal ${seq} is now version ${String(review.next_version)}; earlier acceptances are cleared.`,
          }
        : null;
    }
    case "accept": {
      const v = receiptValue(first);
      if (
        v === "accepted" &&
        eventsOf(first, "sale_accepted").some((d) => d.deal_seq === seq && d.by === p.account)
      )
        return {
          kind: "confirmed",
          result: "accepted",
          message: "Your acceptance of this exact version is recorded on the contract.",
        };
      if (
        v === "closing" &&
        eventsOf(first, "sale_accepted").some(
          (d) => d.deal_seq === seq && d.by === p.account && d.closing === true,
        )
      )
        return {
          kind: "confirmed",
          result: "closing",
          message:
            "Both acceptances matched: the sale is closing. Everstreet is checking the handover; ownership changes only when the contract closes it.",
        };
      if (
        v === "closed" &&
        eventsOf(first, "sale_finalized").some(
          (d) => d.deal_seq === seq && d.buyer === review.buyer && d.price === review.price,
        )
      )
        return {
          kind: "confirmed",
          result: "closed",
          message:
            "Both acceptances matched: the contract closed the sale. The buyer now controls the business on NEAR.",
        };
      return null;
    }
    case "unfund":
      return eventsOf(first, "sale_unfunded").some(
        (d) => d.deal_seq === seq && d.amount === review.escrow,
      )
        ? {
            kind: "confirmed",
            result: "unfunded",
            message: "Your escrow is now a returned-escrow claim you can collect.",
          }
        : null;
    case "cancel":
    case "expire": {
      const status = p.kind === "cancel" ? 2 : 3;
      return eventsOf(first, "sale_ended").some((d) => d.deal_seq === seq && d.status === status)
        ? {
            kind: "confirmed",
            result: p.kind === "cancel" ? "cancelled" : "expired",
            message: `Deal ${seq} ended (${p.kind === "cancel" ? "cancelled" : "expired"}). Any escrow is the buyer's claim to collect.`,
          }
        : null;
    }
    case "abort":
      return eventsOf(first, "sale_ended").some((d) => d.deal_seq === seq && d.status === 4)
        ? {
            kind: "confirmed",
            result: "aborted",
            message: `Deal ${seq}'s closing ended (aborted). The seller keeps the business; the buyer's escrow is their claim to collect.`,
          }
        : null;
    case "appoint": {
      // Job 003wf4: exactly the reviewed mask (older rows reviewed METERING alone).
      const caps = typeof review.caps === "number" ? review.caps : METERING;
      return eventsOf(first, "operator_appointed").some(
        (d) => d.account === review.operator && d.caps === caps,
      )
        ? {
            kind: "confirmed",
            result: "appointed",
            message: `The platform's account holds ${capsName(caps)} for this owner. Whether customers can be served now is shown separately.`,
          }
        : null;
    }
    case "owner_probe":
      // It should have been refused above. If the contract allowed it, say so plainly.
      return eventsOf(first, "operator_appointed").some((d) => d.account === review.operator)
        ? {
            kind: "confirmed",
            result: "allowed",
            message:
              "The contract accepted it: this account was appointed as an operator. That shouldn't be possible for a former owner.",
          }
        : null;
    case "create_plan": {
      // Its own receipt returns the reviewed plan id and names it with the reviewed price. The
      // check then reads the plan back before this counts (SaleActions.check).
      const plan = review.plan as PlanInputV3;
      return receiptValue(first) === review.plan_id &&
        eventsOf(first, "plan_created").some(
          (d) => d.plan_id === review.plan_id && d.unit_price === plan.unit_price,
        )
        ? {
            kind: "confirmed",
            result: "created",
            message: `Plan ${String(review.plan_id)} was created by this request's own transaction.`,
          }
        : null;
    }
  }
  return null;
}

/**
 * A claim's receipt graph (DIRECT_SALE.md §5.1): the claim receipt's status names the callback
 * receipt it created (SuccessReceiptId); it started a payout to this account for exactly the
 * reviewed amount; the callback (the business) settled that same slot and payout id; the token's
 * transfer receipt agrees with the callback's result; the transaction's own value is the
 * callback's. A missing callback is pending (unknown); anything contradictory is no evidence.
 */
function resolveClaim(
  p: SaleActionRow,
  review: Record<string, unknown>,
  first: Receipt,
  byId: Map<string, Receipt>,
  top: Record<string, unknown> | undefined,
  refused: (why: string | null) => SaleResolution | null,
): SaleResolution | null {
  if (failedReceipt(first)) return refused(failureText(first));
  const st = first.status;
  if (!st || Object.keys(st).length !== 1 || typeof st.SuccessReceiptId !== "string") return null;
  const cbId = st.SuccessReceiptId;
  const kids = (first.receipt_ids ?? []).map(String);
  if (new Set(kids).size !== kids.length || !kids.includes(cbId)) return null;
  // Exactly one callback (the business: the named one) and one token transfer; any other child
  // must be an unambiguous gas refund (the runtime may append them).
  const present = kids.filter((k) => byId.has(k)).map((k) => ({ k, r: byId.get(k) as Receipt }));
  const callbacks = present.filter((x) => x.r.executor_id === p.contract);
  const transfers = present.filter((x) => x.r.executor_id === p.asset);
  if (callbacks.length > 1 || transfers.length !== 1) return null;
  if (callbacks.length === 1 && callbacks[0]?.k !== cbId) return null;
  if (
    present.some(
      (x) =>
        x.r.executor_id !== p.contract && x.r.executor_id !== p.asset && !isRefund(x.r, p.account),
    )
  )
    return null;
  const transferId = transfers[0]?.k as string;
  const started = eventsOf(first, "payout_started").filter(
    (d) => d.to === p.account && d.amount === review.amount,
  );
  if (started.length !== 1) return null;
  const s0 = started[0] as Record<string, unknown>;
  const cb = byId.get(cbId);
  const transfer = byId.get(transferId);
  if (!cb)
    return {
      kind: "unknown",
      message:
        "The payout started, but its outcome isn't in this transaction yet. The contract lists it as in flight; nothing is called paid until its callback is seen.",
    };
  if (cb.executor_id !== p.contract || !succeeded(cb)) return null;
  if (!transfer || transfer.executor_id !== p.asset || !transfer.status) return null;
  const settled = eventsOf(cb, "payout_settled").filter(
    (d) => d.payout_id === s0.payout_id && d.slot === s0.slot && d.amount === s0.amount,
  );
  if (settled.length !== 1) return null;
  const ok = (settled[0] as Record<string, unknown>).ok;
  const value = receiptValue(cb);
  const topValue =
    top && Object.keys(top).length === 1 && typeof top.SuccessValue === "string"
      ? receiptValue({ status: top })
      : Symbol("no value");
  // The transfer's own outcome, affirmatively: an empty, unknown or two-sided status proves nothing.
  const transferOk = succeeded(transfer) ? true : failedReceipt(transfer) ? false : null;
  if (transferOk === null || value !== ok || topValue !== value) return null;
  if (value === true && transferOk)
    return {
      kind: "confirmed",
      result: "paid",
      message:
        "Paid: the token transferred it to your account and the contract settled the payout.",
    };
  if (value === false && !transferOk)
    return {
      kind: "confirmed",
      result: "restored",
      message:
        "The transfer failed, so nothing was paid: the contract put the amount back as your claim, in the same category.",
    };
  return null;
}

const CATEGORY_NAMES: Record<number, string> = {
  [CLAIM_PROFIT]: "operating profit",
  [CLAIM_ESCROW_RETURN]: "returned escrow",
  [CLAIM_SALE_PROCEEDS]: "sale proceeds",
};

export interface SaleOptions {
  /** The platform's metering account (operatorAccount): named in terms by default. */
  platformOperator?: string | null;
  /**
   * Job 003wf3 (MANAGED_HANDOVER.md §16.3): whether this installation can manage a Gated close
   * for the business now (a validated closer key, the contract's guard, no incompatible peer).
   * Absent: never (a Gated acceptance that would enter Closing is refused).
   */
  handover?: (businessId: string) => Promise<{ ready: boolean; reason: string | null }>;
  /** Job 003wf3 (D4): whether customers can actually be served now, from the real checks. */
  serviceReadiness?: (
    businessId: string,
    control: ControlV3,
  ) => { eligible: boolean; reasons: string[]; note: string };
  /**
   * Job 003wf4 (OWNER_PLAN_SETUP.md §5): whether THIS server can serve a plan's holds under its
   * current configuration (CustomerUses.planUsability). Absent: guided plans are unavailable.
   */
  planUsability?: (plan: { hold_ttl_ms: string; settle_grace_ms: string }) => {
    usable: boolean;
    reason: string | null;
    min_hold_ms: number;
    min_grace_ms: number;
    grace_ok: boolean;
  };
  readTimeoutMs?: number;
  now?: () => number;
  /** The Closing Ledger: what is still in flight for a business (CustomerUses.handoverInventory). */
  inventory?: (businessId: string) => Record<string, number>;
  /** The Closing Ledger: signs the Gated readiness checklist (this server's readiness key). */
  readiness?: ReadinessSigner;
  /** The handoff proof: records the close snapshot once a close confirms here. */
  onClosed?: (
    businessId: string,
    binding: { network: string; account: string },
    dealSeq: string,
  ) => Promise<unknown>;
}

/** Job 003wf4: the platform account's current operator slot and what an appointment makes of it. */
export function appointmentFor(
  control: ControlV3,
  platform: string,
  keepSupport: boolean,
): {
  current: { caps: number; generation: number } | null;
  caps: number;
  already: boolean;
  change: string;
  support: "added" | "kept" | "renewed" | "removed" | "not_renewed" | "none";
} {
  const slot = control.operators.find((o) => o.account === platform) ?? null;
  const current = slot ? { caps: slot.caps, generation: slot.generation } : null;
  const thisGen = slot !== null && slot.generation === control.generation;
  const meters = slot !== null && (slot.caps & METERING) !== 0;
  const supports = slot !== null && (slot.caps & SUPPORT) !== 0;
  if (thisGen && meters)
    return {
      current,
      caps: slot.caps,
      already: true,
      change: "Already appointed.",
      support: "none",
    };
  if (!slot)
    return { current, caps: METERING, already: false, change: "Adds metering.", support: "none" };
  if (!supports)
    return {
      current,
      caps: METERING,
      already: false,
      change: "Renews metering for this owner.",
      support: "none",
    };
  const caps = keepSupport ? METERING | SUPPORT : METERING;
  if (thisGen)
    return keepSupport
      ? {
          current,
          caps,
          already: false,
          change: "Adds metering and keeps support.",
          support: "kept",
        }
      : {
          current,
          caps,
          already: false,
          change: "Replaces support with metering: support is removed.",
          support: "removed",
        };
  if (!meters)
    return keepSupport
      ? {
          current,
          caps,
          already: false,
          change: "Renews support for this owner and adds metering.",
          support: "renewed",
        }
      : {
          current,
          caps,
          already: false,
          change: "Adds metering; support isn't renewed.",
          support: "not_renewed",
        };
  return keepSupport
    ? {
        current,
        caps,
        already: false,
        change: "Renews metering and support for this owner.",
        support: "renewed",
      }
    : {
        current,
        caps,
        already: false,
        change: "Renews metering; support is removed.",
        support: "not_renewed",
      };
}

const capsName = (caps: number) =>
  caps === (METERING | SUPPORT)
    ? "metering and support"
    : caps === METERING
      ? "metering"
      : caps === SUPPORT
        ? "support"
        : `capabilities ${caps}`;

export class SaleActions {
  constructor(
    private readonly db: Db,
    private readonly store: Store,
    private readonly obs: V3Observations,
    private readonly intents: V3Intents,
    private readonly reader: CustomerViewTransport | null,
    private readonly opts: SaleOptions = {},
  ) {
    migrateSaleActions(db);
  }

  private stamp() {
    return new Date((this.opts.now ?? Date.now)()).toISOString();
  }
  private accountOf(personId: string) {
    const r = this.db
      .prepare("SELECT account_id FROM chain_accounts WHERE owner_kind = 'person' AND owner_id = ?")
      .get(personId) as { account_id: string } | undefined;
    return r?.account_id ?? null;
  }
  private personFor(account: string) {
    const r = this.db
      .prepare("SELECT owner_id FROM chain_accounts WHERE owner_kind = 'person' AND account_id = ?")
      .get(account) as { owner_id: string } | undefined;
    return r?.owner_id ?? null;
  }
  private business(id: string) {
    return this.db.prepare("SELECT id, name, owner_id FROM businesses WHERE id = ?").get(id) as
      | { id: string; name: string; owner_id: string }
      | undefined;
  }
  private own(viewer: Viewer, id: string) {
    const p = this.db.prepare("SELECT * FROM sale_actions WHERE id = ?").get(id) as unknown as
      | SaleActionRow
      | undefined;
    if (!p || p.person_id !== viewer.id) bad(404, "No such sale action");
    return p as SaleActionRow;
  }

  /**
   * Who may see this business's sale here at all, before any chain read: its owner here, the buyer
   * a stored terms document or a recorded intent names, or a person with their own sale actions.
   * Anyone else: 404, with nothing read.
   */
  private gate(viewer: Viewer, businessId: string) {
    const b = this.business(businessId);
    if (!b) bad(404, "No such sale");
    const known =
      (b as { owner_id: string }).owner_id === viewer.id ||
      this.db
        .prepare(
          "SELECT 1 FROM sale_terms_docs WHERE business_id = ? AND (buyer_person_id = ? OR seller_person_id = ?) LIMIT 1",
        )
        .get(businessId, viewer.id, viewer.id) !== undefined ||
      this.db
        .prepare(
          "SELECT 1 FROM v3_intents WHERE business_id = ? AND (buyer_person_id = ? OR seller_person_id = ?) LIMIT 1",
        )
        .get(businessId, viewer.id, viewer.id) !== undefined ||
      this.db
        .prepare("SELECT 1 FROM sale_actions WHERE business_id = ? AND person_id = ? LIMIT 1")
        .get(businessId, viewer.id) !== undefined;
    if (!known) bad(404, "No such sale");
    const binding = this.obs.bindingFor(businessId);
    if (!binding) bad(409, "This business isn't connected to a v3 contract here.", "unbound");
    const account = this.accountOf(viewer.id);
    if (!account) bad(409, "You have no NEAR account linked here.", "no_chain_account");
    if (!this.reader) bad(503, "Wallet sales aren't connected on this server.", "sale_unavailable");
    return {
      business: b as { id: string; name: string; owner_id: string },
      binding: binding as { network: string; account: string },
      account: account as string,
    };
  }

  /**
   * The handoff proof's context: the same participant gate as the sale page (404 to anyone who
   * isn't part of this business's sales), the binding, and whether the viewer owns it here.
   */
  proofContext(viewer: Viewer, businessId: string) {
    const g = this.gate(viewer, businessId);
    return { ...g, localOwner: g.business.owner_id === viewer.id };
  }

  /**
   * Permissions review 2, finding 3: the readings only a current participant may have (the
   * business's economics, its companions). The owner here, the contract's owner, or the live
   * deal's buyer; a past participant (a former seller, a buyer whose deal ended) gets the same
   * 404 as a stranger, as the sale page's live facts already do. The deal is read from the
   * contract at a final block, not from this server's record.
   */
  async currentContext(viewer: Viewer, businessId: string) {
    const g = this.proofContext(viewer, businessId);
    if (g.localOwner) return g;
    const reader = this.reader as CustomerViewTransport;
    const block = await reader.finalBlock(g.binding.network);
    const a = await reader.view({
      network: g.binding.network,
      account: g.binding.account,
      method: "get_control",
      args: {},
      block,
    });
    let control: { owner?: unknown; live_deal?: { buyer?: unknown } | null } = {};
    try {
      control = JSON.parse(a.result) as typeof control;
    } catch {
      throw new V3ReadError("malformed", "get_control returned invalid JSON");
    }
    const current =
      control.owner === g.account ||
      (control.live_deal != null && control.live_deal.buyer === g.account);
    if (!current) bad(404, "No such sale");
    return g;
  }

  /** One coherent reading at one pinned final block, bounded by one deadline. */
  private async read(
    binding: { network: string; account: string },
    viewerAccount: string,
    termsFor: string,
    withPlanTerms = false,
  ): Promise<SaleReading> {
    const reader = this.reader as CustomerViewTransport;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new V3ReadError("timeout", "the read took too long")),
      this.opts.readTimeoutMs ?? 10_000,
    );
    const signal = controller.signal;
    try {
      const final = await reader.finalBlock(binding.network, signal);
      const pinned = checkBlock(final, "final block");
      const ts = (final as { timestamp_ms?: unknown })?.timestamp_ms;
      if (typeof ts !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(ts))
        throw new V3ReadError("malformed", "the final block has no timestamp");
      const block: PinnedBlock = { ...pinned, timestamp_ms: ts };
      const at = async (account: string, method: string, args: Record<string, unknown>) => {
        const a = await reader.view({
          network: binding.network,
          account,
          method,
          args,
          block: pinned,
          signal,
        });
        const b = checkBlock(a?.block, method);
        if (b.height !== pinned.height || b.hash !== pinned.hash)
          throw new V3ReadError("mixed_blocks", `${method} answered from another block`);
        if (typeof a.result !== "string" || a.result.length > MAX_RESULT)
          throw new V3ReadError("too_large", `${method} returned no bounded text`);
        try {
          return JSON.parse(a.result) as unknown;
        } catch {
          throw new V3ReadError("malformed", `${method} returned invalid JSON`);
        }
      };
      const c = binding.account;
      const [control, outcomes, treasury, pending, party, termsRaw] = await Promise.all([
        at(c, "get_control", {}),
        at(c, "get_outcomes", {}),
        at(c, "get_treasury", {}),
        at(c, "get_pending", {}),
        at(c, "get_party", { account: viewerAccount }),
        // An older contract has no such view: wallet sales are then unavailable (no fallback).
        at(c, "get_sale_terms", { buyer: termsFor }).catch((e) => {
          if (
            (e instanceof V3ReadError && e.code === "execution_failed") ||
            (!(e instanceof V3ReadError) && /MethodNotFound/.test(String((e as Error)?.message)))
          )
            return null;
          throw e;
        }),
      ]);
      const r = {
        control: decodeControl(control),
        outcomes: decodeOutcomes(outcomes),
        treasury: decodeTreasury(treasury),
        pending: decodePending(pending),
      };
      coherent(r);
      // Job 003wf4: the guarded plan terms, at the same block; older code has none (no fallback).
      let planTerms: PlanTermsV3 | null | undefined;
      if (withPlanTerms) {
        const raw = await at(c, "get_plan_terms", {}).catch((e) => {
          if (
            (e instanceof V3ReadError && e.code === "execution_failed") ||
            (!(e instanceof V3ReadError) && /MethodNotFound/.test(String((e as Error)?.message)))
          )
            return null;
          throw e;
        });
        if (raw === null) planTerms = null;
        else {
          planTerms = decodePlanTerms(raw);
          // Malformed, or not the state the control view shows at this block: no evidence.
          if (
            !planTerms ||
            planTerms.control_seq !== r.control.control_seq ||
            planTerms.generation !== r.control.generation ||
            planTerms.live_deal !== (r.control.live_deal !== null)
          )
            throw new V3ReadError("malformed", "get_plan_terms disagrees with get_control");
        }
      }
      const asset = r.treasury.asset;
      const [meta, balance, mine, biz, bounds] = await Promise.all([
        at(asset, "ft_metadata", {}),
        at(asset, "ft_balance_of", { account_id: viewerAccount }),
        at(asset, "storage_balance_of", { account_id: viewerAccount }),
        at(asset, "storage_balance_of", { account_id: c }),
        at(asset, "storage_balance_bounds", {}),
      ]);
      // Readable amounts elsewhere: a valid token metadata read is recorded with its block.
      const validMeta = validMetadata(meta);
      if (validMeta) recordTokenMeta(this.db, binding.network, asset, validMeta, pinned.height);
      return {
        block,
        ...r,
        ...(withPlanTerms ? { plan_terms: planTerms } : {}),
        party: decodeParty(party),
        terms: termsRaw === null ? null : decodeSaleTerms(termsRaw),
        token: {
          meta: validMeta,
          balance: validU128(balance),
          registered: mine !== null,
          business_registered: biz !== null,
          storage_min: validU128((bounds as { min?: unknown } | null)?.min),
        },
      };
    } catch (e) {
      if (e instanceof V3ReadError || (e as Error)?.name === "AbortError")
        return bad(503, "NEAR couldn't be read just now; try again.", "read_failed");
      return bad(503, "NEAR couldn't be read just now; try again.", "read_failed");
    } finally {
      clearTimeout(timer);
      controller.abort(new V3ReadError("unavailable", "the read is over"));
    }
  }

  /** The viewer's roles at this reading (DIRECT_SALE.md §7). */
  private roles(s: SaleReading, account: string, localOwner: boolean) {
    const d = s.control.live_deal;
    const closedAsSeller = s.outcomes.some((o) => o.status === "closed" && o.seller === account);
    const closedAsBuyer = s.outcomes.some((o) => o.status === "closed" && o.buyer === account);
    const owed =
      s.party !== null &&
      (s.party.profit_claim !== "0" ||
        s.party.escrow_return_claim !== "0" ||
        s.party.sale_proceeds_claim !== "0");
    return {
      // "seller": the owner here and on the contract, who may propose a sale (a new owner too,
      // once their purchase closed: the sale page offers a resale from it).
      seller: localOwner && s.control.owner === account,
      buyer: d?.buyer === account,
      former_seller: closedAsSeller && s.control.owner !== account,
      new_owner: closedAsBuyer && s.control.owner === account,
      chain_owner: s.control.owner === account,
      claimant: owed || s.pending.some((p) => p.to === account),
    };
  }

  // ---------- the participant's picture ----------

  async setup(viewer: Viewer, businessId: string) {
    const g = this.gate(viewer, businessId);
    const s = await this.read(g.binding, g.account, g.account);
    // Job 003wf3 (§16.3): this pinned read arms the business's handover gate if its Gated deal
    // is closing (keyless; only accepted observations ever move or release it).
    armHandover(this.db, {
      businessId,
      network: g.binding.network,
      account: g.binding.account,
      block: s.block,
      control: s.control,
      source: "sale_setup",
      now: (this.opts.now ?? Date.now)(),
    });
    const localOwner = g.business.owner_id === viewer.id;
    const roles = this.roles(s, g.account, localOwner);
    const d = s.control.live_deal;
    const doc = d ? this.docFor(businessId, d.terms_hash, viewer.id) : null;
    const rows = this.db
      .prepare(
        "SELECT * FROM sale_actions WHERE business_id = ? AND person_id = ? ORDER BY created_at DESC LIMIT 20",
      )
      .all(businessId, viewer.id) as unknown as SaleActionRow[];
    const intents = this.db
      .prepare(
        "SELECT id, deal_seq, version, digest, status FROM v3_intents WHERE business_id = ? AND (seller_person_id = ? OR buyer_person_id = ?) ORDER BY created_at DESC LIMIT 20",
      )
      .all(businessId, viewer.id, viewer.id) as {
      id: string;
      deal_seq: string;
      version: number;
      digest: string;
      status: string;
    }[];
    const platform = this.opts.platformOperator ?? null;
    // Permissions review, finding 2: a past participant (a former seller collecting proceeds, a
    // buyer whose deal ended) keeps their own claims, payouts, actions and outcomes, but not the
    // business's current sale, customer totals or handover. (Owner and operators stay: they are the
    // public answer to "who holds authority now", which a former seller is shown.)
    const current = localOwner || (d != null && (d.buyer === g.account || d.seller === g.account));
    return {
      business: { id: g.business.id, name: g.business.name },
      network: g.binding.network,
      contract: g.binding.account,
      account: g.account,
      local_owner: localOwner,
      roles,
      capability: s.terms
        ? { supported: true, reason: null }
        : { supported: false, reason: "contract_upgrade" },
      block: s.block,
      control: current ? s.control : { ...s.control, live_deal: null },
      outcomes: s.outcomes.filter(
        (o) => o.seller === g.account || o.buyer === g.account || localOwner,
      ),
      customer_obligations: current
        ? {
            prepaid_unused: s.treasury.ent_free_value,
            reserved_in_use: s.treasury.ent_held_value,
            available: s.treasury.available,
            asset: s.treasury.asset,
          }
        : null,
      party: s.party,
      payouts: s.pending.filter((p) => p.to === g.account),
      terms: s.terms,
      token: { account: s.treasury.asset, ...s.token },
      terms_doc: doc,
      platform_operator: platform,
      metering_appointed:
        platform !== null &&
        s.control.operators.some(
          (o) =>
            o.account === platform &&
            (o.caps & METERING) !== 0 &&
            o.generation === s.control.generation,
        ),
      intents,
      actions: rows.map(view),
      open: rows.filter((r) => OPEN.includes(r.state)).map(view),
      handover: this.handoverView(businessId, s, current ? null : g.account),
      ...this.ledger(businessId, s, current),
    };
  }

  /**
   * The Closing Ledger's live-deal facts for the current participants: everything still in
   * flight (counts only, never customer content) and, for a Gated close, the signed readiness
   * checklist bound to this exact deal version, digest and generation.
   */
  private ledger(businessId: string, s: SaleReading, current: boolean) {
    const d = s.control.live_deal;
    if (!d || !current) return { inventory: null, readiness: null };
    const openFor = (person: string | null) =>
      (
        this.db
          .prepare(
            `SELECT COUNT(*) AS n FROM sale_actions WHERE business_id = ? AND state IN (${OPEN.map(() => "?").join(",")})${person ? " AND person_id = ?" : ""}`,
          )
          .get(businessId, ...OPEN, ...(person ? [person] : [])) as { n: number }
      ).n;
    const base = this.opts.inventory?.(businessId) ?? null;
    const inventory = base
      ? { ...base, pending_payouts: s.pending.length, open_wallet_requests: openFor(null) }
      : null;
    let readiness = null;
    if (s.control.close_mode === "gated" && this.opts.readiness && inventory) {
      const sellerPerson = this.personFor(d.seller);
      readiness = this.opts.readiness.issue({
        deal: { seq: d.seq, version: d.version, digest: d.digest },
        generation: s.control.generation,
        control_seq: s.control.control_seq,
        runtime: this.opts.serviceReadiness?.(businessId, s.control) ?? {
          eligible: false,
          reasons: ["not checked here"],
        },
        seller_open_requests: sellerPerson ? openFor(sellerPerson) : 0,
        inventory: base ?? {},
        now_ms: (this.opts.now ?? Date.now)(),
      });
    }
    return { inventory, readiness };
  }

  /**
   * Job 003wf3: the business's newest handover for its participants (never on a storefront):
   * the state, the coalesced reason it waits, its orders and their own transactions' states, and
   * (once released to the buyer) whether customers can actually be served (D4).
   */
  private handoverView(businessId: string, s: SaleReading, pastParticipant: string | null = null) {
    const h = latestHandover(this.db, businessId);
    if (!h) return null;
    // A past participant sees a handover only if it is of their own deal (the former seller
    // follows their sale to "handed over"); a later sale's handover isn't theirs.
    if (
      pastParticipant !== null &&
      !s.outcomes.some(
        (o) =>
          o.seq === h.deal_seq && (o.seller === pastParticipant || o.buyer === pastParticipant),
      )
    )
      return null;
    const orders = (
      this.db
        .prepare(
          "SELECT n, order_json, created_ms FROM close_orders WHERE handover_id = ? ORDER BY n",
        )
        .all(h.id) as { n: number; order_json: string; created_ms: number }[]
    ).map((o) => {
      const a = this.db
        .prepare(
          "SELECT state, code, tx_hash, broadcasts FROM closer_tx_attempts WHERE operation = ? ORDER BY attempt DESC LIMIT 1",
        )
        .get(`close-${h.id}-${o.n}|close_sale`) as
        | { state: string; code: string | null; tx_hash: string; broadcasts: number }
        | undefined;
      return {
        n: o.n,
        issued_at_ms: (JSON.parse(o.order_json) as { issued_at_ms: string }).issued_at_ms,
        attempt: a
          ? { state: a.state, code: a.code, tx_hash: a.tx_hash, broadcasts: Number(a.broadcasts) }
          : null,
      };
    });
    return {
      id: h.id,
      state: h.state,
      deal_seq: h.deal_seq,
      version: h.version,
      closing_started_ms: h.closing_started_ms,
      deadline_ms: h.deadline_ms,
      waiting_for: h.check_reason,
      checked_at_ms: h.check_ms,
      attention_reason: h.attention_reason,
      outcome: h.outcome ? (JSON.parse(h.outcome) as unknown) : null,
      orders,
      service:
        h.state === "released_to_buyer" || h.state === "released_current"
          ? (this.opts.serviceReadiness?.(businessId, s.control) ?? null)
          : null,
    };
  }

  /**
   * Job 003wf4 (OWNER_PLAN_SETUP.md §8): the owner's reading for "Set up customer access": one
   * pinned final read with the plan terms, and the owner's own plan and appointment requests here.
   * Only the business's owner here (404 otherwise); nothing is stored.
   */
  async ownerReading(viewer: Viewer, businessId: string) {
    const g = this.gate(viewer, businessId);
    if (g.business.owner_id !== viewer.id) bad(404, "No such sale");
    const reading = await this.read(g.binding, g.account, g.account, true);
    const rows = this.db
      .prepare(
        "SELECT * FROM sale_actions WHERE business_id = ? AND person_id = ? AND kind IN ('create_plan','appoint') ORDER BY created_at DESC LIMIT 20",
      )
      .all(businessId, viewer.id) as unknown as SaleActionRow[];
    return {
      reading,
      account: g.account,
      platform: this.opts.platformOperator ?? null,
      actions: rows.map(view),
    };
  }

  private docFor(businessId: string, hash: string, personId: string) {
    const r = this.db
      .prepare(
        "SELECT id, hash, text FROM sale_terms_docs WHERE business_id = ? AND hash = ? AND (buyer_person_id = ? OR seller_person_id = ?)",
      )
      .get(businessId, hash, personId, personId) as
      | { id: string; hash: string; text: string }
      | undefined;
    return r ? { id: r.id, hash: r.hash, text: r.text } : null;
  }

  // ---------- exact previews ----------

  /** The exact preview a person reviews (nothing is stored). */
  async prepare(
    viewer: Viewer,
    businessId: string,
    kind: unknown,
    input: Record<string, unknown> = {},
  ) {
    const { _doc, _reading, ...preview } = await this.preparing(viewer, businessId, kind, input);
    return preview;
  }

  private async preparing(
    viewer: Viewer,
    businessId: string,
    kind: unknown,
    input: Record<string, unknown>,
  ) {
    if (typeof kind !== "string" || !SALE_KINDS.includes(kind as SaleKind))
      bad(400, "kind must be one of the sale actions", "bad_kind");
    const g = this.gate(viewer, businessId);
    const termsFor =
      (kind === "propose" || kind === "revise") &&
      typeof input.buyer_account === "string" &&
      isAccountId(input.buyer_account)
        ? input.buyer_account
        : g.account;
    // Job 003wf4: no plan is reviewed while this business is changing hands.
    if (kind === "create_plan") this.store.requireNoHandover(businessId);
    const s = await this.read(g.binding, g.account, termsFor, kind === "create_plan");
    // Job 003wf3: the managed-handover capability, read once for this preview.
    const managed =
      s.control.close_mode === "gated" && kind === "accept"
        ? ((await this.opts.handover?.(businessId)) ?? { ready: false, reason: "not_configured" })
        : null;
    return this.previewFrom(viewer, g, s, kind as SaleKind, input, managed);
  }

  private previewFrom(
    viewer: Viewer,
    g: {
      business: { id: string; name: string; owner_id: string };
      binding: { network: string; account: string };
      account: string;
    },
    s: SaleReading,
    kind: SaleKind,
    input: Record<string, unknown>,
    managed: { ready: boolean; reason: string | null } | null = null,
  ) {
    const no = (code: string, message: string): never => bad(409, message, code);
    const gated = s.control.close_mode === "gated";
    const localOwner = g.business.owner_id === viewer.id;
    const roles = this.roles(s, g.account, localOwner);
    const contract = g.binding.account;
    const asset = s.treasury.asset;
    if (!s.terms)
      no(
        "contract_upgrade",
        "This business's contract predates reviewed wallet sales here (it doesn't state its sale terms). It needs new contract code, as a new business account, before a wallet sale.",
      );
    const terms = s.terms as SaleTermsV3;
    if (kind === "abort" && !gated) no("not_gated", "Only a Gated sale has a closing to end.");
    if (!s.token.meta)
      no("token_malformed", "The business's token didn't answer with valid metadata.");
    const meta = s.token.meta as TokenMeta;
    const d = s.control.live_deal;
    const now = BigInt(s.block.timestamp_ms);
    const cs = s.control.control_seq;
    let call: WalletCall;
    let review: Record<string, unknown>;
    let doc: { text: string; hash: string; buyer_person: string } | null = null;
    const needDeal = () => {
      if (!d) no("no_live_deal", "No sale is in progress on the contract at this reading.");
      if (d?.state === "closing" && kind !== "abort")
        no("closing", "This sale is closing; nothing about it can change now.");
      return d as NonNullable<typeof d>;
    };

    switch (kind) {
      case "propose":
      case "revise": {
        if (!roles.seller)
          no(
            "not_seller",
            "Only the business's owner, with the account the contract names as owner, proposes or revises terms.",
          );
        let live: NonNullable<typeof d> | null = null;
        if (kind === "propose") {
          if (d) no("deal_live", "A sale is already in progress; revise or cancel it instead.");
        } else live = needDeal();
        const buyer = input.buyer_account;
        if (typeof buyer !== "string" || !isAccountId(buyer))
          no("bad_buyer", "Name the buyer's NEAR account.");
        const buyerAcct = buyer as string;
        if (
          buyerAcct === g.account ||
          buyerAcct === contract ||
          buyerAcct === asset ||
          buyerAcct === s.control.closer
        )
          no(
            "bad_buyer",
            "The buyer must be another account than you, the business, its token or its closer.",
          );
        const buyerPerson = this.personFor(buyerAcct);
        if (!buyerPerson)
          no(
            "buyer_unmapped",
            "That account isn't linked to anyone here, so they couldn't review these terms.",
          );
        if (buyerPerson === viewer.id) no("buyer_is_seller", "That account is yours.");
        if (live && live.buyer !== buyerAcct && live.escrow !== "0")
          no("funded_buyer", "The buyer can't change while their escrow is held.");
        const price = validU128(input.price);
        if (!price || price === "0")
          no("bad_price", "The price is a whole number of the token's base units, above 0.");
        const floor = input.available_floor === undefined ? "0" : validU128(input.available_floor);
        if (floor === null) no("bad_floor", "The floor is a whole number of base units.");
        const { earliest, latest } = offerWindow(s.block.timestamp_ms);
        let expires: bigint;
        if (
          typeof input.expires_at_ms === "string" &&
          /^[1-9][0-9]{0,19}$/.test(input.expires_at_ms)
        )
          expires = BigInt(input.expires_at_ms);
        else if (
          Number.isInteger(input.expires_in_days) &&
          (input.expires_in_days as number) >= 1 &&
          (input.expires_in_days as number) <= 30
        )
          expires = now + BigInt(input.expires_in_days as number) * DAY_MS;
        else return no("bad_expiry", "Choose how many days (1 to 30) the offer stays open.");
        if (expires < earliest || expires > latest)
          no("bad_expiry", "The offer must stay open between a minute and 30 days from now.");
        const grantsIn = input.grants ?? [];
        if (!Array.isArray(grantsIn) || grantsIn.length > 4)
          no("bad_grants", "At most 4 operator grants.");
        const grants: { account: string; caps: number }[] = [];
        for (const x of grantsIn as { account?: unknown; caps?: unknown }[]) {
          if (typeof x?.account !== "string" || !isAccountId(x.account))
            no("bad_grants", "Each grant names a NEAR account.");
          const caps = x.caps;
          if (
            !Number.isInteger(caps) ||
            (caps as number) < 1 ||
            ((caps as number) & ~(METERING | SUPPORT)) !== 0
          )
            no("bad_grants", "Capabilities are metering (1), support (2) or both (3).");
          if (grants.some((y) => y.account === x.account))
            no("bad_grants", "Each grant names a different account.");
          grants.push({ account: x.account as string, caps: caps as number });
        }
        const problem = validSellerText(input.exclusions ?? [], input.note ?? "");
        if (problem) no("bad_text", problem);
        const platform = this.opts.platformOperator ?? null;
        const meteringGranted =
          platform !== null &&
          grants.some((x) => x.account === platform && (x.caps & METERING) !== 0);
        // Job 003wf3 (Q1): a managed (Gated) handover promises continuity, so its terms must
        // grant metering to this platform's own operator. The mode is fixed by the contract.
        if (gated && !meteringGranted)
          no(
            "managed_meter_required",
            `A managed handover keeps customers served only if the terms grant metering to ${platform ?? "this platform's operator"}. Add that grant.`,
          );
        let closeWindow = "0";
        if (gated) {
          const m = input.close_window_minutes ?? 60;
          if (!Number.isInteger(m) || (m as number) < 10 || (m as number) > 1440)
            no("bad_close_window", "The close window is 10 minutes to 24 hours.");
          closeWindow = String((m as number) * 60_000);
        }
        const termsDoc: TermsDoc = {
          schema: "sale-terms/1",
          business: { id: g.business.id, name: g.business.name },
          contract: { network: g.binding.network, account: contract },
          seller: g.account,
          buyer: buyerAcct,
          asset: { account: asset, symbol: meta.symbol, decimals: meta.decimals },
          price: price as string,
          expires_at_ms: String(expires),
          available_floor: floor as string,
          grants,
          continuity: { metering_account: platform ?? "", metering_granted: meteringGranted },
          transfers: {
            included: [...INCLUDED],
            not_included: [
              ...NOT_INCLUDED,
              ...((input.exclusions as string[] | undefined) ?? []).map((x) => x.trim()),
            ],
          },
          note: (input.note as string | undefined) ?? "",
        };
        const text = canonicalTerms(termsDoc);
        const termsHash = sha256hex(text);
        doc = { text, hash: termsHash, buyer_person: buyerPerson as string };
        const seq = live ? live.seq : terms.next_deal_seq;
        const version = live ? live.version + 1 : 1;
        const digest = dealDigest({
          business: contract,
          seq,
          version,
          seller: g.account,
          buyer: buyerAcct,
          asset,
          price: price as string,
          expires_at_ms: String(expires),
          close_window_ms: closeWindow,
          available_floor: floor as string,
          grants,
          terms_hash: termsHash,
          expected_generation: s.control.generation,
          manifest: s.control.service_manifest,
          manifest_seq: s.control.manifest_seq,
          plan_count: terms.plan_count,
          min_reserve: terms.min_reserve,
          close_mode: s.control.close_mode,
          closer: s.control.closer,
        });
        const newRecord = !terms.party_exists && (!live || live.buyer !== buyerAcct);
        const deposit = newRecord
          ? (BigInt(terms.party_bytes) * BigInt(terms.storage_byte_cost)).toString()
          : "1";
        const arg = termsArg({
          buyer: buyerAcct,
          price: price as string,
          expires_at_ms: String(expires),
          available_floor: floor as string,
          grants,
          terms_hash: termsHash,
          close_window_ms: closeWindow,
        });
        call = live
          ? reviseCall(contract, live.seq, cs, arg, digest, deposit)
          : proposeCall(contract, arg, cs, digest, deposit);
        const returned = live && live.escrow !== "0" && live.price !== price ? live.escrow : "0";
        review = {
          deal_seq: seq,
          next_version: version,
          version,
          digest,
          buyer: buyerAcct,
          price,
          expires_at_ms: String(expires),
          close_window_ms: closeWindow,
          available_floor: floor,
          grants,
          metering_granted: meteringGranted,
          terms_hash: termsHash,
          seller: g.account,
          // Everything else the contract's digest binds, as read: the browser recomputes it.
          digest_basis: {
            business: contract,
            asset,
            expected_generation: s.control.generation,
            manifest: s.control.service_manifest,
            manifest_seq: s.control.manifest_seq,
            plan_count: terms.plan_count,
            min_reserve: terms.min_reserve,
            close_mode: s.control.close_mode,
            closer: s.control.closer,
          },
          deposit,
          deposit_basis: newRecord
            ? `The contract states a new buyer record is exactly ${terms.party_bytes} bytes at ${terms.storage_byte_cost} yoctoNEAR a byte; any excess is refunded, less is refused.`
            : "The buyer already has a record with this business: only the intentional 1 yoctoNEAR is attached.",
          escrow_returned: returned,
          effects: [
            live
              ? `Deal ${seq} becomes version ${version}; both parties' acceptances are cleared, and the buyer must accept the new version.`
              : `Deal ${seq} is proposed to ${buyerAcct}, open until ${new Date(Number(expires))
                  .toISOString()
                  .replace("T", " ")
                  .replace(/\.\d+Z$/, " UTC")}.`,
            ...(returned !== "0"
              ? [
                  `The price changes, so the buyer's escrow (${returned} base units) becomes their returned-escrow claim at once.`,
                ]
              : []),
            meteringGranted
              ? gated
                ? "The platform's metering account is named in the terms, so it keeps its metering authority after the close. Whether customers can actually be served is shown separately after the handover (the runtime, release and budget checks)."
                : "The platform's metering account is named in the terms, so customers' new uses continue right after the close."
              : "No metering account is named: after the close, customers keep their units but new uses pause until the new owner appoints metering.",
            ...(gated
              ? [
                  `This business closes through its named closer. Once both parties accept, Everstreet checks the handover (new customer uses pause for this business; uses already running finish and settle) and the closer must close the sale before a deadline ${Number(closeWindow) / 60_000} minutes after the second acceptance. That is a deadline, not a promise: if it isn't closed by then, either party can end the closing.`,
                ]
              : []),
          ],
          conditions: [
            "Refused without any change if anything about the sale changes before it lands (the control sequence you reviewed).",
          ],
        };
        break;
      }
      case "fund": {
        const live = needDeal();
        if (!roles.buyer) no("not_buyer", "Only the buyer the deal names funds its escrow.");
        if (live.escrow !== "0") no("funded", "Escrow is already funded for this deal.");
        if (now >= BigInt(live.expires_at_ms)) no("expired", "This offer has expired.");
        if (!s.token.registered)
          no("register_first", "Register your account with the business's token first.");
        if (!s.token.business_registered)
          no(
            "business_unregistered",
            "The business isn't registered with its token (an owner action).",
          );
        if (s.token.balance === null || BigInt(s.token.balance) < BigInt(live.price))
          no("funds", "Your account doesn't hold enough of the token for the price.");
        call = fundCall(asset, contract, live.seq, live.version, live.price, cs);
        review = {
          deal_seq: live.seq,
          version: live.version,
          digest: live.digest,
          price: live.price,
          buyer: live.buyer,
          effects: [
            "The token moves the exact price from your account to the business's contract, where it is held as escrow for this deal only.",
            s.control.close_mode === "gated"
              ? "You can take it back (as a claim to collect) until both of you have accepted. Once the closing starts it stays in escrow until the closer closes the sale, or, after the closing deadline, either party ends the closing and it becomes your claim to collect."
              : "You can take it back (as a claim to collect) until the sale closes.",
          ],
          conditions: [
            "If the sale changed since this review, or the offer expired, the contract returns the whole amount to you.",
          ],
        };
        break;
      }
      case "accept": {
        const live = needDeal();
        const asSeller = roles.seller && live.seller === g.account;
        if (!asSeller && !roles.buyer) no("not_party", "Only the seller or the buyer accepts.");
        if ((asSeller && live.seller_accepted) || (roles.buyer && live.buyer_accepted))
          no("already_accepted", "You have already accepted this version.");
        if (now >= BigInt(live.expires_at_ms)) no("expired", "This offer has expired.");
        if (BigInt(s.treasury.available) < BigInt(live.available_floor))
          no(
            "floor",
            `The business's available balance (${s.treasury.available}) is below the agreed floor (${live.available_floor}). Settled customer uses raise it; acceptance waits until it is met.`,
          );
        if (roles.buyer && live.escrow !== live.price)
          no("unfunded", "Fund the escrow before accepting.");
        call = acceptCall(contract, live.seq, live.version, live.digest);
        const other = asSeller ? live.buyer_accepted : live.seller_accepted;
        // Job 003wf3 (Q2): the acceptance that starts a Gated closing is refused unless this
        // installation can manage that close (else the deal could only abort at its deadline).
        if (gated && other && !managed?.ready)
          no(
            "handover_unavailable",
            `This acceptance would start the closing, but the managed handover isn't available here now (${managed?.reason ?? "not_configured"}). Nothing was sent.`,
          );
        review = {
          deal_seq: live.seq,
          version: live.version,
          digest: live.digest,
          price: live.price,
          buyer: live.buyer,
          role: asSeller ? "seller" : "buyer",
          other_accepted: other,
          escrow: live.escrow,
          effects: other
            ? gated
              ? [
                  "The other party has accepted these exact terms: your acceptance starts the closing.",
                  `Everstreet then checks the handover: new customer uses pause for this business while uses already running finish and settle; the closer must close the sale before a deadline ${Number(live.close_window_ms) / 60_000} minutes after your acceptance. Ownership changes only when the contract shows the close; management here moves only after that close is applied here. Nothing about the deal can change meanwhile.`,
                  "If it isn't closed by then, either party can end the closing: the buyer's escrow becomes their claim and the seller keeps the business.",
                ]
              : [
                  "The other party has accepted these exact terms: your acceptance closes the sale in the same transaction.",
                  "The buyer becomes the contract's owner at the next generation; the seller's management ends; the price becomes the seller's sale-proceeds claim.",
                ]
            : [
                "Records your acceptance of this exact version.",
                gated
                  ? `If the ${asSeller ? "buyer" : "seller"} accepts these same terms afterwards, that acceptance starts the closing: Everstreet checks the handover, ownership changes only when the closer's close is confirmed on the contract, and management here moves only after it is applied here.`
                  : `If the ${asSeller ? "buyer" : "seller"} accepts these same terms afterwards, that acceptance closes the sale.`,
              ],
          conditions: [
            gated
              ? `If the ${asSeller ? "buyer" : "seller"} accepts first, your acceptance starts the closing instead of waiting.`
              : `If the ${asSeller ? "buyer" : "seller"} accepts first, your acceptance closes the sale instead of waiting.`,
            "Refused if the terms are revised (a new version), the offer expires, or the floor isn't met when it lands.",
          ],
        };
        break;
      }
      case "abort": {
        const live = needDeal();
        if (!roles.buyer && !(roles.seller && live.seller === g.account) && !roles.former_seller)
          no("not_party", "Only the seller or the buyer ends this closing here.");
        if (live.state !== "closing") no("not_closing", "This sale isn't closing.");
        if (now < BigInt(live.deadline_ms))
          no(
            "not_expired",
            "The closer still has time: the closing can be ended only after its deadline.",
          );
        call = abortCall(contract, live.seq);
        review = {
          deal_seq: live.seq,
          version: live.version,
          digest: live.digest,
          deadline_ms: live.deadline_ms,
          escrow: live.escrow,
          effects: [
            `Ends deal ${live.seq}'s closing on the contract: nothing changes hands; the seller keeps the business.`,
            "The buyer's escrow becomes their returned-escrow claim to collect (owed until its payout is proven).",
          ],
          conditions: ["Refused if the sale was closed or ended first."],
        };
        break;
      }
      case "unfund":
      case "cancel":
      case "expire": {
        const live = needDeal();
        if (kind === "unfund") {
          if (!roles.buyer) no("not_buyer", "Only the buyer takes their escrow back.");
          if (live.escrow === "0") no("nothing_funded", "Nothing is funded.");
        } else if (!roles.buyer && !(roles.seller && live.seller === g.account))
          no("not_party", "Only the seller or the buyer ends this offer here.");
        if (kind === "expire" && now < BigInt(live.expires_at_ms))
          no("not_expired", "The offer is still open.");
        call = dealStepCall(
          contract,
          kind === "unfund"
            ? "unfund_deal_guarded"
            : kind === "cancel"
              ? "cancel_sale_guarded"
              : "expire_sale_guarded",
          live.seq,
          cs,
        );
        review = {
          deal_seq: live.seq,
          version: live.version,
          digest: live.digest,
          escrow: live.escrow,
          buyer: live.buyer,
          effects:
            kind === "unfund"
              ? [
                  `Your escrow (${live.escrow} base units) becomes your returned-escrow claim; your acceptance, if any, is cleared.`,
                ]
              : [
                  `Deal ${live.seq} ends ${kind === "cancel" ? "cancelled" : "as expired"}; nothing changes hands.`,
                  live.escrow !== "0"
                    ? `The buyer's escrow (${live.escrow} base units) becomes their returned-escrow claim.`
                    : "No escrow is held.",
                ],
          conditions: [
            "Refused without any change if anything about the sale changed since this review.",
          ],
        };
        break;
      }
      case "claim": {
        const cat = input.category;
        if (cat !== CLAIM_PROFIT && cat !== CLAIM_ESCROW_RETURN && cat !== CLAIM_SALE_PROCEEDS)
          no(
            "bad_category",
            "Choose sale proceeds (2), returned escrow (1) or operating profit (0).",
          );
        const amount = claimOf(s.party, cat as number);
        if (amount === "0") no("nothing_owed", "Nothing is owed to you in that category.");
        if ((s.party?.pending_refs ?? 0) >= 2)
          no(
            "payouts_in_flight",
            "Two of your payouts are already in flight; wait for them to settle.",
          );
        if (!s.token.registered)
          no(
            "register_first",
            "Your account isn't registered with the business's token, so a payout to it would fail. Register first.",
          );
        call = claimCall(contract, cat as number, amount, terms.payout_seq);
        // Which sale's proceeds this collects (Astra's repeat-sale counterexample): the newest
        // close that made this account its seller, as read. Collection of a sale is shown only
        // from a payout bound to THAT sale.
        const forDeal =
          cat === CLAIM_SALE_PROCEEDS
            ? ([...s.outcomes]
                .filter((o) => o.status === "closed" && o.seller === g.account)
                .sort((a, b) => (BigInt(b.seq) > BigInt(a.seq) ? 1 : -1))[0]?.seq ?? null)
            : null;
        review = {
          category: cat,
          category_name: CATEGORY_NAMES[cat as number],
          amount,
          payout_seq: terms.payout_seq,
          for_deal: forDeal,
          effects: [
            `The contract starts a payout of exactly ${amount} base units of ${meta.symbol} to your account.`,
            "It is called paid only once the token's transfer and the contract's settlement are both seen. If the transfer fails, the amount is restored as your claim.",
          ],
          conditions: [
            "Refused without any change if what you're owed changed, or another payout started, since this review.",
          ],
        };
        break;
      }
      case "appoint": {
        const platform = this.opts.platformOperator ?? null;
        if (!platform)
          no("no_platform_operator", "This server has no platform metering account configured.");
        if (!roles.chain_owner)
          no("not_owner", "Only the contract's current owner appoints operators.");
        if (d) no("deal_live", "Operators can't change while a sale is in progress.");
        // Job 003wf4 (OWNER_PLAN_SETUP.md §6): the call REPLACES the slot's mask, so the review
        // names the current slot and the exact resulting mask. Support is kept unless removed.
        if (input.keep_support !== undefined && typeof input.keep_support !== "boolean")
          no("bad_keep_support", "keep_support is true or false.");
        const keep = input.keep_support !== false;
        const a = appointmentFor(s.control, platform as string, keep);
        if (a.already)
          no(
            "already_appointed",
            "The platform's metering account is already appointed for this generation.",
          );
        call = appointCall(contract, platform as string, a.caps, cs);
        review = {
          operator: platform,
          current: a.current,
          caps: a.caps,
          keep_support: keep,
          support: a.support,
          change: a.change,
          generation: s.control.generation,
          effects: [
            `${a.change} ${platform} will hold ${capsName(a.caps)} for owner generation ${s.control.generation}; its slot's mask is replaced by exactly this one.`,
            "This is a permission only: whether customers can actually be served is shown separately (release, runtime, budget, protection, writer and plan timing).",
          ],
          conditions: ["Refused without any change if control changed since this review."],
        };
        break;
      }
      case "owner_probe": {
        // The judge rehearsal: the former seller's own wallet tries an owner action, so the
        // refusal shown is the contract's, not this app's. The contract's answer is the evidence.
        if (!roles.former_seller)
          no("not_former_seller", "Only a seller whose sale has closed can try this.");
        call = appointCall(contract, g.account, METERING, cs);
        review = {
          operator: g.account,
          caps: METERING,
          owner: s.control.owner,
          generation: s.control.generation,
          effects: [
            `Asks the contract to appoint ${g.account} as an operator, which only the owner may do. The owner is ${s.control.owner} (generation ${s.control.generation}), so the contract should refuse it and change nothing.`,
          ],
          conditions: ["Your wallet pays the network fee whether the contract refuses it or not."],
        };
        break;
      }
      case "create_plan": {
        if (!roles.seller)
          no(
            "not_owner",
            "Only the business's owner, with the account the contract names as owner, creates a plan.",
          );
        if (d) no("deal_live", "A plan can't be created while a sale is in progress.");
        const pt = s.plan_terms;
        if (!pt)
          no(
            "guided_plans_unavailable",
            "This business's contract predates guided plans (it has no plan terms view). Existing plans can still be inspected and offered.",
          );
        const t = pt as PlanTermsV3;
        if (t.plan_count >= t.max_plans)
          no("plan_limit", `This contract already has the most plans allowed (${t.max_plans}).`);
        const usable = this.opts.planUsability;
        if (!usable)
          no(
            "service_unavailable",
            "This server can't check plan timing, so guided plans are unavailable.",
          );
        const raw = input.plan as Record<string, unknown> | undefined;
        const bad = (m: string): never => no("bad_plan", m);
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) bad("Describe the plan.");
        const pr = raw as Record<string, unknown>;
        const price = validU128(pr.unit_price);
        if (!price || price === "0")
          bad("The price per use is a whole number of the token's base units, above 0.");
        const u32 = (v: unknown) =>
          Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffff_ffff;
        const ms = (v: unknown) => typeof v === "string" && /^(0|[1-9][0-9]{0,15})$/.test(v);
        if (!u32(pr.max_units_per_purchase) || (pr.max_units_per_purchase as number) < 1)
          bad("Allow at least 1 unit per purchase.");
        if (
          !u32(pr.max_units_outstanding) ||
          (pr.max_units_outstanding as number) < (pr.max_units_per_purchase as number)
        )
          bad("A customer may hold at least as many units as one purchase buys.");
        if (
          !Number.isInteger(pr.max_hold_units) ||
          (pr.max_hold_units as number) < 1 ||
          (pr.max_hold_units as number) > t.rules.rules.max_hold_units
        )
          bad(
            `Uses per hold are 1 to ${t.rules.rules.max_hold_units} under this business's rules.`,
          );
        if (
          !ms(pr.hold_ttl_ms) ||
          BigInt(pr.hold_ttl_ms as string) < BigInt(t.rules.min_hold_ttl_ms) ||
          BigInt(pr.hold_ttl_ms as string) > BigInt(t.rules.max_hold_ttl_ms)
        )
          bad(
            `A hold lasts ${Number(t.rules.min_hold_ttl_ms) / 1000} s to ${Number(t.rules.max_hold_ttl_ms) / 1000} s under this business's rules.`,
          );
        if (
          !ms(pr.settle_grace_ms) ||
          BigInt(pr.settle_grace_ms as string) > BigInt(t.rules.max_settle_grace_ms)
        )
          bad(
            `The settlement grace is at most ${Number(t.rules.max_settle_grace_ms) / 1000} s under this business's rules.`,
          );
        const plan: PlanInputV3 = {
          unit_price: price as string,
          max_units_per_purchase: pr.max_units_per_purchase as number,
          max_units_outstanding: pr.max_units_outstanding as number,
          max_hold_units: pr.max_hold_units as number,
          hold_ttl_ms: pr.hold_ttl_ms as string,
          settle_grace_ms: pr.settle_grace_ms as string,
        };
        // §5: only a plan this server can actually serve, with a grace that pays a late result.
        const timing = (usable as NonNullable<typeof usable>)(plan);
        if (!timing.usable)
          no("plan_unusable", timing.reason ?? "This server can't serve holds that short.");
        if (!timing.grace_ok)
          no(
            "grace_too_short",
            `A result delivered at the latest moment needs a settlement grace of at least ${Math.ceil(timing.min_grace_ms / 1000)} s here, or it could go unpaid.`,
          );
        const deposit = (BigInt(t.plan_bytes) * BigInt(t.storage_byte_cost)).toString();
        call = createPlanCall(contract, plan, cs, t.next_plan_id, deposit);
        const mins = (v: string) => `${Number(v) / 60_000} min`;
        review = {
          plan,
          plan_id: t.next_plan_id,
          generation: s.control.generation,
          deposit,
          plan_bytes: t.plan_bytes,
          storage_byte_cost: t.storage_byte_cost,
          price: {
            base: plan.unit_price,
            amount: readableAmount(plan.unit_price, meta.decimals),
            symbol: meta.symbol,
          },
          timing: { min_hold_ms: timing.min_hold_ms, min_grace_ms: timing.min_grace_ms },
          effects: [
            `Creates plan ${t.next_plan_id} on the contract: ${readableAmount(plan.unit_price, meta.decimals)} ${meta.symbol} per use (${plan.unit_price} base units), at most ${plan.max_units_per_purchase} units per purchase and ${plan.max_units_outstanding} held, ${plan.max_hold_units} per hold; each hold lasts ${mins(plan.hold_ttl_ms)}, with ${mins(plan.settle_grace_ms)} to settle.`,
            // Readable first (Astra 06:21); the exact yoctoNEAR is `deposit` and the call's own.
            `Attaches ${readableAmount(deposit, 24)} NEAR for ${t.plan_bytes} bytes of contract storage; any excess is refunded. The plan is permanent and its storage isn't released: a new price is a new plan.`,
          ],
          conditions: [
            "Refused without any change if control changed since this review, another plan was created meanwhile, a sale started, or the storage cost rose.",
          ],
        };
        break;
      }
      case "register": {
        if (s.token.registered)
          no("registered", "Your account is already registered with this token.");
        if (!s.token.storage_min)
          no("token_malformed", "The token didn't state its storage minimum.");
        call = registerCall(asset, g.account, s.token.storage_min as string);
        review = {
          token: asset,
          deposit: s.token.storage_min,
          effects: [
            `Registers your account with ${meta.symbol} (the token's own record, not this business's), attaching the token's stated minimum.`,
          ],
          conditions: [
            "The request says registration only: under NEP-145 a token refunds the whole deposit if your account is registered by then. This token's conformance is the token's own.",
          ],
        };
        break;
      }
    }
    // The control state this review reads, shown with every request (the block is the preview's).
    review = { ...review, control_seq: cs };
    const identity = exclusivity(kind, call, g.account);
    const actionDigest = sha([
      kind,
      g.binding.network,
      contract,
      g.account,
      call,
      identity,
      review,
    ]);
    return {
      kind,
      network: g.binding.network,
      contract,
      asset,
      account: g.account,
      block: s.block,
      call,
      identity,
      review,
      token: { symbol: meta.symbol, decimals: meta.decimals, name: meta.name },
      terms_doc: doc ? { text: doc.text, hash: doc.hash } : null,
      action_digest: actionDigest,
      /** Exactly what to send back to store this reviewed request (absolute values only). */
      input:
        kind === "propose" || kind === "revise"
          ? {
              buyer_account: review.buyer,
              price: review.price,
              expires_at_ms: review.expires_at_ms,
              available_floor: review.available_floor,
              grants: review.grants,
              exclusions: (input.exclusions as string[] | undefined) ?? [],
              note: (input.note as string | undefined) ?? "",
              // Job 003wf3: a Gated close window, as reviewed (Direct: none).
              ...(review.close_window_ms && review.close_window_ms !== "0"
                ? { close_window_minutes: Number(review.close_window_ms) / 60_000 }
                : {}),
            }
          : kind === "claim"
            ? { category: review.category }
            : kind === "create_plan"
              ? { plan: review.plan }
              : kind === "appoint"
                ? { keep_support: review.keep_support }
                : {},
      _doc: doc,
      _reading: s,
    };
  }

  // ---------- the durable reviewed action ----------

  async create(viewer: Viewer, businessId: string, input: Record<string, unknown>) {
    const key = input.idempotency_key;
    if (typeof key !== "string" || !KEY.test(key))
      bad(400, "idempotency_key must be 8 to 80 letters, digits, dashes or underscores");
    const prior = this.db
      .prepare("SELECT * FROM sale_actions WHERE person_id = ? AND idempotency_key = ?")
      .get(viewer.id, key as string) as unknown as SaleActionRow | undefined;
    if (prior) {
      if (prior.action_digest !== input.action_digest)
        bad(409, "That key was used for a different request.", "idempotency_conflict");
      return { created: false, action: view(prior) };
    }
    const kind = input.kind;
    const p = await this.preparing(
      viewer,
      businessId,
      kind,
      (input.input as Record<string, unknown>) ?? {},
    );
    const { _doc, _reading, ...preview } = p;
    if (input.action_digest !== p.action_digest)
      bad(409, "The request changed since you reviewed it; review it again.", "review_changed", {
        preview,
      });
    // A seller accepts only a version recorded here, so a close is always reconcilable.
    if (p.kind === "accept" && p.review.role === "seller")
      await this.ensureRecorded(viewer, businessId, p.review);
    const replaces = typeof input.replaces === "string" ? input.replaces : null;
    const id = randomUUID();
    const t = this.stamp();
    const outcome = this.store.tx(() => {
      // Job 003wf4: no plan is stored while this business is changing hands.
      if (p.kind === "create_plan") this.store.requireNoHandover(businessId);
      const again = this.db
        .prepare("SELECT * FROM sale_actions WHERE person_id = ? AND idempotency_key = ?")
        .get(viewer.id, key as string) as unknown as SaleActionRow | undefined;
      // A concurrent request under the same key (Astra 05:18): recovered only if it is the same
      // immutable request; different reviewed terms are refused, never silently substituted.
      if (again) {
        if (again.action_digest !== p.action_digest)
          bad(409, "That key was used for a different request.", "idempotency_conflict");
        return { row: again, created: false };
      }
      const open = this.db
        .prepare(
          "SELECT * FROM sale_actions WHERE business_id = ? AND account = ? AND state IN ('prepared','requested','unknown') ORDER BY created_at",
        )
        .all(businessId, p.account) as unknown as SaleActionRow[];
      // Job 003wf4 (§5a): different plan inputs under the same control identity are a conflict,
      // never silently adopted (and the old row is never returned as if it were the new one).
      const conflicting = open.find(
        (r) =>
          r.kind === "create_plan" &&
          p.kind === "create_plan" &&
          r.identity === p.identity &&
          r.action_digest !== p.action_digest,
      );
      if (conflicting)
        bad(
          409,
          "Another plan request for this same review is still open, with different terms. Recover it, set it aside if your wallet was never asked, or check it first.",
          "request_conflict",
          { action: view(conflicting) },
        );
      const prepared = open.find((r) => r.state === "prepared");
      if (prepared)
        bad(
          409,
          "A reviewed request is waiting for your wallet; continue or set it aside first.",
          "action_open",
          {
            action: view(prepared),
          },
        );
      // An asked request of ANOTHER kind can't be duplicated by this one, so it never blocks it.
      // One of the SAME kind admits a new one only as its exact replacement: an exclusive kind,
      // the identical immutable request (equal action digest), named in `replaces` (DIRECT_SALE §5).
      const same = open.filter((r) => r.kind === p.kind);
      const named = same.some((r) => r.id === replaces);
      for (const r of same) {
        const replaceable = EXCLUSIVE.has(p.kind) && r.action_digest === p.action_digest;
        if (!replaceable || !named)
          bad(
            409,
            "A request of this kind your wallet was asked for is still unresolved; check it first.",
            "action_open",
            { action: view(r), replaceable },
          );
      }
      let termsId: string | null = null;
      if (_doc) {
        const existing = this.db
          .prepare("SELECT id FROM sale_terms_docs WHERE business_id = ? AND hash = ?")
          .get(businessId, _doc.hash) as { id: string } | undefined;
        termsId = existing?.id ?? randomUUID();
        if (!existing)
          this.db
            .prepare(
              "INSERT INTO sale_terms_docs (id, business_id, hash, text, seller_person_id, buyer_person_id, buyer_account, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .run(
              termsId,
              businessId,
              _doc.hash,
              _doc.text,
              viewer.id,
              _doc.buyer_person,
              String(p.review.buyer),
              t,
            );
      }
      const reviewSeq = (p.review.deal_seq as string | undefined) ?? null;
      const reviewVersion = (p.review.version as number | undefined) ?? null;
      this.db
        .prepare(
          `INSERT INTO sale_actions (id, business_id, person_id, account, network, contract, asset, kind, identity, deal_seq, version, call, action_digest, review, terms_id, replaces, idempotency_key, state, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?)`,
        )
        .run(
          id,
          businessId,
          viewer.id,
          p.account,
          p.network,
          p.contract,
          p.asset,
          p.kind,
          p.identity,
          reviewSeq,
          reviewVersion,
          JSON.stringify(p.call),
          p.action_digest,
          JSON.stringify(p.review),
          termsId,
          replaces,
          key as string,
          t,
          t,
        );
      return { row: this.own(viewer, id), created: true };
    });
    return { created: outcome.created, action: view(outcome.row) };
  }

  /** The seller's live version recorded through the existing intents (local only; idempotent). */
  private async ensureRecorded(
    viewer: Viewer,
    businessId: string,
    review: Record<string, unknown>,
  ) {
    const exists = this.db
      .prepare(
        "SELECT id FROM v3_intents WHERE business_id = ? AND deal_seq = ? AND version = ? AND digest = ?",
      )
      .get(businessId, String(review.deal_seq), Number(review.version), String(review.digest));
    if (exists) return;
    const binding = this.obs.bindingFor(businessId);
    const snap = binding ? await this.obs.readFresh(binding).catch(() => null) : null;
    if (snap) this.store.tx(() => this.obs.record(businessId, snap));
    try {
      this.intents.record(viewer as Person, businessId, {
        idempotency_key: `sale-${String(review.deal_seq)}-${String(review.version)}-${String(review.digest).slice(0, 16)}`,
        deal_seq: review.deal_seq,
        version: review.version,
        digest: review.digest,
      });
    } catch (e) {
      if (e instanceof HttpError)
        bad(
          409,
          `This version couldn't be recorded here first (${e.message}) Read the contract again, then accept.`,
          "version_not_recorded",
        );
      throw e;
    }
  }

  /**
   * The wallet ask, recorded durably BEFORE the wallet is invoked: one conditional
   * prepared -> requested claim with a single winner across tabs and processes. Only
   * `ask: "granted"` permits invoking the wallet; `"already_asked"` never does (a lost answer to
   * the winning claim leaves the row requested: recover it, never send it again). With a
   * `tx_hash`, it records the wallet's returned hash only and grants nothing.
   */
  requested(viewer: Viewer, id: string, input: Record<string, unknown>) {
    // Authorization first: only this viewer's own action (404 otherwise). What follows acts
    // through updates conditional on the stored row.
    this.own(viewer, id);
    if (input.tx_hash !== undefined) {
      if (typeof input.tx_hash !== "string" || !TX_HASH.test(input.tx_hash))
        bad(400, "That isn't a NEAR transaction ID", "bad_tx_hash");
      // Judge rehearsal (Nov 7): a hash for an action nobody asked the wallet for is refused,
      // not quietly ignored; the order is requested {} first, then the wallet, then check.
      if (this.own(viewer, id).state === "prepared")
        bad(
          409,
          "Ask the wallet first (POST requested with no body), then send its hash.",
          "not_requested",
        );
      this.db
        .prepare(
          "UPDATE sale_actions SET tx_hash = ?, rev = rev + 1, updated_at = ? WHERE id = ? AND tx_hash IS NULL AND state IN ('requested','unknown','no_longer_possible')",
        )
        .run(input.tx_hash as string, this.stamp(), id);
      return { action: view(this.own(viewer, id)), ask: null };
    }
    // The claimant's own id (a tab's, in memory): its retry after a lost answer is answered
    // "granted" again; every other claimant gets "already_asked". Without one, only the first wins.
    const askId = typeof input.ask_id === "string" && KEY.test(input.ask_id) ? input.ask_id : null;
    if (input.ask_id !== undefined && askId === null)
      bad(400, "ask_id must be 8 to 80 letters, digits, dashes or underscores");
    const won = this.db
      .prepare(
        "UPDATE sale_actions SET state = 'requested', asks = asks + 1, ask_id = ?, rev = rev + 1, updated_at = ? WHERE id = ? AND state = 'prepared'",
      )
      .run(askId, this.stamp(), id);
    const now = this.own(viewer, id);
    const granted =
      won.changes === 1 ||
      (askId !== null && now.ask_id === askId && now.state === "requested" && now.tx_hash === null);
    return {
      action: view(now),
      ask: granted ? ("granted" as const) : ("already_asked" as const),
    };
  }

  /**
   * Commits a result with its transaction identity and state together, only on the row as read
   * (its revision): if another check settled it meanwhile, nothing is written and false returns.
   */
  private commit(p: SaleActionRow, state: State, res: SaleResolution, hash: string | null) {
    const r = this.db
      .prepare(
        `UPDATE sale_actions SET state = ?, evidence = ?, tx_hash = ?, rev = rev + 1, updated_at = ? WHERE id = ? AND rev = ? AND ${CHECKABLE_SQL}`,
      )
      .run(state, JSON.stringify(res), hash, this.stamp(), p.id, p.rev);
    return r.changes === 1;
  }

  /** The stored, coherent outcome of a row (another check settled it first). */
  private async stored(
    viewer: Viewer,
    id: string,
    transaction: { hash: string; matched: boolean } | null,
  ) {
    let row = this.own(viewer, id);
    let effects = row.effects ? (JSON.parse(row.effects) as Record<string, unknown>) : null;
    // A confirmed row whose local follow-up never finished: repeat it (it is idempotent).
    if (row.state === "confirmed" && !effects && row.evidence) {
      effects = await this.effects(viewer, row, JSON.parse(row.evidence) as SaleResolution);
      row = this.own(viewer, id);
    }
    return {
      action: view(row),
      resolution: row.evidence ? (JSON.parse(row.evidence) as SaleResolution) : null,
      transaction,
      effects,
    };
  }

  /** Bounded, explicit resolution by this action's own transaction; a readback only informs. */
  async check(viewer: Viewer, id: string, input: Record<string, unknown> = {}) {
    const p = this.own(viewer, id);
    if (!CHECKABLE.includes(p.state)) {
      // Already settled: its stored result (and a follow-up that never finished, repeated).
      const s = await this.stored(viewer, id, null);
      return { ...s, resolution: null };
    }
    if (!this.reader) bad(503, "Wallet sales aren't connected on this server.", "sale_unavailable");
    const reader = this.reader as CustomerViewTransport;
    if (
      input.tx_hash !== undefined &&
      !(typeof input.tx_hash === "string" && TX_HASH.test(input.tx_hash))
    )
      bad(400, "That isn't a NEAR transaction ID", "bad_tx_hash");
    const named = (input.tx_hash as string | undefined) ?? null;
    const which = named ?? p.tx_hash;
    let transaction: { hash: string; matched: boolean } | null = null;
    if (which && reader.txOutcome) {
      const r = await reader.txOutcome(which, p.account).catch(() => null);
      const res = r ? resolveSaleTx(p, r, which) : null;
      if (named) transaction = { hash: named, matched: res !== null };
      if (res?.kind === "confirmed" && p.kind === "create_plan") {
        // Job 003wf4 (§4): confirmed only once the plan reads back exactly as reviewed, at the
        // reviewed generation. Until then nothing is committed and the check can be repeated.
        const verified = await this.planReadback(p);
        if (verified.ok === false) {
          // Astra 05:37: the receipt IS this request's own: its identity is kept durably now, so a
          // reload or restart recovers it without the ID again. Only into an empty identity, on the
          // row as read, and only while it is still checkable (a concurrent result is never undone).
          if (p.tx_hash === null)
            this.db
              .prepare(
                `UPDATE sale_actions SET tx_hash = ?, rev = rev + 1, updated_at = ? WHERE id = ? AND rev = ? AND tx_hash IS NULL AND ${CHECKABLE_SQL}`,
              )
              .run(which, this.stamp(), p.id, p.rev);
          // Astra 05:52: another check settled it meanwhile: answer with ITS stored outcome, never
          // a stale "unknown" beside a confirmed row.
          const now = this.own(viewer, id);
          if (!CHECKABLE.includes(now.state)) return this.stored(viewer, id, transaction);
          return {
            action: view(this.own(viewer, id)),
            resolution: { kind: "unknown", message: verified.message } as SaleResolution,
            transaction,
            effects: null,
          };
        }
        Object.assign(res, { verified: verified.evidence });
      }
      if (res) {
        // This transaction is exactly this request. A definitive result is committed with this
        // hash; a pending one (a claim without its callback yet) keeps the row checkable.
        const state: State =
          res.kind === "confirmed" || res.kind === "refused" ? res.kind : "unknown";
        const hash = state === "unknown" ? (p.tx_hash ?? which) : which;
        if (!this.commit(p, state, res, hash)) return this.stored(viewer, id, transaction);
        const effects =
          res.kind === "confirmed" ? await this.effects(viewer, this.own(viewer, id), res) : null;
        return { action: view(this.own(viewer, id)), resolution: res, transaction, effects };
      }
    } else if (named) transaction = { hash: named, matched: false };
    if (p.state === "prepared")
      return {
        action: view(p),
        resolution: {
          kind: "unknown",
          message: "Your wallet hasn't been asked for this request yet.",
        } as SaleResolution,
        transaction,
        effects: null,
      };
    // No proof from this action's own transaction: can it still take effect?
    const res = await this.stillPossible(p);
    const state: State = res.kind === "no_longer_possible" ? "no_longer_possible" : "unknown";
    if (!this.commit(p, state, res, p.tx_hash)) return this.stored(viewer, id, transaction);
    return { action: view(this.own(viewer, id)), resolution: res, transaction, effects: null };
  }

  /**
   * Job 003wf4: the created plan, read back at one final block: every reviewed field and the
   * reviewed generation. A failed read or any difference is no confirmation.
   */
  private async planReadback(
    p: SaleActionRow,
  ): Promise<{ ok: true; evidence: unknown } | { ok: false; message: string }> {
    const review = JSON.parse(p.review) as Record<string, unknown>;
    const want = review.plan as PlanInputV3;
    const id = Number(review.plan_id);
    const reader = this.reader as CustomerViewTransport;
    const signal = AbortSignal.timeout(this.opts.readTimeoutMs ?? 10_000);
    try {
      const final = await reader.finalBlock(p.network, signal);
      const pinned = checkBlock(final, "final block");
      const a = await reader.view({
        network: p.network,
        account: p.contract,
        method: "get_plan",
        args: { plan_id: id },
        block: pinned,
        signal,
      });
      const b = checkBlock(a?.block, "get_plan");
      if (b.height !== pinned.height || b.hash !== pinned.hash || typeof a.result !== "string")
        throw new Error("mixed");
      const got = JSON.parse(a.result) as Record<string, unknown> | null;
      const same =
        got !== null &&
        got.unit_price === want.unit_price &&
        got.max_units_per_purchase === want.max_units_per_purchase &&
        got.max_units_outstanding === want.max_units_outstanding &&
        got.max_hold_units === want.max_hold_units &&
        got.hold_ttl_ms === want.hold_ttl_ms &&
        got.settle_grace_ms === want.settle_grace_ms &&
        got.created_generation === review.generation;
      if (!same)
        return {
          ok: false,
          message: `Its own transaction created plan ${id}, but that plan doesn't read back as reviewed at this owner generation, so it isn't treated as confirmed. Check again; nothing is created twice.`,
        };
      return { ok: true, evidence: { plan_id: id, plan: got, block: pinned } };
    } catch {
      return {
        ok: false,
        message: `Its own transaction created plan ${id}; the plan couldn't be read back just now, so it isn't confirmed yet. Check again.`,
      };
    }
  }

  /**
   * From one fresh final read: whether this request could still take effect (§5). Only
   * irreversible evidence marks it inapplicable: control_seq and payout_seq only rise; deal
   * numbers never repeat and versions only rise. Never an acceptance flag (unfund clears it) and
   * never a registration (the token can unregister).
   */
  private async stillPossible(p: SaleActionRow): Promise<SaleResolution> {
    const s = await this.read({ network: p.network, account: p.contract }, p.account, p.account);
    const [kind, a, b] = p.identity.split(":");
    let gone = false;
    if (kind === "control") gone = BigInt(s.control.control_seq) > BigInt(a as string);
    else if (kind === "accept") {
      const d = s.control.live_deal;
      gone = !d || d.seq !== a || BigInt(d.version) > BigInt(b as string);
    } else if (kind === "claim")
      gone = s.terms !== null && BigInt(s.terms.payout_seq) > BigInt(b as string);
    if (gone)
      return {
        kind: "no_longer_possible",
        message:
          p.kind === "create_plan" || p.kind === "appoint"
            ? "This business's control changed since this request was reviewed, so the contract can never accept it from now on. Whether it took effect before is shown only by its own transaction: if your wallet's activity lists it, enter its ID."
            : "The sale has moved on since this request was reviewed, so the contract can never accept it from now on. Whether it took effect before is shown only by its own transaction: if your wallet's activity lists it, enter its ID.",
      };
    if (p.kind === "register" || p.kind === "accept")
      return {
        kind: "unknown",
        message:
          "This request isn't shown to have landed yet, and it can't be replaced by another one: it is recovered by its own transaction. If your wallet's activity lists it, enter its ID.",
      };
    return {
      kind: "unknown",
      message:
        "This request isn't shown to have landed yet. If you approved it, it may still be processing; it stays open until its own transaction shows the outcome. If your wallet's activity lists the transaction, enter its ID.",
    };
  }

  /** What a confirmed action changes here, through the existing authority code only. */
  private async effects(viewer: Viewer, p: SaleActionRow, res: SaleResolution) {
    if (res.kind !== "confirmed") return null;
    const review = JSON.parse(p.review) as Record<string, unknown>;
    let out: Record<string, unknown> | null = null;
    try {
      if (p.kind === "propose" || p.kind === "revise") {
        await this.ensureRecorded(viewer, p.business_id, review);
        out = { recorded: { deal_seq: review.deal_seq, version: review.version } };
      } else if (p.kind === "create_plan") {
        const verified = (res as { verified?: unknown }).verified;
        if (verified) out = { plan: verified };
      } else if (p.kind === "accept" && res.result === "closing") {
        // Job 003wf3 (S-2): the gate starts as soon as this closing is confirmed here, from one
        // fresh pinned read (keyless; idempotent). Not stored as a finished follow-up: a later
        // check arms again if this read failed.
        const s = await this.read(
          { network: p.network, account: p.contract },
          p.account,
          p.account,
        );
        const h = armHandover(this.db, {
          businessId: p.business_id,
          network: p.network,
          account: p.contract,
          block: s.block,
          control: s.control,
          source: "sale_closing",
          now: (this.opts.now ?? Date.now)(),
        });
        out = { handover: h ? { state: h.state, id: h.id } : null };
      } else if (p.kind === "accept" && res.result === "closed") {
        // The handoff proof's snapshot at the first final block after the close (idempotent).
        await this.opts
          .onClosed?.(
            p.business_id,
            { network: p.network, account: p.contract },
            String(review.deal_seq),
          )
          .catch(() => null);
        const intent = this.db
          .prepare(
            "SELECT id FROM v3_intents WHERE business_id = ? AND deal_seq = ? AND version = ? AND digest = ?",
          )
          .get(
            p.business_id,
            String(review.deal_seq),
            Number(review.version),
            String(review.digest),
          ) as { id: string } | undefined;
        if (intent) {
          const r = await this.intents.reconcile(viewer as Person, p.business_id, intent.id);
          out = {
            reconcile: { state: r.state, code: r.code, message: r.message, intent: intent.id },
          };
        } else
          out = {
            reconcile: {
              state: "unrecorded",
              message: "No recorded version here matches this close.",
            },
          };
      }
    } catch (e) {
      out = {
        error:
          e instanceof HttpError
            ? e.message
            : "The local follow-up didn't complete; it can be repeated safely.",
      };
    }
    // Kept only when the follow-up reached a TERMINAL answer (Astra's addendum): the version is
    // recorded, or the reconciliation applied it, found it already applied, or answered conflict /
    // ended / superseded. A failed read, "pending", a missing record or an error isn't finished: it
    // is not stored, so the next check runs it again. The first terminal answer wins (a late
    // retryable answer can never overwrite it).
    const state = (out?.reconcile as { state?: string } | undefined)?.state;
    const terminal =
      out !== null &&
      !("error" in out) &&
      ("recorded" in out ||
        "plan" in out ||
        ["applied", "already", "conflict", "ended", "superseded"].includes(String(state)));
    if (terminal)
      this.db
        .prepare(
          "UPDATE sale_actions SET effects = ?, rev = rev + 1, updated_at = ? WHERE id = ? AND state = 'confirmed' AND effects IS NULL",
        )
        .run(JSON.stringify(out), this.stamp(), p.id);
    // Report the AUTHORITATIVE result: whatever terminal answer is stored now (this attempt's, or
    // an earlier or concurrent one's), never this attempt's stale retryable answer over it.
    const stored = (
      this.db.prepare("SELECT effects FROM sale_actions WHERE id = ?").get(p.id) as
        | { effects: string | null }
        | undefined
    )?.effects;
    if (stored) return { ...(JSON.parse(stored) as Record<string, unknown>), finished: true };
    return out ? { ...out, finished: false } : out;
  }

  /** Sets aside a request the wallet was NEVER asked for. An asked one stays tracked. */
  abandon(viewer: Viewer, id: string) {
    const p = this.own(viewer, id);
    if (p.state !== "prepared")
      bad(
        409,
        CHECKABLE.includes(p.state)
          ? "Your wallet was asked for this request, so it stays tracked until its own transaction shows the outcome."
          : "That request already has its outcome.",
        CHECKABLE.includes(p.state) ? "action_requested" : "action_settled",
      );
    this.db
      .prepare(
        "UPDATE sale_actions SET state = 'set_aside', rev = rev + 1, updated_at = ? WHERE id = ? AND state = 'prepared'",
      )
      .run(this.stamp(), id);
    return { action: view(this.own(viewer, id)) };
  }

  /** The viewer's sales: businesses with their own actions, terms naming them, or intents. */
  mine(viewer: Viewer) {
    const rows = this.db
      .prepare(
        `SELECT business_id, MAX(at) AS at FROM (
           SELECT business_id, updated_at AS at FROM sale_actions WHERE person_id = ?
           UNION ALL SELECT business_id, created_at FROM sale_terms_docs WHERE buyer_person_id = ? OR seller_person_id = ?
           UNION ALL SELECT business_id, updated_at FROM v3_intents WHERE buyer_person_id = ? OR seller_person_id = ?
         ) GROUP BY business_id ORDER BY at DESC LIMIT 20`,
      )
      .all(viewer.id, viewer.id, viewer.id, viewer.id, viewer.id) as {
      business_id: string;
      at: string;
    }[];
    return {
      sales: rows.map((r) => {
        const b = this.business(r.business_id);
        return {
          business: { id: r.business_id, name: b?.name ?? null },
          you_own_it_now: b?.owner_id === viewer.id,
          updated_at: r.at,
        };
      }),
    };
  }
}

function view(p: SaleActionRow) {
  return {
    id: p.id,
    business_id: p.business_id,
    kind: p.kind,
    account: p.account,
    network: p.network,
    contract: p.contract,
    asset: p.asset,
    identity: p.identity,
    deal_seq: p.deal_seq,
    version: p.version,
    call: JSON.parse(p.call) as WalletCall,
    action_digest: p.action_digest,
    review: JSON.parse(p.review) as Record<string, unknown>,
    replaces: p.replaces,
    idempotency_key: p.idempotency_key,
    state: p.state,
    tx_hash: p.tx_hash,
    asks: p.asks,
    evidence: p.evidence ? (JSON.parse(p.evidence) as SaleResolution) : null,
    effects: p.effects ? (JSON.parse(p.effects) as Record<string, unknown>) : null,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}
export type SaleActionView = ReturnType<typeof view>;
