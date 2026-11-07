// Per-use economics a buyer can check (design/sale-proof/use-economics, owner and buyer view):
// what one delivered use earns, what it cost in supplier payments, and the books on separate
// lines (earned revenue, customer funds owed, supplier cost, founder-entered costs). Customer
// input and results are never shown here: those belong to the customer.
//
// Sources, each stated: the plan's price and the customer funds owed are contract reads; earned
// uses are Everstreet's records of charges the contract confirmed; supplier cost is the allowance
// contract's paid payments, matched to uses by the invoice digest the agent pays with
// (sha256("supplier-invoice-" + use id)); founder-entered costs are USD and never added to TUSD.

import { createHash } from "node:crypto";
import type { Companions } from "./companions.ts";
import type { CustomerViewTransport, PinnedBlock } from "./customerRead.ts";
import type { Db } from "./db.ts";
import { tokenMetaOf } from "./tokenMeta.ts";
import { type BlockRef, decodeTreasury, V3ReadError } from "./v3read.ts";

/** The invoice digest the agent pays a supplier with for one delivered use. */
export const supplierInvoiceFor = (useId: string) =>
  createHash("sha256").update(`supplier-invoice-${useId}`).digest("hex");

export class UseEconomics {
  constructor(
    private readonly db: Db,
    private readonly reader: CustomerViewTransport | null,
    private readonly companions: Companions,
    private readonly now: () => number = Date.now,
  ) {}

  async build(businessId: string, binding: { network: string; account: string }) {
    const reader = this.reader;
    if (!reader) throw new V3ReadError("unavailable", "no reader");
    const charged = this.db
      .prepare(
        `SELECT r.id, r.plan_id, s.updated_at FROM customer_settlements s JOIN customer_requests r ON r.id = s.request_id
         WHERE r.business_id = ? AND s.state = 'charged' ORDER BY s.updated_at`,
      )
      .all(businessId) as { id: string; plan_id: number; updated_at: string }[];
    const planId = charged.at(-1)?.plan_id ?? 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let block: PinnedBlock;
    let plan: { unit_price: string } | null;
    let treasury: ReturnType<typeof decodeTreasury>;
    try {
      block = (await reader.finalBlock(binding.network, controller.signal)) as PinnedBlock;
      const v = async (method: string, args: Record<string, unknown>) =>
        JSON.parse(
          (
            await reader.view({
              ...binding,
              method,
              args,
              block: block as BlockRef,
              signal: controller.signal,
            })
          ).result,
        ) as unknown;
      [plan, treasury] = await Promise.all([
        v("get_plan", { plan_id: planId }) as Promise<{ unit_price: string } | null>,
        v("get_treasury", {}).then(decodeTreasury),
      ]);
    } finally {
      clearTimeout(timer);
    }
    const price = plan ? BigInt(plan.unit_price) : null;

    // Supplier payments, from the allowance companion (if this business has one).
    const control = await this.companions.control(binding).catch(() => null);
    const view = control
      ? await this.companions.view(businessId, binding.network, control).catch(() => null)
      : null;
    const payments = (view?.allowance?.recent ?? []) as {
      invoice: string;
      amount: string;
      state: string;
    }[];
    // `recent` is the last 10; the full list is read for matching.
    const all = view?.allowance
      ? await this.allPayments(binding.network, view.allowance.account).catch(() => payments)
      : [];
    const paid = all.filter((p) => p.state === "Paid");
    const byInvoice = new Map(paid.map((p) => [p.invoice, BigInt(p.amount)]));
    const matched = charged
      .map((u) => byInvoice.get(supplierInvoiceFor(u.id)))
      .filter((x): x is bigint => x !== undefined);
    const supplierPerUse =
      matched.length > 0 ? matched.reduce((a, b) => a + b, 0n) / BigInt(matched.length) : null;
    const supplierTotal = view?.allowance ? paid.reduce((a, p) => a + BigInt(p.amount), 0n) : null;

    const month = new Date(this.now());
    const yyyymm = month.getUTCFullYear() * 100 + month.getUTCMonth() + 1;
    const founder = this.db
      .prepare(
        "SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents FROM costs WHERE business_id = ? AND origin = 'founder' AND yyyymm <= ? AND (until_yyyymm IS NULL OR until_yyyymm >= ?)",
      )
      .get(businessId, yyyymm, yyyymm) as { n: number; cents: number };
    const since = this.now() - 30 * 86_400_000;
    const last = charged.at(-1) ?? null;
    const meta = tokenMetaOf(this.db, binding.network, treasury.asset);
    return {
      block: { height: block.height, hash: block.hash },
      token: meta ? { symbol: meta.symbol, decimals: meta.decimals } : null,
      plan_id: planId,
      last_use: last
        ? { id: last.id, settled_at: last.updated_at, charge: price?.toString() ?? null }
        : null,
      per_use: {
        revenue: price?.toString() ?? null,
        supplier_cost: supplierPerUse?.toString() ?? null,
        margin:
          price !== null && supplierPerUse !== null ? (price - supplierPerUse).toString() : null,
        matched_uses: matched.length,
      },
      books: {
        earned_revenue: price !== null ? (price * BigInt(charged.length)).toString() : null,
        earned_uses: charged.length,
        customer_funds_owed: treasury.ent_free_value,
        supplier_cost: supplierTotal?.toString() ?? null,
        founder_costs_usd_cents: founder.n > 0 ? founder.cents : null,
      },
      scenario: {
        uses_last_30_days: charged.filter((u) => Date.parse(u.updated_at) >= since).length,
      },
      sources: {
        revenue: "contract",
        customer_funds_owed: "contract",
        earned_uses: "everstreet",
        supplier_cost: view?.allowance ? "contract" : null,
        founder_costs: "everstreet",
      },
    };
  }

  private async allPayments(network: string, account: string) {
    const reader = this.reader as CustomerViewTransport;
    const block = await reader.finalBlock(network);
    const out: { invoice: string; amount: string; state: string }[] = [];
    for (let from = 0; from < 1000; from += 50) {
      const r = await reader.view({
        network,
        account,
        method: "get_payments",
        args: { from, limit: 50 },
        block,
      });
      const page = JSON.parse(r.result) as { invoice: string; amount: string; state: string }[];
      out.push(...page);
      if (page.length < 50) break;
    }
    return out;
  }
}
