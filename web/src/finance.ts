// Job 003f: what the financial charts and tiles say, as pure functions so the rules are tested
// without a browser. Unknown is never drawn or summed as zero, partial months are never
// compared as if complete, and a comparison explains itself when a percentage would mislead.

export type ChainState = "observed" | "unavailable" | "not_connected" | "not_applicable";
export type Coverage = "complete" | "current_partial" | "first_partial" | "before_start";

export interface CashFlows {
  cash_in_cents: number;
  orders_in_cents: number;
  prepaid_in_cents: number;
  returned_cents: number;
  refunds_cents: number;
  credit_withdrawn_cents: number;
  credit_used_cents: number;
  owner_withdrawals_cents: number;
  sale_proceeds_cents: number;
}

/** One month of the books, as the server sends it (owner and granted buyers alike). */
export interface FinMonth {
  yyyymm: number;
  label: string;
  coverage: Coverage;
  complete: boolean;
  chain: ChainState;
  chain_reason: string | null;
  revenue_cents: number | null;
  revenue_basis: "observed" | "seeded" | "none" | "unknown";
  seeded_cents: number | null;
  mixed: boolean;
  direct_cents: number;
  overhead_cents: number;
  profit_cents: number | null;
  revenue_sources: string[];
  cost_sources: string[];
  cash: CashFlows | null;
  lines?: {
    kind: "revenue" | "direct" | "overhead";
    label: string;
    cents: number;
    source: string;
    category?: string;
  }[];
}

/** Dollars with cents; unknown is a dash, never $0. */
export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  const sign = cents < 0 ? "−" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Exact model spend from millionths of a cent, e.g. $0.001500. */
export const microUsd = (micro: number) => `$${(micro / 100_000_000).toFixed(6)}`;

/** Why a month's revenue is missing, in plain words; null when it is known. */
export function missingReason(m: FinMonth): string | null {
  if (m.revenue_cents !== null) return null;
  if (m.chain === "unavailable") return "Couldn't be read from NEAR testnet";
  if (m.chain === "not_connected") return "NEAR testnet isn't connected here";
  return "Not known";
}

export const partial = (m: FinMonth) =>
  m.coverage === "current_partial" || m.coverage === "first_partial";

export interface Scale {
  min: number;
  max: number;
  ticks: number[];
}

/** A readable axis that always includes zero, for any mix of positive and negative values. */
export function niceScale(values: (number | null)[], count = 4): Scale {
  const known = values.filter((v): v is number => v !== null && Number.isFinite(v));
  let lo = Math.min(0, ...known);
  let hi = Math.max(0, ...known);
  if (lo === hi) hi = lo + 10_000; // an all-zero or empty chart still gets a $100 axis
  const span = hi - lo;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw) ?? 10 * mag) as number;
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Math.round(t));
  return { min: lo, max: hi, ticks };
}

/** Pixel position for a value on a vertical axis of `height` (0 at the top). */
export const yOf = (s: Scale, v: number, height: number) =>
  height - ((v - s.min) / (s.max - s.min)) * height;

/** Contribution as line segments that break at every unknown month (never bridged). */
export function segments(months: FinMonth[]): { index: number; value: number }[][] {
  const out: { index: number; value: number }[][] = [];
  let cur: { index: number; value: number }[] = [];
  months.forEach((m, index) => {
    if (m.profit_cents === null) {
      if (cur.length) out.push(cur);
      cur = [];
    } else cur.push({ index, value: m.profit_cents });
  });
  if (cur.length) out.push(cur);
  return out;
}

/** Costs by category over the months shown, largest first, with each share of the total. */
export function categories(months: FinMonth[]) {
  const by = new Map<string, number>();
  for (const m of months)
    for (const l of m.lines ?? [])
      if (l.kind !== "revenue") {
        const k = l.category ?? l.label.split(":")[0] ?? "Other";
        by.set(k, (by.get(k) ?? 0) + l.cents);
      }
  const total = [...by.values()].reduce((a, b) => a + b, 0);
  return [...by.entries()]
    .map(([category, cents]) => ({ category, cents, share: total ? cents / total : 0 }))
    .sort((a, b) => b.cents - a.cents);
}

/**
 * How `b`'s contribution compares with `a`'s (the month before), in words. No comparison with
 * a missing or partial month; no percentage from a zero or negative baseline.
 */
export function compare(a: FinMonth | undefined, b: FinMonth | undefined): string {
  if (!a || !b) return "Not enough months to compare yet.";
  for (const m of [a, b]) {
    if (m.profit_cents === null)
      return `Can't compare: ${m.label} ${missingReason(m)?.toLowerCase()}.`;
    if (partial(m)) return `${m.label} isn't a whole month of records, so it isn't compared.`;
  }
  const x = a.profit_cents as number;
  const y = b.profit_cents as number;
  const diff = y - x;
  const change = `${diff >= 0 ? "+" : "−"}${money(Math.abs(diff)).replace("−", "")}`;
  if (x === 0)
    return `${change} from ${money(0)} in ${a.label}; no percentage from a zero baseline.`;
  if (x < 0)
    return `${change} compared with ${a.label} (no percentage: that month's contribution was negative).`;
  const pct = Math.round((diff / x) * 100);
  return `${pct >= 0 ? "+" : "−"}${Math.abs(pct)}% (${money(x)} in ${a.label} → ${money(y)} in ${b.label}).`;
}

/** The latest two whole, known months, for the headline comparison. */
export function lastTwoComplete(months: FinMonth[]): [FinMonth | undefined, FinMonth | undefined] {
  const whole = months.filter((m) => m.complete);
  return [whole.at(-2), whole.at(-1)];
}
