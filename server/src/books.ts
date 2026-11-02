// A business's books by month (job 003f). Every figure says what it is, where it came from and
// whether it was actually observed:
//
// - Earned revenue (accrual-like) for a business taking payments is read from its contract's
//   own monthly ledger on NEAR testnet. `earned` already includes customer credit that was used,
//   so credit used is never added again. Prepayments are cash in, not revenue; unearned refunds
//   and credit withdrawals reduce what is owed to customers, never earned revenue.
// - Cash flows (orders and prepayments in, money returned, owner withdrawals, sale proceeds) are
//   shown apart from revenue. Owner withdrawals are not an operating cost; sale proceeds are the
//   seller's money from a sale, not business income.
// - A month whose ledger couldn't be read is "unavailable", never zero; with no chain connected
//   it is "not connected"; before the account existed it is "not applicable". An observed zero
//   is an observed zero.
// - Fictional seeded history is its own series. Where the contract has records for a month,
//   seeded figures are never added to them.
// - Testnet receipts are test dollars; founder-entered costs are US dollars. Contribution is a
//   demo figure counting a test dollar as $1, never real profit.
// - Amounts are exact base units (BigInt) until converted, once, for display.

import { randomUUID } from "node:crypto";
import type { Chain, Period } from "./chain.ts";
import type { Db } from "./db.ts";
import { HttpError, type Person, type Store } from "./store.ts";

export type Source =
  | "Verified on NEAR · testnet"
  | "Founder supplied"
  | "Seeded history · fictional"
  | "Computed"
  | "Estimate";

/** Whether the contract's ledger for a month was read. */
export type ChainState = "observed" | "unavailable" | "not_connected" | "not_applicable";
/** How much of the month the records cover. */
export type Coverage = "complete" | "current_partial" | "first_partial" | "before_start";

export interface CashFlows {
  /** Orders paid plus prepayments: money in, not revenue. */
  cash_in_cents: number;
  orders_in_cents: number;
  prepaid_in_cents: number;
  /** Returned before delivery: refunds plus credit withdrawn. Reduces obligations, not revenue. */
  returned_cents: number;
  refunds_cents: number;
  credit_withdrawn_cents: number;
  /** Prepaid credit used this month (already inside earned; shown for information). */
  credit_used_cents: number;
  owner_withdrawals_cents: number;
  /** The seller's proceeds from a sale closing this month: an ownership event, not income. */
  sale_proceeds_cents: number;
}

export interface Month {
  yyyymm: number;
  label: string;
  coverage: Coverage;
  /** A whole month of records, usable for comparisons and the estimate. */
  complete: boolean;
  chain: ChainState;
  chain_reason: string | null;
  /** Revenue for the month, or null when it isn't known (unreadable or not connected). */
  revenue_cents: number | null;
  /** Where `revenue_cents` comes from. */
  revenue_basis: "observed" | "seeded" | "none" | "unknown";
  /** Exact earned amount in the token's base units, when observed. */
  earned_units: string | null;
  /** Fictional seeded revenue for the month, always kept apart. */
  seeded_cents: number | null;
  /** True when seeded figures exist for a month the contract also has records for. */
  mixed: boolean;
  direct_cents: number;
  overhead_cents: number;
  /** Revenue − costs (demo contribution), or null when revenue isn't known. */
  profit_cents: number | null;
  revenue_sources: Source[];
  cost_sources: Source[];
  /** Observed cash flows; null when the ledger wasn't read. */
  cash: CashFlows | null;
  /** Legacy names kept for older consumers; null when not observed. */
  refunds_cents: number | null;
  paid_in_cents: number | null;
  lines: {
    kind: "revenue" | "direct" | "overhead";
    label: string;
    cents: number;
    source: Source;
    category?: string;
  }[];
}

export interface CostRow {
  id: string;
  business_id: string;
  yyyymm: number;
  until_yyyymm: number | null;
  category: string;
  kind: "direct" | "overhead";
  amount_cents: number;
  recurring: number;
  note: string;
  origin: "founder" | "seeded";
  created_at: string;
  voided_at: string | null;
  void_note: string;
}

export const ym = (d = new Date()) => d.getUTCFullYear() * 100 + d.getUTCMonth() + 1;
export const addMonths = (yyyymm: number, n: number) => {
  const total = Math.floor(yyyymm / 100) * 12 + ((yyyymm % 100) - 1) + n;
  return Math.floor(total / 12) * 100 + (total % 12) + 1;
};
export const monthLabel = (yyyymm: number) =>
  new Date(Date.UTC(Math.floor(yyyymm / 100), (yyyymm % 100) - 1, 1)).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

/** A real calendar month in YYYYMM form from January 2000 on. */
export const validMonth = (m: number) =>
  Number.isInteger(m) && m >= 200001 && m % 100 >= 1 && m % 100 <= 12;

/** The largest single cost line accepted: $1,000,000. */
export const MAX_COST_CENTS = 100_000_000;

/**
 * Cost categories. Digital businesses first: model usage, hosting, online services. Earlier
 * categories stay valid so existing records keep their labels.
 */
export const COST_CATEGORIES: { category: string; kind: "direct" | "overhead"; hint: string }[] = [
  {
    category: "AI model usage",
    kind: "direct",
    hint: "Model API calls your product makes for customers (entered by you; the product runtime's own usage is shown separately)",
  },
  { category: "Hosting and compute", kind: "direct", hint: "Servers, databases and storage" },
  {
    category: "Online services and APIs",
    kind: "direct",
    hint: "Paid APIs, email, payments and other services the product calls",
  },
  { category: "Paid help", kind: "direct", hint: "People you pay to deliver or support" },
  {
    category: "Software and tools",
    kind: "overhead",
    hint: "Subscriptions the business runs on",
  },
  { category: "Marketing", kind: "overhead", hint: "Ads, sponsorships, referral payments" },
  { category: "Fees and admin", kind: "overhead", hint: "Bank, payment and admin costs" },
  { category: "Materials", kind: "direct", hint: "What each order uses up" },
  { category: "Space or venue", kind: "direct", hint: "Rent for where the work happens" },
  { category: "Other", kind: "overhead", hint: "Anything else the business pays for" },
];

/**
 * Converts token base units to cents exactly: floor(units × 100 / 10^decimals), with whether
 * anything was below a cent. Null when the result can't be represented exactly as a safe
 * integer (never silently rounded into a different amount). Works for any decimals ≥ 0.
 */
export function unitsToCents(
  units: bigint,
  decimals: number,
): { cents: number; subCent: boolean } | null {
  if (!Number.isInteger(decimals) || decimals < 0) return null;
  const scaled = units * 100n;
  const div = 10n ** BigInt(decimals);
  const cents = scaled / div;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < -BigInt(Number.MAX_SAFE_INTEGER))
    return null;
  return { cents: Number(cents), subCent: scaled % div !== 0n };
}

/** Sums exact base-unit amounts and converts once (no per-month rounding). */
export function sumUnits(list: (string | null)[], decimals: number) {
  const total = list.reduce((a, u) => a + BigInt(u ?? "0"), 0n);
  return unitsToCents(total, decimals);
}

/** The revenue the estimate may use for these months: exact chain units plus seeded cents. */
export function revenueOf(months: Month[], decimals: number): number | null {
  if (months.some((m) => m.revenue_cents === null)) return null;
  const chain = sumUnits(
    months.filter((m) => m.revenue_basis === "observed").map((m) => m.earned_units),
    decimals,
  );
  if (!chain) return null;
  const other = months
    .filter((m) => m.revenue_basis !== "observed")
    .reduce((a, m) => a + (m.revenue_cents ?? 0), 0);
  return chain.cents + other;
}

const CASH_KEYS: (keyof Period)[] = [
  "orders_in",
  "prepaid_in",
  "earned",
  "refunds",
  "credit_used",
  "credit_withdrawn",
  "owner_withdrawals",
  "sale_proceeds",
];

export class Books {
  constructor(
    private readonly db: Db,
    private readonly store: Store,
    private readonly chain: Chain | null,
  ) {}

  /** Token decimals for exact conversion (2 when no chain is connected). */
  get decimals() {
    return this.chain?.decimals ?? 2;
  }

  private chainAccount(businessId: string) {
    return this.db
      .prepare(
        "SELECT account_id, created_at FROM chain_accounts WHERE owner_kind = 'business' AND owner_id = ?",
      )
      .get(businessId) as { account_id: string; created_at: string } | undefined;
  }

  addCost(
    founder: Person,
    businessId: string,
    input: {
      category?: string;
      amount_cents?: number;
      recurring?: boolean;
      yyyymm?: number;
      note?: string;
    },
  ) {
    this.store.business(founder, businessId);
    const cat = COST_CATEGORIES.find((c) => c.category === input.category);
    if (!cat) throw new HttpError(400, "Pick a kind of cost");
    const amount = Number(input.amount_cents);
    if (!Number.isSafeInteger(amount) || amount <= 0)
      throw new HttpError(400, "How much was it, in whole cents?");
    if (amount > MAX_COST_CENTS)
      throw new HttpError(400, "Enter a single cost of $1,000,000 or less");
    const month = Number(input.yyyymm ?? ym());
    if (!validMonth(month)) throw new HttpError(400, "Pick a real month, like 2026-10");
    if (month > ym())
      throw new HttpError(
        400,
        "Costs are recorded for this month or earlier; future costs aren't operating activity yet",
      );
    this.db
      .prepare(
        "INSERT INTO costs (id, business_id, yyyymm, category, kind, amount_cents, recurring, note, origin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'founder', ?)",
      )
      .run(
        randomUUID(),
        businessId,
        month,
        cat.category,
        cat.kind,
        amount,
        input.recurring ? 1 : 0,
        String(input.note ?? "").slice(0, 200),
        new Date().toISOString(),
      );
    return this.costs(founder, businessId);
  }

  /**
   * Ends a cost without rewriting closed months. A monthly cost stops after last month. A cost
   * that only touches the current (open) month is removed. A one-off cost in a closed month is
   * kept and marked as a correction (with when and why), so earlier figures stay traceable.
   */
  endCost(founder: Person, businessId: string, costId: string, note = "") {
    this.store.business(founder, businessId);
    const c = this.db
      .prepare(
        "SELECT * FROM costs WHERE id = ? AND business_id = ? AND origin = 'founder' AND voided_at IS NULL",
      )
      .get(costId, businessId) as unknown as CostRow | undefined;
    if (!c) throw new HttpError(404, "No such cost");
    const now = ym();
    if (c.yyyymm >= now) this.db.prepare("DELETE FROM costs WHERE id = ?").run(costId);
    else if (c.recurring)
      this.db
        .prepare("UPDATE costs SET until_yyyymm = ? WHERE id = ?")
        .run(addMonths(now, -1), costId);
    else
      this.db
        .prepare("UPDATE costs SET voided_at = ?, void_note = ? WHERE id = ?")
        .run(
          new Date().toISOString(),
          String(note || "Corrected by the owner").slice(0, 200),
          costId,
        );
    return this.costs(founder, businessId);
  }

  costs(founder: Person, businessId: string) {
    this.store.business(founder, businessId);
    return {
      categories: COST_CATEGORIES,
      costs: this.db
        .prepare("SELECT * FROM costs WHERE business_id = ? ORDER BY yyyymm DESC, created_at DESC")
        .all(businessId) as unknown as CostRow[],
    };
  }

  private costsFor(businessId: string, month: number) {
    return (
      this.db
        .prepare("SELECT * FROM costs WHERE business_id = ? AND voided_at IS NULL")
        .all(businessId) as unknown as CostRow[]
    ).filter((c) =>
      c.recurring
        ? c.yyyymm <= month && (c.until_yyyymm === null || month <= c.until_yyyymm)
        : c.yyyymm === month,
    );
  }

  /**
   * The last `n` months, oldest first, ending with the current (partial) month. Chain months
   * are read live; a month that can't be read is unavailable, and says why.
   */
  async months(
    businessId: string,
    n = 12,
  ): Promise<{ months: Month[]; chain_error: string | null }> {
    const now = ym();
    const list = Array.from({ length: n }, (_, i) => addMonths(now, i - (n - 1)));
    const account = this.chainAccount(businessId);
    const first = account ? ym(new Date(account.created_at)) : null;
    const startsMidMonth = account ? new Date(account.created_at).getUTCDate() > 1 : false;
    const read = new Map<number, { p: Period } | { error: string }>();
    let chainError: string | null = null;
    if (account && this.chain) {
      const chain = this.chain;
      await Promise.all(
        list
          .filter((m) => first !== null && m >= first)
          .map(async (m) => {
            try {
              read.set(m, { p: await chain.period(account.account_id, m) });
            } catch (e) {
              const reason = `NEAR testnet could not be read for ${monthLabel(m)}: ${(e as Error).message}`;
              read.set(m, { error: reason });
              chainError = reason;
            }
          }),
      );
    }
    const seeded = new Map(
      (
        this.db
          .prepare("SELECT yyyymm, revenue_cents, note FROM seeded_periods WHERE business_id = ?")
          .all(businessId) as { yyyymm: number; revenue_cents: number; note: string }[]
      ).map((r) => [r.yyyymm, r]),
    );
    const decimals = this.decimals;
    const months = list.map((m): Month => {
      const coverage: Coverage =
        m === now
          ? "current_partial"
          : first !== null && m < first
            ? "before_start"
            : first !== null && m === first && startsMidMonth
              ? "first_partial"
              : "complete";
      let chainState: ChainState = "not_applicable";
      let chainReason: string | null = null;
      let p: Period | null = null;
      if (account && first !== null && m >= first) {
        const r = read.get(m);
        if (!this.chain) {
          chainState = "not_connected";
          chainReason = "This server isn't connected to NEAR testnet, so the ledger wasn't read";
        } else if (r && "p" in r) {
          chainState = "observed";
          p = r.p;
        } else {
          chainState = "unavailable";
          chainReason = r && "error" in r ? r.error : "Not read";
        }
      }
      // Convert every observed amount exactly; an amount too large to show exactly makes the
      // month unavailable rather than wrong.
      const conv: Partial<Record<keyof Period, number>> = {};
      if (p) {
        for (const k of CASH_KEYS) {
          const c = unitsToCents(BigInt(p[k] ?? "0"), decimals);
          if (!c) {
            chainState = "unavailable";
            chainReason = `The ${k.replace(/_/g, " ")} amount for ${monthLabel(m)} is too large to show exactly`;
            p = null;
            break;
          }
          conv[k] = c.cents;
        }
      }
      const s = seeded.get(m);
      const lines: Month["lines"] = [];
      let revenue: number | null;
      let basis: Month["revenue_basis"];
      if (chainState === "observed" && p) {
        revenue = conv.earned ?? 0;
        basis = "observed";
        if (revenue > 0)
          lines.push({
            kind: "revenue",
            label: "Earned: orders delivered and prepaid credit used",
            cents: revenue,
            source: "Verified on NEAR · testnet",
          });
      } else if (chainState === "unavailable" || chainState === "not_connected") {
        revenue = null;
        basis = "unknown";
      } else if (s) {
        revenue = s.revenue_cents;
        basis = "seeded";
        lines.push({
          kind: "revenue",
          label: s.note,
          cents: s.revenue_cents,
          source: "Seeded history · fictional",
        });
      } else {
        revenue = 0;
        basis = "none";
      }
      for (const cost of this.costsFor(businessId, m))
        lines.push({
          kind: cost.kind,
          label: cost.note ? `${cost.category}: ${cost.note}` : cost.category,
          cents: cost.amount_cents,
          source: cost.origin === "seeded" ? "Seeded history · fictional" : "Founder supplied",
          category: cost.category,
        });
      const sum = (k: string) => lines.filter((l) => l.kind === k).reduce((a, l) => a + l.cents, 0);
      const direct = sum("direct");
      const overhead = sum("overhead");
      const uniq = (k: string[]) => [
        ...new Set(lines.filter((l) => k.includes(l.kind)).map((l) => l.source)),
      ];
      const cash: CashFlows | null =
        chainState === "observed" && p
          ? {
              orders_in_cents: conv.orders_in ?? 0,
              prepaid_in_cents: conv.prepaid_in ?? 0,
              cash_in_cents: (conv.orders_in ?? 0) + (conv.prepaid_in ?? 0),
              refunds_cents: conv.refunds ?? 0,
              credit_withdrawn_cents: conv.credit_withdrawn ?? 0,
              returned_cents: (conv.refunds ?? 0) + (conv.credit_withdrawn ?? 0),
              credit_used_cents: conv.credit_used ?? 0,
              owner_withdrawals_cents: conv.owner_withdrawals ?? 0,
              sale_proceeds_cents: conv.sale_proceeds ?? 0,
            }
          : null;
      return {
        yyyymm: m,
        label: monthLabel(m),
        coverage,
        complete: coverage === "complete" || (coverage === "before_start" && m < now),
        chain: chainState,
        chain_reason: chainReason,
        revenue_cents: revenue,
        revenue_basis: basis,
        earned_units: chainState === "observed" && p ? String(p.earned ?? "0") : null,
        seeded_cents: s ? s.revenue_cents : null,
        mixed: Boolean(s) && basis !== "seeded",
        direct_cents: direct,
        overhead_cents: overhead,
        profit_cents: revenue === null ? null : revenue - direct - overhead,
        revenue_sources: uniq(["revenue"]),
        cost_sources: uniq(["direct", "overhead"]),
        cash,
        refunds_cents: cash ? cash.refunds_cents : null,
        paid_in_cents: cash ? cash.cash_in_cents : null,
        lines,
      };
    });
    return { months, chain_error: chainError };
  }

  /** Today's balances on the business's contract: a current stock, never a monthly flow. */
  async now(businessId: string) {
    const account = this.chainAccount(businessId);
    if (!account) return { state: "not_applicable" as const, reason: "Payments are off" };
    if (!this.chain)
      return {
        state: "not_connected" as const,
        reason: "This server isn't connected to NEAR testnet",
      };
    try {
      const t = await this.chain.treasury(account.account_id);
      const c = (u: string) => unitsToCents(BigInt(u), this.decimals)?.cents ?? null;
      return {
        state: "observed" as const,
        read_at: new Date().toISOString(),
        customer_money_cents: c(t.unearned_orders),
        customer_credit_cents: c(t.customer_credit),
        available_cents: c(t.available),
        withdrawable_cents: c(t.withdrawable),
        pending_payouts_cents: c(t.pending_payouts),
        buyer_escrow_cents: c(t.deal_holds),
        seller_proceeds_cents: c(t.seller_proceeds),
        source: "Verified on NEAR · testnet (read now)" as const,
      };
    } catch (e) {
      return {
        state: "unavailable" as const,
        reason: `NEAR testnet could not be read: ${(e as Error).message}`,
      };
    }
  }

  /**
   * Model spend from the platform's own ledgers, in US dollars computed from reported tokens at
   * declared prices (not an invoice), exact to a millionth of a cent. Product runtime and
   * building are separate ledgers; neither is a founder-entered operating cost.
   */
  spend(businessId: string, n = 12) {
    const now = ym();
    const from = addMonths(now, -(n - 1));
    const by = (table: "runtime_invocations" | "build_jobs") =>
      this.db
        .prepare(
          `SELECT CAST(substr(created_at, 1, 4) || substr(created_at, 6, 2) AS INTEGER) AS yyyymm,
             COALESCE(SUM(charged_microcents), 0) AS micro, COUNT(*) AS requests,
             COALESCE(SUM(CASE WHEN ${table === "build_jobs" ? "dispatched_at IS NOT NULL AND usage_final = 0 AND state IN ('succeeded','failed','cancelled','needs_reconciliation')" : "state <> 'running' AND usage_state IN ('partial','unknown')"} THEN 1 ELSE 0 END), 0) AS unknown,
             COALESCE(SUM(${table === "build_jobs" ? "CASE WHEN dispatched_at IS NOT NULL AND usage_final = 0 THEN reserved_cents ELSE 0 END" : "CASE WHEN usage_state IN ('partial','unknown') THEN reserved_cents ELSE 0 END"}), 0) AS held_cents
           FROM ${table} WHERE business_id = ? GROUP BY yyyymm`,
        )
        .all(businessId) as {
        yyyymm: number;
        micro: number;
        requests: number;
        unknown: number;
        held_cents: number;
      }[];
    const shape = (rows: ReturnType<typeof by>) => ({
      months: rows
        .filter((r) => r.yyyymm >= from && r.yyyymm <= now)
        .sort((a, b) => a.yyyymm - b.yyyymm)
        .map((r) => ({
          yyyymm: r.yyyymm,
          used_microcents: r.micro,
          requests: r.requests,
          unknown_cost_requests: r.unknown,
          held_cents: r.held_cents,
        })),
      total_microcents: rows.reduce((a, r) => a + r.micro, 0),
      unknown_cost_requests: rows.reduce((a, r) => a + r.unknown, 0),
    });
    return {
      unit: "USD" as const,
      basis:
        "Computed from the provider's reported tokens at the declared prices, to a millionth of a cent. Not an invoice. Requests whose usage wasn't reported keep their reservation and are counted as unknown, not zero.",
      runtime: {
        ...shape(by("runtime_invocations")),
        note: "Running the product (owner trials, checks and released requests). Shown apart from operating costs until customers are connected.",
      },
      build: {
        ...shape(by("build_jobs")),
        note: "Building the product with AI: one-time build spend, not an operating cost.",
      },
    };
  }
}

/**
 * One month's financial figures with their states and provenance, without cost lines (those
 * belong to the "costs" evidence grant). Shared by every serializer outside the owner's books,
 * so a buyer sees exactly the owner's metrics, never a second calculation.
 */
export function financialMonth(m: Month) {
  const { lines: _lines, earned_units: _units, ...rest } = m;
  return rest;
}

/** Plain words for the unit mix, shown wherever revenue and costs meet. */
export const BOOKS_BASIS =
  "Revenue read from NEAR testnet is in test dollars; costs you enter are in US dollars. Contribution subtracts one from the other only as a demo, counting a test dollar as $1. It is not real profit.";
