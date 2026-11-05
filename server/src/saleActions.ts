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
import {
  acceptCall,
  appointCall,
  CLAIM_ESCROW_RETURN,
  CLAIM_PROFIT,
  CLAIM_SALE_PROCEEDS,
  canonicalTerms,
  claimCall,
  claimOf,
  dealDigest,
  dealStepCall,
  decodeParty,
  decodeSaleTerms,
  exclusivity,
  fundCall,
  INCLUDED,
  METERING,
  NOT_INCLUDED,
  offerWindow,
  type PartyV3,
  proposeCall,
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
  created_at: string;
  updated_at: string;
}

export function migrateSaleActions(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sale_actions (
      id TEXT PRIMARY KEY, business_id TEXT NOT NULL, person_id TEXT NOT NULL, account TEXT NOT NULL,
      network TEXT NOT NULL, contract TEXT NOT NULL, asset TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN (${SALE_KINDS.map((k) => `'${k}'`).join(",")})),
      identity TEXT NOT NULL, deal_seq TEXT, version INTEGER,
      call TEXT NOT NULL, action_digest TEXT NOT NULL, review TEXT NOT NULL,
      terms_id TEXT, replaces TEXT, idempotency_key TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('prepared','requested','unknown','confirmed','refused','no_longer_possible','set_aside')),
      tx_hash TEXT, asks INTEGER NOT NULL DEFAULT 0, evidence TEXT, effects TEXT,
      rev INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE (person_id, idempotency_key)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS sale_actions_by_business ON sale_actions (business_id, account, state);
    CREATE TABLE IF NOT EXISTS sale_terms_docs (
      id TEXT PRIMARY KEY, business_id TEXT NOT NULL, hash TEXT NOT NULL, text TEXT NOT NULL,
      seller_person_id TEXT NOT NULL, buyer_person_id TEXT NOT NULL, buyer_account TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (business_id, hash)
    ) STRICT;
  `);
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
    case "appoint":
      return eventsOf(first, "operator_appointed").some(
        (d) => d.account === review.operator && d.caps === METERING,
      )
        ? {
            kind: "confirmed",
            result: "appointed",
            message:
              "Metering is appointed for this generation: customers' new uses can be served.",
          }
        : null;
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
  readTimeoutMs?: number;
  now?: () => number;
}

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

  /** One coherent reading at one pinned final block, bounded by one deadline. */
  private async read(
    binding: { network: string; account: string },
    viewerAccount: string,
    termsFor: string,
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
      const asset = r.treasury.asset;
      const [meta, balance, mine, biz, bounds] = await Promise.all([
        at(asset, "ft_metadata", {}),
        at(asset, "ft_balance_of", { account_id: viewerAccount }),
        at(asset, "storage_balance_of", { account_id: viewerAccount }),
        at(asset, "storage_balance_of", { account_id: c }),
        at(asset, "storage_balance_bounds", {}),
      ]);
      return {
        block,
        ...r,
        party: decodeParty(party),
        terms: termsRaw === null ? null : decodeSaleTerms(termsRaw),
        token: {
          meta: validMetadata(meta),
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
    return {
      business: { id: g.business.id, name: g.business.name },
      network: g.binding.network,
      contract: g.binding.account,
      account: g.account,
      local_owner: localOwner,
      roles,
      capability: s.terms
        ? {
            supported: s.control.close_mode === "direct",
            reason: s.control.close_mode === "gated" ? "gated" : null,
          }
        : { supported: false, reason: "contract_upgrade" },
      block: s.block,
      control: s.control,
      outcomes: s.outcomes.filter(
        (o) => o.seller === g.account || o.buyer === g.account || localOwner,
      ),
      customer_obligations: {
        prepaid_unused: s.treasury.ent_free_value,
        reserved_in_use: s.treasury.ent_held_value,
        available: s.treasury.available,
        asset: s.treasury.asset,
      },
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
    const s = await this.read(g.binding, g.account, termsFor);
    return this.previewFrom(viewer, g, s, kind as SaleKind, input);
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
  ) {
    const no = (code: string, message: string): never => bad(409, message, code);
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
    if (s.control.close_mode !== "direct" && kind !== "claim" && kind !== "register")
      no(
        "gated",
        "This business closes through a named closer (Gated). Its close needs the closer's own integration; it can't be closed by wallet acceptances here.",
      );
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
      if (d?.state === "closing")
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
          close_window_ms: "0",
          available_floor: floor as string,
          grants,
          terms_hash: termsHash,
          expected_generation: s.control.generation,
          manifest: s.control.service_manifest,
          manifest_seq: s.control.manifest_seq,
          plan_count: terms.plan_count,
          min_reserve: terms.min_reserve,
          close_mode: "direct",
          closer: null,
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
          available_floor: floor,
          grants,
          metering_granted: meteringGranted,
          terms_hash: termsHash,
          deposit,
          deposit_basis: newRecord
            ? `The contract states a new buyer record is exactly ${terms.party_bytes} bytes at ${terms.storage_byte_cost} yoctoNEAR a byte; any excess is refunded, less is refused.`
            : "The buyer already has a record with this business: only the intentional 1 yoctoNEAR is attached.",
          escrow_returned: returned,
          effects: [
            live
              ? `Deal ${seq} becomes version ${version}; both parties' acceptances are cleared, and the buyer must accept the new version.`
              : `Deal ${seq} is proposed to ${buyerAcct}, open until the time shown.`,
            ...(returned !== "0"
              ? [
                  `The price changes, so the buyer's escrow (${returned} base units) becomes their returned-escrow claim at once.`,
                ]
              : []),
            meteringGranted
              ? "The platform's metering account is named in the terms, so customers' new uses continue right after the close."
              : "No metering account is named: after the close, customers keep their units but new uses pause until the new owner appoints metering.",
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
            "You can take it back (as a claim to collect) until the sale closes.",
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
            ? [
                "The other party has accepted these exact terms: your acceptance closes the sale in the same transaction.",
                "The buyer becomes the contract's owner at the next generation; the seller's management ends; the price becomes the seller's sale-proceeds claim.",
              ]
            : [
                "Records your acceptance of this exact version.",
                `If the ${asSeller ? "buyer" : "seller"} accepts these same terms afterwards, that acceptance closes the sale.`,
              ],
          conditions: [
            `If the ${asSeller ? "buyer" : "seller"} accepts first, your acceptance closes the sale instead of waiting.`,
            "Refused if the terms are revised (a new version), the offer expires, or the floor isn't met when it lands.",
          ],
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
        review = {
          category: cat,
          category_name: CATEGORY_NAMES[cat as number],
          amount,
          payout_seq: terms.payout_seq,
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
        if (
          s.control.operators.some(
            (o) =>
              o.account === platform &&
              (o.caps & METERING) !== 0 &&
              o.generation === s.control.generation,
          )
        )
          no(
            "already_appointed",
            "The platform's metering account is already appointed for this generation.",
          );
        call = appointCall(contract, platform as string, METERING, cs);
        review = {
          operator: platform,
          caps: METERING,
          generation: s.control.generation,
          effects: [
            `Appoints ${platform} with metering for generation ${s.control.generation}, so customers' new uses can be reserved and charged again.`,
          ],
          conditions: ["Refused without any change if control changed since this review."],
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
            }
          : kind === "claim"
            ? { category: review.category }
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
      const again = this.db
        .prepare("SELECT * FROM sale_actions WHERE person_id = ? AND idempotency_key = ?")
        .get(viewer.id, key as string) as unknown as SaleActionRow | undefined;
      if (again) return { row: again, created: false };
      const open = this.db
        .prepare(
          "SELECT * FROM sale_actions WHERE business_id = ? AND account = ? AND state IN ('prepared','requested','unknown') ORDER BY created_at",
        )
        .all(businessId, p.account) as unknown as SaleActionRow[];
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
    const p = this.own(viewer, id);
    if (input.tx_hash !== undefined) {
      if (typeof input.tx_hash !== "string" || !TX_HASH.test(input.tx_hash))
        bad(400, "That isn't a NEAR transaction ID", "bad_tx_hash");
      this.db
        .prepare(
          "UPDATE sale_actions SET tx_hash = ?, rev = rev + 1, updated_at = ? WHERE id = ? AND tx_hash IS NULL AND state IN ('requested','unknown','no_longer_possible')",
        )
        .run(input.tx_hash as string, this.stamp(), id);
      return { action: view(this.own(viewer, id)), ask: null };
    }
    const won = this.db
      .prepare(
        "UPDATE sale_actions SET state = 'requested', asks = asks + 1, rev = rev + 1, updated_at = ? WHERE id = ? AND state = 'prepared'",
      )
      .run(this.stamp(), id);
    return {
      action: view(this.own(viewer, id)),
      ask: won.changes === 1 ? ("granted" as const) : ("already_asked" as const),
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
          "The sale has moved on since this request was reviewed, so the contract can never accept it from now on. Whether it took effect before is shown only by its own transaction: if your wallet's activity lists it, enter its ID.",
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
      } else if (p.kind === "accept" && res.result === "closed") {
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
    // Kept only once the follow-up finished (an error is retried by the next check).
    if (out && !("error" in out))
      this.db
        .prepare(
          "UPDATE sale_actions SET effects = ?, rev = rev + 1, updated_at = ? WHERE id = ? AND state = 'confirmed'",
        )
        .run(JSON.stringify(out), this.stamp(), p.id);
    return out;
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
