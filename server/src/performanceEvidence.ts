// Job 003u/003u1: digital performance evidence for an acquirer
// (docs/design/DIGITAL_PERFORMANCE_EVIDENCE.md). A scoped projection of the one authoritative
// aggregation (customerOperations, 003t/003t1), built field by field from an allowlist, over one
// fixed window, as of one instant.
//
// 003u1: withholding is decided for the WHOLE projection, not per partition. If any count that
// would be published, or any difference of published counts that is itself a group of uses (not
// run, calls without a run, open work outside the window), is 1 or 2, every breakdown is withheld
// and only totals that can't single anyone out remain. A withheld value is "withheld": it claims no
// size. Tested by enumerating complete public outputs, not by restating these conditions.

import type { Db } from "./db.ts";
import { addDecimal, customerOperations } from "./operations.ts";

export const PERFORMANCE_MONTHS = 12;
export const WITHHELD = "withheld" as const;
export type Shown = number | typeof WITHHELD;

const small = (n: number) => n === 1 || n === 2 || n === -1 || n === -2;

/**
 * One group on its own (used where a single partition is all that is published): if any cell or
 * the total is small, every cell is withheld, and the total too when it is itself small.
 */
export function suppressPartition(
  cells: number[],
  total: number,
): { cells: Shown[]; total: Shown } {
  const any = small(total) || cells.some(small);
  return {
    cells: cells.map((c) => (any ? WITHHELD : c)),
    total: small(total) ? WITHHELD : total,
  };
}

/** The counts the projection could publish, before deciding what is safe to show. */
export interface RawPerformance {
  requested: number;
  /** charged, returned, awaiting settlement, needs attention, reserved (incl. awaiting), never. */
  split: number[];
  /** Requested per month of the window. */
  months: number[];
  ran: number;
  /** usable, not usable, undecided or unknown. */
  execution: number[];
  /** needs attention, awaiting settlement, reserved not settled, awaiting reservation (all time). */
  current: number[];
  /** Customer calls per month of the window. */
  calls: number[];
  unknownCalls: number;
}

export interface Disclosed {
  /** Whether breakdowns were withheld because some group would have been 1 or 2. */
  withheld: boolean;
  requested: Shown;
  split: Shown[];
  months: Shown[];
  ran: Shown;
  execution: Shown[];
  current: Shown[];
  currentTotal: Shown;
  calls: Shown[];
  callsTotal: Shown;
  unknownCalls: Shown;
}

const sum = (xs: number[]) => xs.reduce((a, n) => a + n, 0);

/** The whole-projection rule (pure). */
export function disclose(raw: RawPerformance): Disclosed {
  const callsTotal = sum(raw.calls);
  const currentTotal = sum(raw.current);
  const [cAttention = 0, cSettling = 0, cReserved = 0, cAwaiting = 0] = raw.current;
  const [, , uSettling = 0, uAttention = 0, uReserved = 0] = raw.split;
  // Every count that would be published, and every published difference that is a set of uses.
  const quantities = [
    raw.requested,
    ...raw.split,
    ...raw.months,
    raw.ran,
    ...raw.execution,
    ...raw.current,
    currentTotal,
    ...raw.calls,
    callsTotal,
    raw.unknownCalls,
    raw.requested - raw.ran, // requested but never run
    callsTotal - raw.ran, // calls without a run in the window, or runs without a call
    cAttention - uAttention, // open work outside the window
    cSettling - uSettling,
    cReserved + cAwaiting - uReserved,
  ];
  if (!quantities.some(small))
    return {
      withheld: false,
      requested: raw.requested,
      split: raw.split,
      months: raw.months,
      ran: raw.ran,
      execution: raw.execution,
      current: raw.current,
      currentTotal,
      calls: raw.calls,
      callsTotal,
      unknownCalls: raw.unknownCalls,
    };
  // Breakdowns withheld. Only the total requested stays, unless it is itself small. Customer
  // calls and their cost are withheld too: showing them only sometimes would itself say which
  // difference was small.
  const requested: Shown = small(raw.requested) ? WITHHELD : raw.requested;
  const all = <T>(xs: T[]) => xs.map(() => WITHHELD);
  return {
    withheld: true,
    requested,
    split: all(raw.split),
    months: all(raw.months),
    ran: WITHHELD,
    execution: all(raw.execution),
    current: all(raw.current),
    currentTotal: WITHHELD,
    calls: all(raw.calls),
    callsTotal: WITHHELD,
    unknownCalls: WITHHELD,
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
  const x = t.execution;
  const c = ops.current;
  const cust = t.cost.customers;
  const d = disclose({
    requested: u.requested,
    split: [
      u.charged,
      u.returned,
      u.settling,
      u.needs_attention,
      u.reserved_unsettled + u.awaiting_reservation,
      u.never_reserved,
    ],
    months: ops.months.map((m) => m.usage.requested),
    ran: x.ran,
    execution: [x.usable_result, x.not_usable, x.undecided + x.unknown],
    current: CURRENT.map(([k]) => c[k]),
    calls: ops.months.map((m) => m.cost.customers.calls),
    unknownCalls: cust.unknown_cost_calls,
  });
  // The projection must agree with the aggregation (never a second model).
  const recomputed = ops.months.reduce((a, m) => addDecimal(a, m.cost.customers.microcents), "0");
  if (recomputed !== cust.microcents) throw new Error("performance evidence: cost mismatch");

  return {
    as_of: ops.as_of,
    state: ops.state,
    period: ops.period,
    withheld: d.withheld,
    usage: {
      requested: d.requested,
      split: USAGE_SPLIT.map(([key, label], i) => ({ key, label, value: d.split[i] as Shown })),
    },
    months: ops.months.map((m, i) => {
      const f = m.cost.founder;
      const calls = d.calls[i] as Shown;
      return {
        yyyymm: m.yyyymm,
        label: m.label,
        so_far: m.so_far,
        requested: d.months[i] as Shown,
        customers: {
          calls,
          microcents: calls === WITHHELD ? WITHHELD : m.cost.customers.microcents,
        },
        founder: {
          calls: f.calls,
          microcents: f.microcents,
          unknown_cost_calls: f.unknown_cost_calls,
        },
      };
    }),
    execution: {
      ran: d.ran,
      usable_result: d.execution[0] as Shown,
      not_usable: d.execution[1] as Shown,
      undecided_or_unknown: d.execution[2] as Shown,
    },
    current: {
      total: d.currentTotal,
      groups: CURRENT.map(([key, label], i) => ({ key, label, value: d.current[i] as Shown })),
    },
    cost: {
      customers: {
        calls: d.callsTotal,
        microcents: d.callsTotal === WITHHELD ? WITHHELD : cust.microcents,
        unknown_cost_calls: d.unknownCalls,
        unknown_held_cents: d.unknownCalls === WITHHELD ? WITHHELD : cust.unknown_held_cents,
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
      "\"Withheld\" means not shown; it says nothing about the size. When any group of uses here would be 1 or 2 (including groups that could be worked out from other figures), every breakdown is withheld and only totals that can't single anyone out are shown. Founder trials and checks are the seller's own activity and are always shown.",
    limits: [
      "This lowers the risk of singling out a customer; it is not a guarantee of anonymity.",
      "Reading again later shows how figures moved in between.",
      "Whether breakdowns are withheld itself tells you that some group is small.",
    ],
  };
}

export type PerformanceEvidence = ReturnType<typeof performanceEvidence>;
