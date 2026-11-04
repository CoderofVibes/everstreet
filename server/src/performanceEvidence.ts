// Job 003u: digital performance evidence for an acquirer (docs/design/DIGITAL_PERFORMANCE_EVIDENCE.md).
// A scoped projection of the one authoritative aggregation (customerOperations, 003t/003t1):
// built field by field from an allowlist, over one fixed window, as of one instant, with coherent
// small-group suppression. Nothing here counts on its own, and nothing is passed through whole.

import type { Db } from "./db.ts";
import { addDecimal, customerOperations } from "./operations.ts";

export const PERFORMANCE_MONTHS = 12;
export const FEWER = "fewer_than_3" as const;
export type Shown = number | typeof FEWER;

const small = (n: number) => n > 0 && n < 3;

/**
 * Coherent suppression of a partition (cells that add up to a published total): primary (1–2),
 * then secondary so no single small cell can be recovered by subtraction, and the total itself
 * when it is small or when nothing else could hide the one suppressed cell.
 */
export function suppressPartition(
  cells: number[],
  total: number,
): { cells: Shown[]; total: Shown } {
  const hide = cells.map(small);
  let hideTotal = small(total);
  if (hideTotal) for (const [i, c] of cells.entries()) hide[i] = hide[i] || c > 0;
  else if (hide.filter(Boolean).length === 1) {
    let best = -1;
    cells.forEach((c, i) => {
      if (!hide[i] && c > 0 && (best === -1 || c < (cells[best] as number))) best = i;
    });
    if (best >= 0) hide[best] = true;
    else hideTotal = true;
  }
  return {
    cells: cells.map((c, i) => (hide[i] ? FEWER : c)),
    total: hideTotal ? FEWER : total,
  };
}

const USAGE_SPLIT = [
  ["charged", "Charged"],
  ["returned", "Returned to the customer"],
  ["settling", "Awaiting settlement"],
  ["needs_attention", "Needs attention"],
  ["reserved", "Reserved, not yet settled"],
  ["never_reserved", "Never reserved (prepared or cancelled)"],
] as const;

const CURRENT = [
  ["needs_attention", "Needs attention"],
  ["awaiting_settlement", "Awaiting settlement"],
  ["reserved_not_settled", "Reserved, not yet settled"],
  ["awaiting_reservation", "Awaiting reservation readback"],
] as const;

export function performanceEvidence(db: Db, businessId: string, asOf: Date) {
  // One read of the authoritative aggregation. The customer-service clock only matters for
  // unsigned preparations, which this projection leaves out.
  const ops = customerOperations(db, businessId, PERFORMANCE_MONTHS, asOf, {
    nowMs: asOf.getTime(),
    health: null,
  });
  const t = ops.totals;
  const u = t.usage;
  const usage = suppressPartition(
    [
      u.charged,
      u.returned,
      u.settling,
      u.needs_attention,
      u.reserved_unsettled + u.awaiting_reservation,
      u.never_reserved,
    ],
    u.requested,
  );
  const monthly = suppressPartition(
    ops.months.map((m) => m.usage.requested),
    u.requested,
  );
  const x = t.execution;
  const execution = suppressPartition(
    [x.usable_result, x.not_usable, x.undecided + x.unknown],
    x.ran,
  );
  const c = ops.current;
  const currentCells = CURRENT.map(([k]) => c[k]);
  const current = suppressPartition(
    currentCells,
    currentCells.reduce((a, n) => a + n, 0),
  );
  const custCalls = suppressPartition(
    ops.months.map((m) => m.cost.customers.calls),
    t.cost.customers.calls,
  );
  const cust = t.cost.customers;
  const unknownCust: Shown = small(cust.unknown_cost_calls) ? FEWER : cust.unknown_cost_calls;
  // A combined total and its exact parts are recomputed here only to check the projection agrees
  // with the aggregation (never a second model).
  const recomputed = ops.months.reduce((a, m) => addDecimal(a, m.cost.customers.microcents), "0");
  if (recomputed !== cust.microcents) throw new Error("performance evidence: cost mismatch");

  return {
    as_of: ops.as_of,
    state: ops.state,
    period: ops.period,
    usage: {
      requested: usage.total,
      split: USAGE_SPLIT.map(([key, label], i) => ({
        key,
        label,
        value: usage.cells[i] as Shown,
      })),
    },
    months: ops.months.map((m, i) => {
      const calls = custCalls.cells[i] as Shown;
      const f = m.cost.founder;
      return {
        yyyymm: m.yyyymm,
        label: m.label,
        so_far: m.so_far,
        requested: monthly.cells[i] as Shown,
        customers: {
          calls,
          microcents: calls === FEWER ? FEWER : m.cost.customers.microcents,
        },
        founder: {
          calls: f.calls,
          microcents: f.microcents,
          unknown_cost_calls: f.unknown_cost_calls,
        },
      };
    }),
    execution: {
      ran: execution.total,
      usable_result: execution.cells[0] as Shown,
      not_usable: execution.cells[1] as Shown,
      undecided_or_unknown: execution.cells[2] as Shown,
    },
    current: {
      total: current.total,
      groups: CURRENT.map(([key, label], i) => ({ key, label, value: current.cells[i] as Shown })),
    },
    cost: {
      customers: {
        calls: custCalls.total,
        microcents: custCalls.total === FEWER ? FEWER : cust.microcents,
        unknown_cost_calls: unknownCust,
        unknown_held_cents: unknownCust === FEWER ? FEWER : cust.unknown_held_cents,
      },
      founder: {
        calls: t.cost.founder.calls,
        microcents: t.cost.founder.microcents,
        unknown_cost_calls: t.cost.founder.unknown_cost_calls,
        unknown_held_cents: t.cost.founder.unknown_held_cents,
      },
    },
    basis: {
      usage: ops.basis.usage,
      execution: ops.basis.execution,
      cost: ops.basis.cost,
      current:
        "Open work counts every customer use up to this reading that is not finished: each in one group only. Customers' unsigned preparations aren't included.",
      not: "These are this app's own records of customer uses and runtime calls. They are not revenue, cash, profit, a valuation, testnet verification or proof of real provider execution, and no money value is given for uses.",
    },
    suppression:
      'Counts of 1 or 2 show as "Fewer than 3". Where one hidden count could be worked out from a total, a second count (or the total) is hidden too; a month\'s customer cost is hidden with its calls. Monthly figures give totals only, over one fixed 12-month window.',
    limits: [
      "Reading again later shows how figures moved in between.",
      "Usage and results are separate groups, so close relationships (charged and usable) give rough bounds.",
      "The combined customer cost of two or more hidden months can be worked out.",
    ],
  };
}

export type PerformanceEvidence = ReturnType<typeof performanceEvidence>;
