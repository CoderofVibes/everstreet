// Job 003web (docs/design/APPLICATION_COMPOSITION.md §10): a FRESH customer's purchase path. The
// server reads and verifies only: it never signs or sends. Every request it prepares is signed in
// the customer's own wallet. Its durable intents keep the original purchase (sequence, terms, exact
// request) through a lost answer, a reload, another tab and a restart, and resolve it only from
// THIS purchase's own final transaction; a readback alone never confirms one (§10.4).

import { createHash, randomUUID } from "node:crypto";
import {
  type CustomerViewTransport,
  type EntitlementV3,
  type PlanV3,
  readCustomerViews,
} from "./customerRead.ts";
import type { Db } from "./db.ts";
import { HttpError, type Person } from "./store.ts";
import { V3ReadError } from "./v3read.ts";

/** Measured by the contract (customer-purchase.json): a shell is exactly 811 + len(customer) bytes. */
export const SHELL_BASE_BYTES = 811n;
export const SHELL_BASIS =
  "business-v3 sponsor_shell, measured by the contract's own test (customer-purchase.json): 811 bytes plus the customer account's length, whatever the payer";

const U128_MAX = (1n << 128n) - 1n;
const U32_MAX = 0xffff_ffff;
const DEC = /^(0|[1-9][0-9]{0,38})$/;
const SYMBOL = /^[A-Za-z0-9$._-]{1,16}$/;
const TX_HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const KEY = /^[A-Za-z0-9_-]{8,80}$/;
const HEX32 = /^[0-9a-f]{64}$/;
const GAS_30 = "30000000000000";
const GAS_100 = "100000000000000";

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

export function shellQuote(customer: string, byteCost: string) {
  const bytes = SHELL_BASE_BYTES + BigInt(Buffer.byteLength(customer, "utf8"));
  const deposit = bytes * BigInt(byteCost);
  return {
    exact: true as const,
    bytes: bytes.toString(),
    byte_cost: byteCost,
    deposit: deposit.toString(),
    basis: SHELL_BASIS,
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

export const buyCall = (
  asset: string,
  contract: string,
  amount: string,
  buy: { plan_id: number; units: number; purchase_seq: number; install: Install | null },
): WalletCall => ({
  receiverId: asset,
  methodName: "ft_transfer_call",
  args: { receiver_id: contract, amount, msg: JSON.stringify({ buy }) },
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

type State = "prepared" | "requested" | "unknown" | "confirmed" | "returned" | "abandoned";
interface PurchaseRow {
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
  evidence: string | null;
  created_at: string;
  updated_at: string;
}
const OPEN: State[] = ["prepared", "requested", "unknown"];

export function migratePurchases(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_purchases (
      id TEXT PRIMARY KEY, person_id TEXT NOT NULL, customer_account TEXT NOT NULL,
      offer_id TEXT NOT NULL, business_id TEXT NOT NULL, network TEXT NOT NULL,
      contract TEXT NOT NULL, asset TEXT NOT NULL, plan_id INTEGER NOT NULL, reg_id TEXT NOT NULL,
      purchase_seq INTEGER NOT NULL, units INTEGER NOT NULL, amount TEXT NOT NULL, install TEXT,
      call TEXT NOT NULL, terms_digest TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('prepared','requested','unknown','confirmed','returned','abandoned')),
      tx_hash TEXT, evidence TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE (person_id, idempotency_key)
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS customer_purchases_one_open
      ON customer_purchases (customer_account, contract, plan_id)
      WHERE state IN ('prepared', 'requested', 'unknown');
  `);
}

export type Resolution =
  | { kind: "confirmed"; units: number; amount: string }
  | { kind: "returned"; amount: string; reason: string }
  | { kind: "unknown"; message: string; purchase_seq_now: number | null; free_now: string | null };

/**
 * One final transaction, checked to be EXACTLY this intent's request; then the business
 * receipt's own events say what happened. Anything else is unknown.
 */
export function resolveFromTx(p: PurchaseRow, r: unknown): Resolution | null {
  const o = r as {
    transaction?: {
      hash?: unknown;
      signer_id?: unknown;
      receiver_id?: unknown;
      actions?: unknown[];
    };
    receipts_outcome?: { outcome?: { executor_id?: unknown; logs?: unknown[] } }[];
  } | null;
  const t = o?.transaction;
  if (!t || t.hash !== p.tx_hash || t.signer_id !== p.customer_account || t.receiver_id !== p.asset)
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
  const want = (JSON.parse(p.call) as WalletCall).args;
  if (JSON.stringify(args) !== JSON.stringify(want)) return null;
  for (const ro of o?.receipts_outcome ?? []) {
    if (ro.outcome?.executor_id !== p.contract) continue;
    for (const log of ro.outcome.logs ?? []) {
      if (typeof log !== "string" || !log.startsWith("EVENT_JSON:")) continue;
      let e: { standard?: string; event?: string; data?: Record<string, unknown>[] };
      try {
        e = JSON.parse(log.slice(11));
      } catch {
        continue;
      }
      const d = e.data?.[0];
      if (e.standard !== "business_core" || !d || d.customer !== p.customer_account) continue;
      if (
        e.event === "units_bought" &&
        d.plan_id === p.plan_id &&
        d.units === p.units &&
        d.amount === p.amount
      )
        return { kind: "confirmed", units: p.units, amount: p.amount };
      if (e.event === "purchase_returned" && d.amount === p.amount)
        return { kind: "returned", amount: p.amount, reason: String(d.reason ?? "returned") };
    }
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
  private own(viewer: Person, id: string) {
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

  /** The whole prerequisite picture at ONE final block (§10.2), and an exact preview. */
  async setup(
    viewer: Person,
    offerId: string,
    want: { units?: number; install?: Install | null } = {},
  ) {
    if (!this.reader) bad(503, "Buying isn't connected on this server", "purchase_unavailable");
    const reader = this.reader as CustomerViewTransport;
    const o = this.offer(offerId);
    const customer = this.accountOf(viewer.id);
    if (!customer) bad(409, "You have no NEAR account linked here", "no_chain_account");
    const account = customer as string;
    const read = await readCustomerViews(
      reader,
      o,
      { plan: o.plan_id, entitlement: { customer: account, plan_id: o.plan_id } },
      this.timeout,
    ).catch(readFailed);
    const plan = read.plan as PlanV3 | null;
    if (!plan || JSON.stringify(plan) !== o.plan)
      bad(409, "The contract's plan differs from the offer", "plan_changed");
    const block = read.block;
    const token = async (method: string, args: Record<string, unknown>) => {
      const a = await reader
        .view({ network: o.network, account: o.asset, method, args, block })
        .catch(() => bad(503, "The token couldn't be read; try again", "token_unavailable"));
      if (a.block.height !== block.height || a.block.hash !== block.hash)
        bad(503, "The token answered from another block; try again", "mixed_blocks");
      if (typeof a.result !== "string" || a.result.length > 4096)
        bad(503, "The token's answer isn't usable", "token_malformed");
      try {
        return JSON.parse(a.result) as unknown;
      } catch {
        return bad(503, "The token's answer isn't usable", "token_malformed");
      }
    };
    const [metaRaw, balanceRaw, mineRaw, bizRaw, boundsRaw, byteCost] = await Promise.all([
      token("ft_metadata", {}),
      token("ft_balance_of", { account_id: account }),
      token("storage_balance_of", { account_id: account }),
      token("storage_balance_of", { account_id: o.account }),
      token("storage_balance_bounds", {}),
      reader.storageByteCost
        ? reader.storageByteCost(o.network).catch(() => null)
        : Promise.resolve(null),
    ]);
    const meta = validMetadata(metaRaw);
    const balance = u128(balanceRaw);
    const mine = storageBalance(mineRaw);
    const biz = storageBalance(bizRaw);
    const bounds = boundsRaw as { min?: unknown; max?: unknown } | null;
    const minDeposit = u128(bounds?.min);
    if (!meta || balance === null || mine === "bad" || biz === "bad" || !minDeposit)
      bad(503, "The token's answers aren't valid", "token_malformed");
    const e = read.entitlement as EntitlementV3 | null;
    const held = e?.hold_active ? e.hold_units - e.hold_charged : 0;
    const quote = byteCost && u128(byteCost) ? shellQuote(account, byteCost) : null;
    const steps: string[] = [];
    if (!e) steps.push("shell");
    if (mine === null) steps.push("token_storage");
    if (biz === null) steps.push("business_token_storage");
    const out = {
      block,
      network: o.network,
      contract: o.account,
      asset: o.asset,
      plan_id: o.plan_id,
      customer: account,
      offer_state: o.state,
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
      open: (() => {
        const p = this.open(account, o.account, o.plan_id);
        return p ? view(p) : null;
      })(),
      preview: null as null | ReturnType<typeof preview>,
    };
    if (want.units !== undefined) out.preview = preview(out, plan as PlanV3, e, held, want);
    return out;
  }

  /** Stores the reviewed purchase, only if a FRESH read reproduces exactly what was reviewed. */
  async create(viewer: Person, offerId: string, input: Record<string, unknown>) {
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
    const now = new Date((this.opts.now ?? Date.now)()).toISOString();
    const id = randomUUID();
    const o = this.offer(offerId);
    try {
      this.db
        .prepare(
          `INSERT INTO customer_purchases (id, person_id, customer_account, offer_id, business_id, network, contract, asset, plan_id, reg_id, purchase_seq, units, amount, install, call, terms_digest, idempotency_key, state, tx_hash, evidence, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', NULL, NULL, ?, ?)`,
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

  /** The wallet was asked (and perhaps gave a transaction hash). */
  requested(viewer: Person, id: string, input: Record<string, unknown>) {
    const p = this.own(viewer, id);
    if (!OPEN.includes(p.state)) return { purchase: view(p) };
    const hash =
      typeof input.tx_hash === "string" && TX_HASH.test(input.tx_hash) ? input.tx_hash : null;
    this.db
      .prepare(
        "UPDATE customer_purchases SET state = CASE WHEN state = 'prepared' THEN 'requested' ELSE state END, tx_hash = COALESCE(tx_hash, ?), updated_at = ? WHERE id = ?",
      )
      .run(hash, new Date().toISOString(), id);
    return { purchase: view(this.own(viewer, id)) };
  }

  /** Bounded, explicit resolution (§10.4). */
  async check(viewer: Person, id: string, input: Record<string, unknown> = {}) {
    let p = this.own(viewer, id);
    if (!OPEN.includes(p.state)) return { purchase: view(p), resolution: null };
    if (!this.reader) bad(503, "Buying isn't connected on this server", "purchase_unavailable");
    const hash =
      typeof input.tx_hash === "string" && TX_HASH.test(input.tx_hash) ? input.tx_hash : null;
    if (hash && !p.tx_hash) {
      this.db
        .prepare("UPDATE customer_purchases SET tx_hash = ? WHERE id = ? AND tx_hash IS NULL")
        .run(hash, id);
      p = this.own(viewer, id);
    }
    const reader = this.reader as CustomerViewTransport;
    if (p.tx_hash && reader.txOutcome) {
      const r = await reader.txOutcome(p.tx_hash, p.customer_account).catch(() => null);
      const res = r ? resolveFromTx(p, r) : null;
      if (res) {
        this.db
          .prepare(
            "UPDATE customer_purchases SET state = ?, evidence = ?, updated_at = ? WHERE id = ? AND state IN ('prepared','requested','unknown')",
          )
          .run(res.kind, JSON.stringify(res), new Date().toISOString(), id);
        return { purchase: view(this.own(viewer, id)), resolution: res };
      }
    }
    // No proof from this purchase's own transaction: the readback informs, never confirms.
    const read = await readCustomerViews(
      reader,
      { network: p.network, account: p.contract },
      { entitlement: { customer: p.customer_account, plan_id: p.plan_id } },
      this.timeout,
    ).catch(readFailed);
    const e = read.entitlement as EntitlementV3 | null;
    const seqNow = e ? e.purchase_seq : null;
    const res: Resolution = {
      kind: "unknown",
      purchase_seq_now: seqNow,
      free_now: e ? e.free : null,
      message:
        seqNow !== null && seqNow >= p.purchase_seq
          ? "A purchase with this request's sequence is recorded, but it can't be shown to be this one (no transaction from your wallet was available to check). The units shown are what the contract holds for you."
          : "This purchase isn't recorded. If you approved it, it may still be processing, or the token returned it. You can check again, or set it aside to start a new one.",
    };
    this.db
      .prepare(
        "UPDATE customer_purchases SET state = 'unknown', evidence = ?, updated_at = ? WHERE id = ? AND state IN ('prepared','requested','unknown')",
      )
      .run(JSON.stringify(res), new Date().toISOString(), id);
    return { purchase: view(this.own(viewer, id)), resolution: res };
  }

  /**
   * The customer sets an unconfirmed purchase aside: only while its sequence is still unused on
   * the contract. Safe: a new purchase takes that SAME next sequence, so at most one is accepted.
   */
  async abandon(viewer: Person, id: string) {
    const p = this.own(viewer, id);
    if (!OPEN.includes(p.state))
      bad(409, "That purchase already has its outcome", "purchase_settled");
    if (!this.reader) bad(503, "Buying isn't connected on this server", "purchase_unavailable");
    const read = await readCustomerViews(
      this.reader as CustomerViewTransport,
      { network: p.network, account: p.contract },
      { entitlement: { customer: p.customer_account, plan_id: p.plan_id } },
      this.timeout,
    ).catch(readFailed);
    const e = read.entitlement as EntitlementV3 | null;
    if (e && e.purchase_seq >= p.purchase_seq)
      bad(
        409,
        "A purchase with this sequence is recorded, so it can't be set aside",
        "sequence_used",
      );
    this.db
      .prepare(
        "UPDATE customer_purchases SET state = 'abandoned', updated_at = ? WHERE id = ? AND state IN ('prepared','requested','unknown')",
      )
      .run(new Date().toISOString(), id);
    return { purchase: view(this.own(viewer, id)) };
  }

  list(viewer: Person, offerId?: string) {
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
