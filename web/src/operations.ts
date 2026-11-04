// Job 003t: pure helpers for the owner's Digital operations card. Costs arrive as exact decimal
// strings of millionths of a cent and are formatted with BigInt, never through a float. Counts
// are whole uses. Every month's description is the accessible text for its chart stop and says
// "so far" for the current month; unknown cost is named, never folded into a dollar figure.

import type { Operations, OpsCost, OpsCurrent, OpsMonth, OpsUsage } from "./api4.ts";

/**
 * Job 003t1: current work in its exclusive groups, each named for exactly what it counts, in
 * priority order (attention first). Zero groups are left out of the list but kept in the total.
 */
export function currentWork(c: OpsCurrent) {
  const parts = [
    { key: "needs_attention", label: "need attention", value: c.needs_attention },
    {
      key: "awaiting_settlement",
      label: "awaiting settlement (outcome not yet read back)",
      value: c.awaiting_settlement,
    },
    {
      key: "reserved_not_settled",
      label: "reserved, not yet settled",
      value: c.reserved_not_settled,
    },
    {
      key: "awaiting_reservation",
      label: "awaiting reservation readback",
      value: c.awaiting_reservation,
    },
    {
      key: "awaiting_signature",
      label: "prepared, awaiting the customer's signature",
      value: c.awaiting_signature,
    },
  ] as const;
  return { total: parts.reduce((a, p) => a + p.value, 0), parts: parts.filter((p) => p.value > 0) };
}

/**
 * Job 003t1: whether units settle by themselves, only from the worker's observed health. Without
 * a running worker nothing promises automatic processing.
 */
export function settlementText(s: Operations["settlement"]): string {
  const at = s.heartbeat_at
    ? ` (last heartbeat ${s.heartbeat_at.replace("T", " ").slice(0, 16)} UTC)`
    : "";
  const paused =
    s.paused_by_authority > 0
      ? ` ${s.paused_by_authority} paused: the platform isn't allowed to meter on the business's contract now.`
      : "";
  switch (s.worker) {
    case "running":
      return `The background worker is running${at}; it settles and returns units by itself.${paused}`;
    case "overdue":
      return `The background worker is overdue${at}: nothing settles by itself until it runs again.${paused}`;
    case "stopped":
      return `The background worker is stopped${at}: units wait until it runs again or the customer settles.${paused}`;
    // Job 002d2: a pass that was run on request is evidence it ran, not a schedule.
    case "not_scheduled":
      return `No background worker is scheduled: a maintenance pass ran only when asked${at}. Units wait until another pass runs or the customer settles.${paused}`;
    case "not_started":
      return "No background worker has run on this server: units wait until one runs or the customer settles.";
    default:
      return "The background worker's state wasn't read: whether units settle by themselves is unknown.";
  }
}

/** Job 003t1: the books' empty message names only what is missing (payments and revenue). */
export function booksEmptyMessage(hasOperations: boolean): string {
  return `No payment or revenue records yet. Earned revenue, cash and cost charts appear once payments are on or a cost is entered; until then revenue is not known, not zero.${
    hasOperations
      ? " Customer uses and runtime cost from this app's own records are shown below."
      : ""
  }`;
}

const MICRO_PER_DOLLAR = 100_000_000n;

/** Exact US dollars from millionths of a cent ("1" is $0.00000001). */
export function microcentsUsd(micro: string): string {
  const v = BigInt(micro);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = (a / MICRO_PER_DOLLAR).toLocaleString("en-US");
  const frac = (a % MICRO_PER_DOLLAR).toString().padStart(8, "0").replace(/0+$/, "");
  return `${neg ? "−" : ""}$${whole}.${frac.padEnd(2, "0")}`;
}

export interface IntScale {
  max: number;
  ticks: number[];
}

/**
 * An axis from zero in whole units (uses, or millionths of a cent): the step is a whole number,
 * so ticks never repeat. Past 2^53 the drawn position is approximate; the exact figure is always
 * in the month's text and the table.
 */
export function intScale(values: number[], count = 4): IntScale {
  const hi = Math.max(0, ...values.filter((v) => Number.isFinite(v)));
  if (hi === 0) return { max: count, ticks: Array.from({ length: count + 1 }, (_, i) => i) };
  const raw = hi / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(
    1,
    Math.ceil([1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw) ?? 10 * mag),
  );
  const max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= max; t += step) ticks.push(t);
  return { max, ticks };
}

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/** Requests reserved but not yet sent to settle (including a reservation still confirming). */
export const openReserved = (u: OpsUsage) => u.reserved_unsettled + u.awaiting_reservation;

/** The status segments of one month's uses, in drawing order; each is its own pattern. */
export function usageSegments(u: OpsUsage) {
  return [
    { key: "charged", label: "Charged", value: u.charged },
    { key: "returned", label: "Returned to the customer", value: u.returned },
    {
      key: "settling",
      label: "Awaiting settlement (outcome not yet read back)",
      value: u.settling,
    },
    { key: "attention", label: "Needs attention", value: u.needs_attention },
    { key: "open", label: "Reserved, not yet run or settled", value: openReserved(u) },
    { key: "never", label: "Never reserved (prepared or cancelled)", value: u.never_reserved },
  ] as const;
}

export const monthName = (m: OpsMonth) => `${m.label}${m.so_far ? " (so far)" : ""}`;

export function describeUsage(m: OpsMonth): string {
  const u = m.usage;
  if (u.requested === 0) return `${monthName(m)}: no customer uses requested (recorded zero)`;
  const parts = [
    `${u.charged} charged`,
    `${u.returned} returned`,
    `${u.settling} awaiting settlement`,
    `${u.needs_attention} needing attention`,
    `${openReserved(u)} reserved, not yet settled`,
    `${u.never_reserved} never reserved`,
  ];
  const x = m.execution;
  const ran =
    x.ran === 0
      ? "none ran"
      : `${x.ran} ran: ${x.usable_result} usable, ${x.not_usable} not usable${x.undecided ? `, ${x.undecided} undecided` : ""}${x.unknown ? `, ${x.unknown} unknown` : ""}`;
  return `${monthName(m)}: ${n(u.requested, "use")} requested (${parts.join(", ")}); ${ran}`;
}

/** One purpose's cost in words. Unknown-cost calls are never written as $0. */
export function costText(c: OpsCost): string {
  if (c.calls === 0) return "no runtime calls (recorded zero)";
  const known = `${microcentsUsd(c.microcents)} over ${n(c.calls, "call")}`;
  if (c.unknown_cost_calls === 0) return known;
  return `${known}; ${c.unknown_cost_calls} of them with unknown cost (${c.unknown_held_cents}¢ still reserved), not counted as zero`;
}

export function describeCost(m: OpsMonth): string {
  return `${monthName(m)}: serving customers ${costText(m.cost.customers)}; founder trials and checks ${costText(m.cost.founder)}`;
}
