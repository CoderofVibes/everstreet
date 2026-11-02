// A business's books by month: earned revenue, direct costs, overhead and operating profit,
// with where every number came from. Earned revenue for a business taking payments is read from
// its contract's own monthly ledger on NEAR testnet (money customers paid becomes revenue only
// when delivered). Costs are what the founder entered. Fictional example history is kept apart
// and labeled as seeded. Testnet receipts are test money, never commercial revenue.

import { randomUUID } from "node:crypto";
import type { Chain } from "./chain.ts";
import type { Db } from "./db.ts";
import { HttpError, type Person, type Store } from "./store.ts";

export type Source =
  | "Verified on NEAR · testnet"
  | "Founder supplied"
  | "Seeded history · fictional"
  | "Computed"
  | "Estimate";

export interface Month {
  yyyymm: number;
  label: string;
  complete: boolean;
  revenue_cents: number;
  direct_cents: number;
  overhead_cents: number;
  profit_cents: number;
  revenue_sources: Source[];
  cost_sources: Source[];
  refunds_cents: number;
  paid_in_cents: number;
  lines: {
    kind: "revenue" | "direct" | "overhead";
    label: string;
    cents: number;
    source: Source;
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

export const COST_CATEGORIES: { category: string; kind: "direct" | "overhead"; hint: string }[] = [
  { category: "Materials", kind: "direct", hint: "What each order uses up: ink, paper, parts" },
  { category: "Space or venue", kind: "direct", hint: "Rent for the room the work happens in" },
  { category: "Hosting and compute", kind: "direct", hint: "Servers that deliver the service" },
  { category: "Paid help", kind: "direct", hint: "People you pay to deliver or support" },
  { category: "Software and tools", kind: "overhead", hint: "Subscriptions the business runs on" },
  { category: "Marketing", kind: "overhead", hint: "Ads, printing, referral payments" },
  { category: "Fees and admin", kind: "overhead", hint: "Bank, payment and admin costs" },
  { category: "Other", kind: "overhead", hint: "Anything else the business pays for" },
];

export class Books {
  constructor(
    private readonly db: Db,
    private readonly store: Store,
    private readonly chain: Chain | null,
  ) {}

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
    const amount = Math.round(Number(input.amount_cents));
    if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, "How much was it?");
    const month = Number(input.yyyymm ?? ym());
    if (!Number.isInteger(month) || month < 200001 || month > ym())
      throw new HttpError(400, "Pick this month or an earlier one");
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

  /** Stops a monthly cost from this month on, or removes a one-off. History stays for months already closed. */
  endCost(founder: Person, businessId: string, costId: string) {
    this.store.business(founder, businessId);
    const c = this.db
      .prepare("SELECT * FROM costs WHERE id = ? AND business_id = ? AND origin = 'founder'")
      .get(costId, businessId) as unknown as CostRow | undefined;
    if (!c) throw new HttpError(404, "No such cost");
    if (c.recurring && c.yyyymm < ym())
      this.db
        .prepare("UPDATE costs SET until_yyyymm = ? WHERE id = ?")
        .run(addMonths(ym(), -1), costId);
    else this.db.prepare("DELETE FROM costs WHERE id = ?").run(costId);
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
        .prepare("SELECT * FROM costs WHERE business_id = ?")
        .all(businessId) as unknown as CostRow[]
    ).filter((c) =>
      c.recurring
        ? c.yyyymm <= month && (c.until_yyyymm === null || month <= c.until_yyyymm)
        : c.yyyymm === month,
    );
  }

  /**
   * The last `n` months, oldest first, ending with the current (incomplete) month. Chain
   * months are read live; if NEAR cannot be reached the month says so through its sources.
   */
  async months(
    businessId: string,
    n = 12,
  ): Promise<{ months: Month[]; chain_error: string | null }> {
    const now = ym();
    const list = Array.from({ length: n }, (_, i) => addMonths(now, i - (n - 1)));
    const account = this.chainAccount(businessId);
    const fromChain = new Map<number, { earned: number; refunds: number; paid_in: number }>();
    let chainError: string | null = null;
    if (account && this.chain) {
      const first = ym(new Date(account.created_at));
      const chain = this.chain;
      const per = 10n ** BigInt(chain.decimals - 2);
      await Promise.all(
        list
          .filter((m) => m >= first)
          .map(async (m) => {
            try {
              const p = await chain.period(account.account_id, m);
              fromChain.set(m, {
                earned: Number(BigInt(p.earned) / per),
                refunds: Number(BigInt(p.refunds) / per),
                paid_in: Number(BigInt(p.orders_in) / per),
              });
            } catch (e) {
              chainError = `NEAR testnet could not be read: ${(e as Error).message}`;
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
    const months = list.map((m): Month => {
      const lines: Month["lines"] = [];
      const c = fromChain.get(m);
      if (c && c.earned > 0)
        lines.push({
          kind: "revenue",
          label: "Earned from delivered orders",
          cents: c.earned,
          source: "Verified on NEAR · testnet",
        });
      const s = seeded.get(m);
      if (s)
        lines.push({
          kind: "revenue",
          label: s.note,
          cents: s.revenue_cents,
          source: "Seeded history · fictional",
        });
      for (const cost of this.costsFor(businessId, m)) {
        lines.push({
          kind: cost.kind,
          label: cost.note ? `${cost.category}: ${cost.note}` : cost.category,
          cents: cost.amount_cents,
          source: cost.origin === "seeded" ? "Seeded history · fictional" : "Founder supplied",
        });
      }
      const sum = (k: string) => lines.filter((l) => l.kind === k).reduce((a, l) => a + l.cents, 0);
      const revenue = sum("revenue");
      const direct = sum("direct");
      const overhead = sum("overhead");
      const uniq = (k: string[]) => [
        ...new Set(lines.filter((l) => k.includes(l.kind)).map((l) => l.source)),
      ];
      return {
        yyyymm: m,
        label: monthLabel(m),
        complete: m < now,
        revenue_cents: revenue,
        direct_cents: direct,
        overhead_cents: overhead,
        profit_cents: revenue - direct - overhead,
        revenue_sources: uniq(["revenue"]),
        cost_sources: uniq(["direct", "overhead"]),
        refunds_cents: c?.refunds ?? 0,
        paid_in_cents: c?.paid_in ?? 0,
        lines,
      };
    });
    return { months, chain_error: chainError };
  }
}
