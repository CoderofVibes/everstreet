// Job 003web (docs/design/APPLICATION_COMPOSITION.md §10, corrected after Astra's
// PurchaseDesignReview): a FRESH customer's purchase path. The server reads and verifies only; it
// never signs or sends. Every request it prepares is signed in the customer's own wallet.
//
// - The running contract declares its purchase terms (`get_purchase_terms`: version, the exact
//   shell bytes its tests prove equal the measured growth, the byte cost, registration-bound
//   buys). A contract without them is unavailable for purchase (an upgrade): the fixture constant
//   is never applied to unidentified code.
// - Purchases name their registration (`reg_id`): a replaced registration can't accept them.
// - A durable intent keeps the original purchase through a lost answer, a reload, another tab and
//   a restart. Only THIS purchase's own FINAL transaction resolves it, through its exact receipt
//   graph (the token's transfer, the business's receiver outcome, the token's resolution). A
//   readback alone never confirms one. A requested purchase is never "cancelled": it is closed as
//   not accepted only when its registration was replaced (registration-bound buys can't be
//   accepted by another). No time window closes it: the wallet picks the transaction's reference
//   block when it signs, which can be long after it was asked (Astra's recovery probe). Only a
//   preparation the wallet was never asked for can be set aside.

import { createHash, randomUUID } from "node:crypto";
import {
  type CustomerViewTransport,
  type EntitlementV3,
  type PinnedBlock,
  type PlanV3,
  readCustomerViews,
} from "./customerRead.ts";
import type { Db } from "./db.ts";
import { HttpError, type Person } from "./store.ts";

/** Only who is asking matters here. */
type Viewer = Pick<Person, "id">;

import { V3ReadError } from "./v3read.ts";

const U128_MAX = (1n << 128n) - 1n;
const U32_MAX = 0xffff_ffff;
const DEC = /^(0|[1-9][0-9]{0,38})$/;
const SYMBOL = /^[A-Za-z0-9$._-]{1,16}$/;
const TX_HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const KEY = /^[A-Za-z0-9_-]{8,80}$/;
const HEX32 = /^[0-9a-f]{64}$/;
const GAS_30 = "30000000000000";
const GAS_100 = "100000000000000";
export const TERMS_VERSION = 1;

const bad = (status: number, message: string, code?: string, detail?: unknown): never => {
  throw new HttpError(status as 400, message, code, detail as never);
};

export interface WalletCall {
  receiverId: string;
  methodName: string;
  args: Record<string, unknown>;
  gas: string;
  deposit: string;
}

/** A u128 decimal string, or null. */
export function u128(v: unknown): string | null {
  if (typeof v !== "string" || !DEC.test(v) || BigInt(v) > U128_MAX) return null;
  return v;
}

export interface PurchaseTerms {
  version: number;
  shell_bytes: string;
  storage_byte_cost: string;
  binds_registration: true;
}
/** The contract's declared terms (get_purchase_terms), validated; null when unsupported. */
export function validTerms(v: unknown): PurchaseTerms | null {
  const o = v as Record<string, unknown> | null;
  if (!o || o.version !== TERMS_VERSION || o.binds_registration !== true) return null;
  const bytes = u128(o.shell_bytes);
  const cost = u128(o.storage_byte_cost);
  if (!bytes || !cost || BigInt(bytes) > 100_000n || cost === "0") return null;
  return {
    version: TERMS_VERSION,
    shell_bytes: bytes,
    storage_byte_cost: cost,
    binds_registration: true,
  };
}

export function shellQuote(t: PurchaseTerms) {
  return {
    exact: true as const,
    bytes: t.shell_bytes,
    byte_cost: t.storage_byte_cost,
    deposit: (BigInt(t.shell_bytes) * BigInt(t.storage_byte_cost)).toString(),
    basis: `the business contract's own get_purchase_terms (version ${t.version}); its tests prove the stated size equals the growth sponsor_shell charges. Any excess deposit is refunded; less is refused.`,
  };
}

export interface TokenMeta {
  symbol: string;
  name: string;
  decimals: number;
}

/** NEP-148 metadata, validated; anything else is malformed (never a guessed symbol or scale). */
export function validMetadata(v: unknown): TokenMeta | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  if (o.spec !== "ft-1.0.0") return null;
  if (typeof o.symbol !== "string" || !SYMBOL.test(o.symbol)) return null;
  if (typeof o.name !== "string" || o.name.length < 1 || o.name.length > 64) return null;
  if (!Number.isInteger(o.decimals) || (o.decimals as number) < 0 || (o.decimals as number) > 38)
    return null;
  return { symbol: o.symbol, name: o.name, decimals: o.decimals as number };
}

function storageBalance(v: unknown): { total: string; available: string } | null | "bad" {
  if (v === null) return null;
  const o = v as Record<string, unknown> | null;
  const total = u128(o?.total);
  const available = u128(o?.available);
  return total && available ? { total, available } : "bad";
}

export const shellCall = (
  contract: string,
  customer: string,
  planId: number,
  deposit: string,
): WalletCall => ({
  receiverId: contract,
  methodName: "sponsor_shell",
  args: { customer, plan_id: planId },
  gas: GAS_30,
  deposit,
});

export const tokenStorageCall = (asset: string, account: string, deposit: string): WalletCall => ({
  receiverId: asset,
  methodName: "storage_deposit",
  args: { account_id: account, registration_only: true },
  gas: GAS_30,
  deposit,
});

export interface Install {
  slot: number;
  pk: string;
  max_hold_units: number;
  max_units_per_day: number;
}

/** The exact purchase request (registration-bound: reg_id is always named). */
export const buyCall = (
  asset: string,
  contract: string,
  amount: string,
  buy: {
    plan_id: number;
    units: number;
    purchase_seq: number;
    install: Install | null;
    reg_id: string;
  },
): WalletCall => ({
  receiverId: asset,
  methodName: "ft_transfer_call",
  args: {
    receiver_id: contract,
    amount,
    msg: JSON.stringify({
      buy: {
        plan_id: buy.plan_id,
        units: buy.units,
        purchase_seq: buy.purchase_seq,
        install: buy.install,
        reg_id: buy.reg_id,
      },
    }),
  },
  gas: GAS_100,
  deposit: "1",
});

/** The digest the customer reviews; a fresh read must reproduce it exactly (§10.3). */
export function termsDigest(t: {
  account: string;
  network: string;
  contract: string;
  asset: string;
  reg_id: string;
  purchase_seq: number;
  units: number;
  amount: string;
  call: WalletCall;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        t.account,
        t.network,
        t.contract,
        t.asset,
        t.reg_id,
        t.purchase_seq,
        t.units,
        t.amount,
        t.call.receiverId,
        t.call.methodName,
        t.call.args,
        t.call.deposit,
        t.call.gas,
      ]),
    )
    .digest("hex");
}

interface OfferRow {
  id: string;
  business_id: string;
  network: string;
  account: string;
  plan_id: number;
  plan: string;
  asset: string;
  state: "active" | "retired";
}

type State =
  | "prepared"
  | "requested"
  | "unknown"
  | "confirmed"
  | "returned"
  | "not_accepted"
  | "set_aside"
  /** Set aside by an earlier version (which allowed it after the wallet was asked): checkable. */
  | "legacy_abandoned";
export interface PurchaseRow {
  id: string;
  person_id: string;
  customer_account: string;
  offer_id: string;
  network: string;
  contract: string;
  asset: string;
  plan_id: number;
  reg_id: string;
  purchase_seq: number;
  units: number;
  amount: string;
  install: string | null;
  call: string;
  terms_digest: string;
  idempotency_key: string;
  state: State;
  tx_hash: string | null;
  /** How many times the wallet was asked (a returned attempt is definitive only at 1). */
  asks?: number;
  evidence: string | null;
  created_at: string;
  updated_at: string;
}
const OPEN: State[] = ["prepared", "requested", "unknown"];
/** States a check may still resolve (an old set-aside may yet have executed). */
const CHECKABLE: State[] = [...OPEN, "legacy_abandoned"];
const CHECKABLE_SQL = "state IN ('prepared','requested','unknown','legacy_abandoned')";

const PURCHASES_TABLE = (name: string) => `
    CREATE TABLE IF NOT EXISTS ${name} (
      id TEXT PRIMARY KEY, person_id TEXT NOT NULL, customer_account TEXT NOT NULL,
      offer_id TEXT NOT NULL, business_id TEXT NOT NULL, network TEXT NOT NULL,
      contract TEXT NOT NULL, asset TEXT NOT NULL, plan_id INTEGER NOT NULL, reg_id TEXT NOT NULL,
      purchase_seq INTEGER NOT NULL, units INTEGER NOT NULL, amount TEXT NOT NULL, install TEXT,
      call TEXT NOT NULL, terms_digest TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('prepared','requested','unknown','confirmed','returned','not_accepted','set_aside','legacy_abandoned')),
      tx_hash TEXT, asks INTEGER NOT NULL DEFAULT 0,
      evidence TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE (person_id, idempotency_key)
    ) STRICT;`;
const ONE_OPEN = `CREATE UNIQUE INDEX IF NOT EXISTS customer_purchases_one_open
      ON customer_purchases (customer_account, contract, plan_id)
      WHERE state IN ('prepared', 'requested', 'unknown');`;

/**
 * Creates the table, or upgrades the earlier one (e6375d2: no ask count; states ending in
 * 'abandoned'; Astra's migration probe) in ONE transaction, keeping every row:
 * - an open row's asks weren't counted, so it becomes "possibly asked more than once" (2): a
 *   return seen for it is never taken as definitive;
 * - an 'abandoned' row may have been set aside after its wallet was asked (that version allowed
 *   it), so it may still execute: it becomes 'legacy_abandoned', still checkable by its own
 *   transaction, and (as before) not blocking new purchases.
 */
export function migratePurchases(db: Db) {
  const cols = (
    db.prepare("PRAGMA table_info(customer_purchases)").all() as { name: string }[]
  ).map((c) => c.name);
  if (cols.length > 0 && !cols.includes("asks")) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec("DROP INDEX IF EXISTS customer_purchases_one_open");
      db.exec("ALTER TABLE customer_purchases RENAME TO customer_purchases_before_asks");
      db.exec(PURCHASES_TABLE("customer_purchases"));
      const keep =
        "id, person_id, customer_account, offer_id, business_id, network, contract, asset, plan_id, reg_id, purchase_seq, units, amount, install, call, terms_digest, idempotency_key, tx_hash, evidence, created_at, updated_at";
      db.exec(
        `INSERT INTO customer_purchases (${keep}, state, asks)
         SELECT ${keep},
           CASE WHEN state = 'abandoned' THEN 'legacy_abandoned' ELSE state END,
           CASE WHEN state IN ('requested', 'unknown', 'abandoned') THEN 2 ELSE 0 END
         FROM customer_purchases_before_asks`,
      );
      db.exec("DROP TABLE customer_purchases_before_asks");
      db.exec(ONE_OPEN);
      db.exec("COMMIT");
    } catch (e) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw e;
    }
    return;
  }
  db.exec(PURCHASES_TABLE("customer_purchases"));
  db.exec(ONE_OPEN);
}

export type Resolution =
  | { kind: "confirmed"; units: number; amount: string }
  | { kind: "returned"; amount: string; reason: string }
  | { kind: "not_accepted"; message: string }
  | { kind: "unknown"; message: string; purchase_seq_now: number | null; free_now: string | null };

type Receipt = {
  executor_id?: unknown;
  logs?: unknown[];
  receipt_ids?: unknown[];
  status?: Record<string, unknown>;
};
const succeeded = (r: Receipt | undefined) =>
  Boolean(r?.status && typeof r.status === "object" && "SuccessValue" in r.status);
const value = (r: Receipt): unknown => {
  try {
    return JSON.parse(Buffer.from(String(r.status?.SuccessValue), "base64").toString("utf8"));
  } catch {
    return undefined;
  }
};

/**
 * One FINAL transaction, checked to be EXACTLY this intent's request, then its receipt graph:
 * the transaction's single receipt is the token's transfer (succeeded), whose children are the
 * business's receiver outcome and the token's resolution. Accepted: the receiver succeeded,
 * returned 0 unused and logged `units_bought` for exactly this purchase, and the resolution
 * succeeded using the whole amount. Returned: the receiver logged `purchase_returned` with the
 * whole amount unused AND the resolution succeeded using none (and the transaction didn't fail).
 * Anything else, including a failed or disconnected receipt or a non-final answer, is no evidence
 * (null).
 */
export function resolveFromTx(
  p: PurchaseRow,
  r: unknown,
  hash: string | null = p.tx_hash,
): Resolution | null {
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
  if (!o || o.final_execution_status !== "FINAL") return null;
  const t = o.transaction;
  if (
    !t ||
    !hash ||
    t.hash !== hash ||
    t.signer_id !== p.customer_account ||
    t.receiver_id !== p.asset
  )
    return null;
  if (!Array.isArray(t.actions) || t.actions.length !== 1) return null;
  const fc = (t.actions[0] as { FunctionCall?: Record<string, unknown> })?.FunctionCall;
  if (!fc || fc.method_name !== "ft_transfer_call" || String(fc.deposit) !== "1") return null;
  let args: unknown;
  try {
    args = JSON.parse(Buffer.from(String(fc.args), "base64").toString("utf8"));
  } catch {
    return null;
  }
  if (JSON.stringify(args) !== JSON.stringify((JSON.parse(p.call) as WalletCall).args)) return null;
  const byId = new Map<string, Receipt>();
  for (const x of o.receipts_outcome ?? [])
    if (typeof x.id === "string" && x.outcome) byId.set(x.id, x.outcome);
  const first = o.transaction_outcome?.outcome?.receipt_ids;
  if (!Array.isArray(first) || first.length !== 1) return null;
  const transfer = byId.get(String(first[0]));
  if (
    !transfer ||
    transfer.executor_id !== p.asset ||
    !transfer.status ||
    "Failure" in transfer.status
  )
    return null;
  const kids = (transfer.receipt_ids ?? []).map((id) => byId.get(String(id)));
  const receiver = kids.find((k) => k?.executor_id === p.contract);
  const resolution = kids.find((k) => k?.executor_id === p.asset);
  if (!receiver || !resolution || !succeeded(receiver)) return null;
  const unused = value(receiver);
  let event: { event?: string; data?: Record<string, unknown>[] } | null = null;
  for (const log of receiver.logs ?? []) {
    if (typeof log !== "string" || !log.startsWith("EVENT_JSON:")) continue;
    try {
      const e = JSON.parse(log.slice(11)) as {
        standard?: string;
        event?: string;
        data?: Record<string, unknown>[];
      };
      if (e.standard === "business_core" && e.data?.[0]?.customer === p.customer_account) event = e;
    } catch {}
  }
  const d = event?.data?.[0];
  if (!event || !d) return null;
  const used = succeeded(resolution) ? value(resolution) : undefined;
  if (
    event.event === "units_bought" &&
    d.plan_id === p.plan_id &&
    d.units === p.units &&
    d.amount === p.amount &&
    unused === "0"
  )
    return used === p.amount ? { kind: "confirmed", units: p.units, amount: p.amount } : null;
  if (event.event === "purchase_returned" && d.amount === p.amount && unused === p.amount) {
    if (used !== "0" || (o.status && "Failure" in o.status)) return null; // refund not confirmed
    const reason = String(d.reason ?? "returned");
    if ((p.asks ?? 1) > 1)
      return {
        kind: "unknown",
        purchase_seq_now: null,
        free_now: null,
        message: `This attempt was returned in full (${reason}). The request was sent more than once, so an earlier attempt may have been accepted; check with that attempt's transaction, or see the units the contract holds for you.`,
      };
    return { kind: "returned", amount: p.amount, reason };
  }
  return null;
}

export class CustomerPurchases {
  constructor(
    private readonly db: Db,
    private readonly reader: CustomerViewTransport | null,
    private readonly opts: { readTimeoutMs?: number; now?: () => number } = {},
  ) {
    migratePurchases(db);
  }

  private get timeout() {
    return this.opts.readTimeoutMs ?? 10_000;
  }
  private stamp() {
    return new Date((this.opts.now ?? Date.now)()).toISOString();
  }
  private offer(id: string) {
    const o = this.db.prepare("SELECT * FROM customer_offers WHERE id = ?").get(id) as unknown as
      | OfferRow
      | undefined;
    if (!o) bad(404, "No such offer");
    return o as OfferRow;
  }
  private accountOf(personId: string) {
    const r = this.db
      .prepare("SELECT account_id FROM chain_accounts WHERE owner_kind = 'person' AND owner_id = ?")
      .get(personId) as { account_id: string } | undefined;
    return r?.account_id ?? null;
  }
  private own(viewer: Viewer, id: string) {
    const p = this.db.prepare("SELECT * FROM customer_purchases WHERE id = ?").get(id) as unknown as
      | PurchaseRow
      | undefined;
    if (!p || p.person_id !== viewer.id) bad(404, "No such purchase");
    return p as PurchaseRow;
  }
  private open(account: string, contract: string, planId: number) {
    return (
      (this.db
        .prepare(
          "SELECT * FROM customer_purchases WHERE customer_account = ? AND contract = ? AND plan_id = ? AND state IN ('prepared','requested','unknown')",
        )
        .get(account, contract, planId) as unknown as PurchaseRow | undefined) ?? null
    );
  }
  private settle(id: string, state: State, evidence: unknown) {
    this.db
      .prepare(
        `UPDATE customer_purchases SET state = ?, evidence = ?, updated_at = ? WHERE id = ? AND ${CHECKABLE_SQL}`,
      )
      .run(state, JSON.stringify(evidence), this.stamp(), id);
  }

  /** One view on `account` at the pinned block, bounded and from that block only. */
  private async at(
    account: string,
    network: string,
    method: string,
    args: Record<string, unknown>,
    block: PinnedBlock,
  ) {
    const reader = this.reader as CustomerViewTransport;
    const a = await reader.view({ network, account, method, args, block });
    if (a.block.height !== block.height || a.block.hash !== block.hash)
      bad(503, "NEAR answered from another block; try again", "mixed_blocks");
    if (typeof a.result !== "string" || a.result.length > 4096)
      bad(503, "NEAR's answer isn't usable", "malformed");
    try {
      return JSON.parse(a.result) as unknown;
    } catch {
      return bad(503, "NEAR's answer isn't usable", "malformed");
    }
  }

  /** The whole prerequisite picture at ONE final block (§10.2), and an exact preview. */
  async setup(
    viewer: Viewer,
    offerId: string,
    want: { units?: number; install?: Install | null } = {},
  ) {
    if (!this.reader) bad(503, "Buying isn't connected on this server", "purchase_unavailable");
    const o = this.offer(offerId);
    const customer = this.accountOf(viewer.id);
    if (!customer) bad(409, "You have no NEAR account linked here", "no_chain_account");
    const account = customer as string;
    const read = await readCustomerViews(
      this.reader as CustomerViewTransport,
      o,
      { plan: o.plan_id, entitlement: { customer: account, plan_id: o.plan_id } },
      this.timeout,
    ).catch(readFailed);
    const plan = read.plan as PlanV3 | null;
    if (!plan || JSON.stringify(plan) !== o.plan)
      bad(409, "The contract's plan differs from the offer", "plan_changed");
    const block = read.block;
    const token = (method: string, args: Record<string, unknown>) =>
      this.at(o.asset, o.network, method, args, block).catch((e) => {
        if (e instanceof HttpError) throw e;
        return bad(503, "The token couldn't be read; try again", "token_unavailable");
      });
    const [termsRaw, metaRaw, balanceRaw, mineRaw, bizRaw, boundsRaw] = await Promise.all([
      // An older contract has no such view: purchase is then unavailable (an upgrade).
      this.at(o.account, o.network, "get_purchase_terms", { customer: account }, block).catch(
        () => null,
      ),
      token("ft_metadata", {}),
      token("ft_balance_of", { account_id: account }),
      token("storage_balance_of", { account_id: account }),
      token("storage_balance_of", { account_id: o.account }),
      token("storage_balance_bounds", {}),
    ]);
    const terms = validTerms(termsRaw);
    const meta = validMetadata(metaRaw);
    const balance = u128(balanceRaw);
    const mine = storageBalance(mineRaw);
    const biz = storageBalance(bizRaw);
    const minDeposit = u128((boundsRaw as { min?: unknown } | null)?.min);
    if (!meta || balance === null || mine === "bad" || biz === "bad" || !minDeposit)
      bad(503, "The token's answers aren't valid", "token_malformed");
    const e = read.entitlement as EntitlementV3 | null;
    const held = e?.hold_active ? e.hold_units - e.hold_charged : 0;
    const quote = terms ? shellQuote(terms) : null;
    const steps: string[] = [];
    if (!terms) steps.push("contract_upgrade");
    if (!e) steps.push("shell");
    if (mine === null) steps.push("token_storage");
    if (biz === null) steps.push("business_token_storage");
    const openRow = this.open(account, o.account, o.plan_id);
    const out = {
      block,
      network: o.network,
      contract: o.account,
      asset: o.asset,
      plan_id: o.plan_id,
      customer: account,
      offer_state: o.state,
      terms,
      plan: {
        unit_price: plan?.unit_price,
        max_units_per_purchase: plan?.max_units_per_purchase,
        max_units_outstanding: plan?.max_units_outstanding,
        max_hold_units: plan?.max_hold_units,
      },
      token: {
        symbol: meta?.symbol,
        name: meta?.name,
        decimals: meta?.decimals,
        balance,
        customer_registered: mine !== null,
        business_registered: biz !== null,
        storage_min: minDeposit,
      },
      entitlement: e
        ? {
            reg_id: e.reg_id,
            active: e.active,
            purchase_seq: e.purchase_seq,
            free: e.free,
            held,
            purchased: e.purchased,
          }
        : null,
      shell: {
        needed: !e,
        quote,
        call: !e && quote ? shellCall(o.account, account, o.plan_id, quote.deposit) : null,
      },
      token_storage: {
        needed: mine === null,
        call: mine === null ? tokenStorageCall(o.asset, account, minDeposit as string) : null,
      },
      steps,
      open: openRow ? view(openRow) : null,
      preview: null as null | ReturnType<typeof preview>,
    };
    if (want.units !== undefined)
      out.preview = terms
        ? preview(out, plan as PlanV3, e, held, want)
        : {
            code: "contract_upgrade",
            problem:
              "This business's contract predates purchase support here (it doesn't state its purchase terms). The owner needs to upgrade it before anyone can buy.",
          };
    return out;
  }

  /** Stores the reviewed purchase, only if a FRESH read reproduces exactly what was reviewed. */
  async create(viewer: Viewer, offerId: string, input: Record<string, unknown>) {
    const key = input.idempotency_key;
    if (typeof key !== "string" || !KEY.test(key))
      bad(400, "idempotency_key must be 8 to 80 letters, digits, dashes or underscores");
    const prior = this.db
      .prepare("SELECT * FROM customer_purchases WHERE person_id = ? AND idempotency_key = ?")
      .get(viewer.id, key as string) as unknown as PurchaseRow | undefined;
    if (prior) {
      if (prior.terms_digest !== input.terms_digest)
        bad(409, "That key was used for a different purchase", "idempotency_conflict");
      return { created: false, purchase: view(prior) };
    }
    const units = input.units;
    if (typeof units !== "number" || !Number.isInteger(units))
      bad(400, "units must be a whole number");
    const install = parseInstall(input.install);
    const s = await this.setup(viewer, offerId, { units: units as number, install });
    if (s.offer_state !== "active") bad(409, "This offer was withdrawn", "offer_retired");
    if (s.open)
      bad(409, "A purchase is still waiting for its outcome", "purchase_open", {
        purchase: s.open,
      });
    const p = s.preview;
    if (!p || "problem" in p)
      bad(409, p?.problem ?? "That purchase can't be made", p?.code ?? "purchase_refused");
    const ok = p as Extract<NonNullable<typeof p>, { call: WalletCall }>;
    if (input.terms_digest !== ok.terms_digest)
      bad(409, "The purchase changed since you reviewed it; review it again", "terms_changed", {
        preview: ok,
      });
    const now = this.stamp();
    const id = randomUUID();
    const o = this.offer(offerId);
    try {
      this.db
        .prepare(
          `INSERT INTO customer_purchases (id, person_id, customer_account, offer_id, business_id, network, contract, asset, plan_id, reg_id, purchase_seq, units, amount, install, call, terms_digest, idempotency_key, state, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?)`,
        )
        .run(
          id,
          viewer.id,
          s.customer,
          offerId,
          o.business_id,
          s.network,
          s.contract,
          s.asset,
          s.plan_id,
          ok.reg_id,
          ok.purchase_seq,
          ok.units,
          ok.amount,
          install ? JSON.stringify(install) : null,
          JSON.stringify(ok.call),
          ok.terms_digest,
          key as string,
          now,
          now,
        );
    } catch {
      // Another tab stored one first (the one-open index): that one is recovered instead.
      const other = this.open(s.customer, s.contract, s.plan_id);
      bad(409, "A purchase is still waiting for its outcome", "purchase_open", {
        purchase: other ? view(other) : null,
      });
    }
    return { created: true, purchase: view(this.own(viewer, id)) };
  }

  /**
   * Called with no hash just BEFORE each wallet request (an ask; durable before the wallet is
   * asked, so a crash after it is still "requested"), and with the hash after one answers.
   */
  requested(viewer: Viewer, id: string, input: Record<string, unknown>) {
    const p = this.own(viewer, id);
    if (!OPEN.includes(p.state)) return { purchase: view(p) };
    const hash =
      typeof input.tx_hash === "string" && TX_HASH.test(input.tx_hash) ? input.tx_hash : null;
    this.db
      .prepare(
        "UPDATE customer_purchases SET state = CASE WHEN state = 'prepared' THEN 'requested' ELSE state END, tx_hash = COALESCE(tx_hash, ?), asks = asks + ?, updated_at = ? WHERE id = ?",
      )
      .run(hash, hash ? 0 : 1, this.stamp(), id);
    return { purchase: view(this.own(viewer, id)) };
  }

  /** Bounded, explicit resolution (§10.4, corrected). */
  async check(viewer: Viewer, id: string, input: Record<string, unknown> = {}) {
    let p = this.own(viewer, id);
    if (!CHECKABLE.includes(p.state)) return { purchase: view(p), resolution: null };
    if (!this.reader) bad(503, "Buying isn't connected on this server", "purchase_unavailable");
    const reader = this.reader as CustomerViewTransport;
    const named =
      typeof input.tx_hash === "string" && TX_HASH.test(input.tx_hash) ? input.tx_hash : null;
    if (named && !p.tx_hash) {
      this.db
        .prepare("UPDATE customer_purchases SET tx_hash = ? WHERE id = ? AND tx_hash IS NULL")
        .run(named, id);
      p = this.own(viewer, id);
    }
    // The transaction to verify: one named now (e.g. an earlier attempt's, from the wallet's
    // history), else the one recorded. It must be exactly this request either way.
    const which = named ?? p.tx_hash;
    if (which && reader.txOutcome) {
      const r = await reader.txOutcome(which, p.customer_account).catch(() => null);
      const res = r ? resolveFromTx(p, r, which) : null;
      if (res && res.kind !== "unknown") {
        if (res.kind === "confirmed" && which !== p.tx_hash)
          this.db.prepare("UPDATE customer_purchases SET tx_hash = ? WHERE id = ?").run(which, id);
        this.settle(id, res.kind, res);
        return { purchase: view(this.own(viewer, id)), resolution: res };
      }
      if (res) {
        this.settle(id, "unknown", res);
        return { purchase: view(this.own(viewer, id)), resolution: res };
      }
    }
    // No proof from this purchase's own transaction: the readback informs and may close it as not
    // accepted (never confirm it).
    const read = await readCustomerViews(
      reader,
      { network: p.network, account: p.contract },
      { entitlement: { customer: p.customer_account, plan_id: p.plan_id } },
      this.timeout,
    ).catch(readFailed);
    const e = read.entitlement as EntitlementV3 | null;
    if (p.state !== "prepared" && (!e || e.reg_id !== p.reg_id)) {
      const res: Resolution = {
        kind: "not_accepted",
        message:
          "The registration this purchase was made for no longer exists, and the contract refuses a purchase for any other registration, so it can't be accepted. If the token took a payment for it, the contract returned it; the token's own records show that refund.",
      };
      this.settle(id, "not_accepted", res);
      return { purchase: view(this.own(viewer, id)), resolution: res };
    }
    const seqNow = e ? e.purchase_seq : null;
    const res: Resolution = {
      kind: "unknown",
      purchase_seq_now: seqNow,
      free_now: e ? e.free : null,
      message:
        seqNow !== null && seqNow >= p.purchase_seq
          ? "A purchase with this request's sequence is recorded, but it can't be shown to be this one (no transaction from your wallet was available to check). The units shown are what the contract holds for you."
          : p.state === "prepared"
            ? "Your wallet hasn't been asked for this purchase yet."
            : "This purchase isn't recorded yet. If you approved it, it may still be processing; if your wallet's window is still open, it can still be approved. It stays open until its own transaction shows the outcome. You can ask your wallet again for exactly the same purchase: at most one is ever accepted.",
    };
    if (p.state !== "prepared") this.settle(id, "unknown", res);
    return { purchase: view(this.own(viewer, id)), resolution: res };
  }

  /**
   * Sets aside a preparation the wallet was NEVER asked for (state prepared: the ask is recorded
   * durably before any wallet request). A requested or unknown purchase is never set aside: it may
   * still execute, so it stays tracked (Astra's recovery probe).
   */
  abandon(viewer: Viewer, id: string) {
    const p = this.own(viewer, id);
    if (p.state !== "prepared")
      bad(
        409,
        OPEN.includes(p.state)
          ? "Your wallet was asked for this purchase, so it stays open until its outcome is known"
          : "That purchase already has its outcome",
        OPEN.includes(p.state) ? "purchase_requested" : "purchase_settled",
      );
    this.db
      .prepare(
        "UPDATE customer_purchases SET state = 'set_aside', updated_at = ? WHERE id = ? AND state = 'prepared'",
      )
      .run(this.stamp(), id);
    return { purchase: view(this.own(viewer, id)) };
  }

  list(viewer: Viewer, offerId?: string) {
    const rows = (offerId
      ? this.db
          .prepare(
            "SELECT * FROM customer_purchases WHERE person_id = ? AND offer_id = ? ORDER BY created_at DESC LIMIT 20",
          )
          .all(viewer.id, offerId)
      : this.db
          .prepare(
            "SELECT * FROM customer_purchases WHERE person_id = ? ORDER BY created_at DESC LIMIT 20",
          )
          .all(viewer.id)) as unknown as PurchaseRow[];
    return { purchases: rows.map(view) };
  }
}

function view(p: PurchaseRow) {
  return {
    id: p.id,
    offer_id: p.offer_id,
    customer: p.customer_account,
    network: p.network,
    contract: p.contract,
    asset: p.asset,
    plan_id: p.plan_id,
    reg_id: p.reg_id,
    purchase_seq: p.purchase_seq,
    units: p.units,
    amount: p.amount,
    install: p.install ? (JSON.parse(p.install) as Install) : null,
    call: JSON.parse(p.call) as WalletCall,
    terms_digest: p.terms_digest,
    idempotency_key: p.idempotency_key,
    state: p.state,
    tx_hash: p.tx_hash,
    asks: p.asks ?? 0,
    evidence: p.evidence ? (JSON.parse(p.evidence) as Resolution) : null,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}
export type PurchaseView = ReturnType<typeof view>;

function parseInstall(v: unknown): Install | null {
  if (v === undefined || v === null) return null;
  const o = v as Record<string, unknown>;
  if (
    !Number.isInteger(o.slot) ||
    (o.slot as number) < 0 ||
    (o.slot as number) > 3 ||
    typeof o.pk !== "string" ||
    !HEX32.test(o.pk) ||
    !Number.isInteger(o.max_hold_units) ||
    !Number.isInteger(o.max_units_per_day) ||
    (o.max_units_per_day as number) < 1 ||
    (o.max_units_per_day as number) > 65_535
  )
    bad(400, "install must name a slot 0-3, a 64-hex public key and its limits");
  return {
    slot: o.slot as number,
    pk: o.pk as string,
    max_hold_units: o.max_hold_units as number,
    max_units_per_day: o.max_units_per_day as number,
  };
}

/** The exact purchase for `units` (§10.3), or the plain reason it can't be made. */
function preview(
  s: {
    customer: string;
    network: string;
    contract: string;
    asset: string;
    plan_id: number;
    token: { balance: string | null; customer_registered: boolean; business_registered: boolean };
  },
  plan: PlanV3,
  e: EntitlementV3 | null,
  held: number,
  want: { units?: number; install?: Install | null },
) {
  const no = (code: string, problem: string) => ({ code, problem });
  const units = want.units as number;
  if (
    !Number.isInteger(units) ||
    units < 1 ||
    units > U32_MAX ||
    units > plan.max_units_per_purchase
  )
    return no("units", `Choose 1 to ${plan.max_units_per_purchase} uses.`);
  if (!e) return no("shell", "Create your registration with this business first.");
  if (!s.token.business_registered)
    return no(
      "business_token_storage",
      "The business isn't set up to receive its token yet (an owner action).",
    );
  if (!s.token.customer_registered)
    return no("token_storage", "Your account isn't registered with this token yet.");
  if (e.purchase_seq >= U32_MAX)
    return no("sequence", "This registration can't take more purchases.");
  const amount = BigInt(units) * BigInt(plan.unit_price);
  if (amount > U128_MAX) return no("amount", "That total is too large.");
  const outstanding = BigInt(e.free) + BigInt(held) + BigInt(units);
  if (outstanding > BigInt(plan.max_units_outstanding))
    return no(
      "outstanding",
      `You can hold at most ${plan.max_units_outstanding} uses at once; you have ${BigInt(e.free) + BigInt(held)}.`,
    );
  if (s.token.balance === null || BigInt(s.token.balance) < amount)
    return no("funds", "Your account doesn't hold enough of this token for that many uses.");
  const install = want.install ?? null;
  if (install) {
    if (install.max_hold_units < 1 || install.max_hold_units > plan.max_hold_units)
      return no("install", "The device key's hold limit is outside the plan.");
    if (e.keys[install.slot]?.state === "active")
      return no("install", "That key slot is in use; choose another or enroll separately.");
  }
  const purchase_seq = e.purchase_seq + 1;
  const call = buyCall(s.asset, s.contract, amount.toString(), {
    plan_id: s.plan_id,
    units,
    purchase_seq,
    install,
    reg_id: e.reg_id,
  });
  const terms = {
    account: s.customer,
    network: s.network,
    contract: s.contract,
    asset: s.asset,
    reg_id: e.reg_id,
    purchase_seq,
    units,
    amount: amount.toString(),
    call,
  };
  return { ...terms, terms_digest: termsDigest(terms) };
}

function readFailed(e: unknown): never {
  if (e instanceof V3ReadError)
    throw new HttpError(503, "NEAR couldn't be read just now; try again", "read_failed");
  throw e;
}
