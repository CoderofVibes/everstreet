// Job 003t: customer operating performance (docs/design/CUSTOMER_OPERATIONS.md). One
// authoritative aggregation over this app's own persistent records: customer requests by the
// UTC month they were requested (immutable), with their current recorded outcome; and runtime
// cost by month and purpose, summed exactly (millionths of a cent, carried as decimal strings).
// Counts and sums only: no customer identity, document, result, reference or diagnostic.

import { addMonths, monthLabel, ym } from "./books.ts";
import type { Db } from "./db.ts";

export const MAX_OPERATION_MONTHS = 24;

export interface UsageCounts {
  requested: number;
  charged: number;
  returned: number;
  settling: number;
  needs_attention: number;
  reserved_unsettled: number;
  awaiting_reservation: number;
  never_reserved: number;
}

export interface ExecutionCounts {
  ran: number;
  usable_result: number;
  not_usable: number;
  undecided: number;
  unknown: number;
}

export interface CostGroup {
  /** Exact millionths of a US cent, as a decimal string (never rounded per call). */
  microcents: string;
  calls: number;
  /** Calls whose usage wasn't fully reported: their cost is unknown, never zero. */
  unknown_cost_calls: number;
  /** What those calls still reserve, in cents. */
  unknown_held_cents: number;
}

export interface OperationsMonth {
  yyyymm: number;
  label: string;
  /** The current month, so far. */
  so_far: boolean;
  usage: UsageCounts;
  execution: ExecutionCounts;
  cost: { customers: CostGroup; founder: CostGroup };
}

const ZERO_USAGE = (): UsageCounts => ({
  requested: 0,
  charged: 0,
  returned: 0,
  settling: 0,
  needs_attention: 0,
  reserved_unsettled: 0,
  awaiting_reservation: 0,
  never_reserved: 0,
});
const ZERO_EXEC = (): ExecutionCounts => ({
  ran: 0,
  usable_result: 0,
  not_usable: 0,
  undecided: 0,
  unknown: 0,
});
const ZERO_COST = (): CostGroup => ({
  microcents: "0",
  calls: 0,
  unknown_cost_calls: 0,
  unknown_held_cents: 0,
});

/** Adds two exact decimal strings (non-negative), without passing through a JS number. */
export const addDecimal = (a: string, b: string) => (BigInt(a) + BigInt(b)).toString();

const firstInstant = (yyyymm: number) =>
  `${Math.floor(yyyymm / 100)}-${String(yyyymm % 100).padStart(2, "0")}-01T00:00:00.000Z`;

/** The month of an ISO timestamp, in SQL (the recorded UTC instant). */
const MONTH = (col: string) => `CAST(substr(${col}, 1, 4) || substr(${col}, 6, 2) AS INTEGER)`;

export function customerOperations(db: Db, businessId: string, months: number, now = new Date()) {
  const n = Math.min(MAX_OPERATION_MONTHS, Math.max(1, Math.floor(months)));
  const current = ym(now);
  const from = addMonths(current, -(n - 1));
  const since = firstInstant(from);

  // Usage, by request cohort; one exclusive status bucket per request.
  const usageRows = db
    .prepare(
      `SELECT ${MONTH("r.created_at")} AS yyyymm,
          CASE
            WHEN s.state = 'charged' THEN 'charged'
            WHEN s.state = 'returned' THEN 'returned'
            WHEN r.conflict IS NOT NULL OR r.state = 'unresolved' OR s.state IN ('conflict','unresolved') THEN 'needs_attention'
            WHEN s.state IN ('requested','unknown') THEN 'settling'
            WHEN r.state = 'reserved' THEN 'reserved_unsettled'
            WHEN r.state IN ('reserve_requested','reserve_unknown') THEN 'awaiting_reservation'
            ELSE 'never_reserved'
          END AS bucket,
          COUNT(*) AS n
         FROM customer_requests r LEFT JOIN customer_settlements s ON s.request_id = r.id
        WHERE r.business_id = ? AND r.created_at >= ?
        GROUP BY yyyymm, bucket`,
    )
    .all(businessId, since) as { yyyymm: number; bucket: keyof UsageCounts; n: number }[];

  // Execution facts, by the same cohort (the charging-eligibility rule for "usable").
  const execRows = db
    .prepare(
      `SELECT ${MONTH("r.created_at")} AS yyyymm,
          CASE
            WHEN i.state = 'unknown' THEN 'unknown'
            WHEN i.state = 'running' OR (i.state = 'completed' AND (x.delivery IS NULL OR x.delivery = 'protecting')) THEN 'undecided'
            WHEN x.delivery = 'delivered' AND x.delivered_at IS NOT NULL AND x.result_outcome = 'extracted'
                 AND i.state = 'completed' AND i.outcome = 'extracted' THEN 'usable_result'
            ELSE 'not_usable'
          END AS bucket,
          COUNT(*) AS n
         FROM customer_executions x
         JOIN customer_requests r ON r.id = x.request_id
         LEFT JOIN runtime_invocations i ON i.id = x.invocation_id
        WHERE r.business_id = ? AND r.created_at >= ?
        GROUP BY yyyymm, bucket`,
    )
    .all(businessId, since) as {
    yyyymm: number;
    bucket: Exclude<keyof ExecutionCounts, "ran">;
    n: number;
  }[];

  // Runtime cost, by invocation month and purpose group; exact sums as text.
  const costRows = db
    .prepare(
      `SELECT ${MONTH("created_at")} AS yyyymm,
          CASE WHEN purpose = 'customer_use' THEN 'customers' ELSE 'founder' END AS grp,
          CAST(COALESCE(SUM(charged_microcents), 0) AS TEXT) AS micro,
          COUNT(*) AS calls,
          COALESCE(SUM(CASE WHEN state <> 'running' AND usage_state IN ('partial','unknown') THEN 1 ELSE 0 END), 0) AS unknown,
          COALESCE(SUM(CASE WHEN usage_state IN ('partial','unknown') THEN reserved_cents ELSE 0 END), 0) AS held
         FROM runtime_invocations
        WHERE business_id = ? AND created_at >= ?
        GROUP BY yyyymm, grp`,
    )
    .all(businessId, since) as {
    yyyymm: number;
    grp: "customers" | "founder";
    micro: string;
    calls: number;
    unknown: number;
    held: number;
  }[];

  const list: OperationsMonth[] = [];
  for (let i = 0; i < n; i++) {
    const m = addMonths(from, i);
    list.push({
      yyyymm: m,
      label: monthLabel(m),
      so_far: m === current,
      usage: ZERO_USAGE(),
      execution: ZERO_EXEC(),
      cost: { customers: ZERO_COST(), founder: ZERO_COST() },
    });
  }
  const at = (m: number) => list.find((x) => x.yyyymm === m);
  for (const r of usageRows) {
    const m = at(r.yyyymm);
    if (!m) continue; // a future-dated row can't enter the period
    m.usage[r.bucket] += r.n;
    m.usage.requested += r.n;
  }
  for (const r of execRows) {
    const m = at(r.yyyymm);
    if (!m) continue;
    m.execution[r.bucket] += r.n;
    m.execution.ran += r.n;
  }
  for (const r of costRows) {
    const m = at(r.yyyymm);
    if (!m) continue;
    const g = m.cost[r.grp];
    g.microcents = addDecimal(g.microcents, r.micro);
    g.calls += r.calls;
    g.unknown_cost_calls += r.unknown;
    g.unknown_held_cents += r.held;
  }

  const totals = {
    usage: ZERO_USAGE(),
    execution: ZERO_EXEC(),
    cost: { customers: ZERO_COST(), founder: ZERO_COST() },
  };
  for (const m of list) {
    for (const k of Object.keys(totals.usage) as (keyof UsageCounts)[])
      totals.usage[k] += m.usage[k];
    for (const k of Object.keys(totals.execution) as (keyof ExecutionCounts)[])
      totals.execution[k] += m.execution[k];
    for (const g of ["customers", "founder"] as const) {
      const t = totals.cost[g];
      t.microcents = addDecimal(t.microcents, m.cost[g].microcents);
      t.calls += m.cost[g].calls;
      t.unknown_cost_calls += m.cost[g].unknown_cost_calls;
      t.unknown_held_cents += m.cost[g].unknown_held_cents;
    }
  }

  // Current, across all time (not a period figure): what still needs settling or attention.
  const open = db
    .prepare(
      `SELECT
          COALESCE(SUM(CASE WHEN s.state IN ('requested','unknown') THEN 1 ELSE 0 END), 0) AS settling,
          COALESCE(SUM(CASE WHEN r.conflict IS NOT NULL OR r.state = 'unresolved' OR s.state IN ('conflict','unresolved') THEN 1 ELSE 0 END), 0) AS attention
         FROM customer_requests r LEFT JOIN customer_settlements s ON s.request_id = r.id
        WHERE r.business_id = ?`,
    )
    .get(businessId) as { settling: number; attention: number };
  const offers = db
    .prepare(
      `SELECT project_id, SUM(state = 'active') AS active, SUM(state = 'retired') AS retired
         FROM customer_offers WHERE business_id = ? GROUP BY project_id ORDER BY project_id LIMIT 20`,
    )
    .all(businessId) as { project_id: string; active: number; retired: number }[];
  const ever = (
    db
      .prepare("SELECT COUNT(*) AS n FROM customer_requests WHERE business_id = ?")
      .get(businessId) as { n: number }
  ).n;

  return {
    state: offers.length === 0 && ever === 0 ? ("not_started" as const) : ("recorded" as const),
    period: { from, to: current, months: n, buckets: "UTC calendar months" },
    months: list,
    totals,
    current: { settling: open.settling, needs_attention: open.attention },
    products: offers.map((o) => ({
      project_id: o.project_id,
      active_offers: o.active,
      retired_offers: o.retired,
    })),
    basis: {
      usage:
        "Each use is counted in the UTC month it was requested; its status is its current recorded outcome (charged and returned are exact contract readbacks). A month's split can change as outcomes resolve; its total can't.",
      execution:
        "A usable result is one delivered to the customer as a complete extraction (the same rule that allows a charge).",
      cost: "Computed from the provider's reported tokens at the declared prices, exact to a millionth of a cent; not an invoice or proof of payment. Calls without full usage are counted as unknown cost, never zero. Building the product is a separate ledger.",
      value:
        "No money value is shown for customer uses: charged counts are units, and the per-use price evidence needed to value them exactly isn't recorded here. Earned revenue above comes only from the business's other records.",
    },
  };
}

export type CustomerOperations = ReturnType<typeof customerOperations>;
