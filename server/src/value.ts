// The Everstreet valuation estimate: an explainable scenario model, not a market appraisal.
//
//   operating profit over the months used (earned revenue − direct costs − overhead)
//   − the founder's own work a successor would have to pay for
//   = normalized earnings, annualized from the months used
//   × low/high earnings multiples (illustrative assumptions, labeled as such)
//   = a range, labeled with its stage, its months and every source.
//
// Stages: no earned month yet → a value plan ("if this came true"); one or two complete months
// → early estimate; three or more → the last three complete months annualized. Every distinct
// set of inputs is kept as a snapshot so "what changed" is exact, and what-if scenarios are
// private to the founder.

import { createHash, randomUUID } from "node:crypto";
import { type Books, type Month, revenueOf } from "./books.ts";
import type { Db } from "./db.ts";
import { HttpError, type Person, type Store } from "./store.ts";

export const MODEL = "scenario-v1";

const DEFAULTS: Record<string, { hours: number; low: number; high: number; plan: number }> = {
  class: { hours: 6, low: 1.5, high: 2.5, plan: 20 },
  service: { hours: 10, low: 1, high: 2, plan: 8 },
  product: { hours: 8, low: 1.5, high: 2.5, plan: 30 },
  software: { hours: 8, low: 2, high: 3, plan: 40 },
  undecided: { hours: 8, low: 1, high: 2, plan: 10 },
};
const DEFAULT_RATE_CENTS = 3000;
const WEEKS_PER_MONTH = 52 / 12;

export interface Settings {
  founder_hours_week: number | null;
  hourly_rate_cents: number | null;
  multiple_low: number | null;
  multiple_high: number | null;
  plan_customers_month: number | null;
  share_numbers: boolean;
}

export interface Overrides {
  extra_customers_month?: number;
  price_cents?: number;
  founder_hours_week?: number;
  hourly_rate_cents?: number;
  extra_monthly_costs_cents?: number;
  multiple_low?: number;
  multiple_high?: number;
}

export interface Inputs {
  model: string;
  /** `unavailable`: some complete months couldn't be read, so no estimate is made (job 003f). */
  stage: "plan" | "early" | "operating" | "unavailable";
  /** Months whose books couldn't be read; never treated as zero. */
  gaps?: string[];
  months_used: number[];
  revenue_cents: number;
  costs_cents: number;
  direct_cents: number;
  overhead_cents: number;
  labor_month_cents: number;
  founder_hours_week: number;
  hourly_rate_cents: number;
  labor_is_default: boolean;
  multiple_low: number;
  multiple_high: number;
  multiples_are_default: boolean;
  annualize_by: number;
  plan_customers_month: number | null;
  price_cents: number | null;
  revenue_sources: string[];
  cost_sources: string[];
}

export interface Estimate {
  inputs: Inputs;
  normalized_annual_cents: number;
  low_cents: number | null;
  high_cents: number | null;
  label: string;
  explanation: string[];
  missing: string[];
  sources: { input: string; value: string; source: string }[];
}

const round100 = (c: number) => Math.round(c / 10000) * 10000; // to the nearest $100
const usd = (c: number) =>
  `${c < 0 ? "−" : ""}$${Math.abs(Math.round(c / 100)).toLocaleString("en-US")}`;

export function estimate(input: Inputs): Estimate {
  if (input.stage === "unavailable") {
    const gaps = (input.gaps ?? []).join(", ");
    return {
      inputs: input,
      normalized_annual_cents: 0,
      low_cents: null,
      high_cents: null,
      label: "No estimate right now · some months couldn't be read",
      explanation: [
        `The books for ${gaps} couldn't be read from NEAR testnet. No estimate is made from incomplete books, and those months are not counted as zero.`,
      ],
      missing: [`Try again when ${gaps} can be read.`],
      sources: [],
    };
  }
  const n = input.months_used.length;
  const profit = input.revenue_cents - input.costs_cents;
  const labor = input.labor_month_cents * (input.stage === "plan" ? 12 : n);
  const normalizedPeriod = profit - labor;
  const annual = Math.round(normalizedPeriod * input.annualize_by);
  const positive = annual > 0;
  const low = positive ? round100(annual * input.multiple_low) : null;
  const high = positive ? round100(annual * input.multiple_high) : null;
  const periodName =
    input.stage === "plan"
      ? "a year of the plan"
      : n === 1
        ? "1 complete month"
        : `${n} complete months`;
  const explanation =
    input.stage === "plan"
      ? [
          `Plan: ${input.plan_customers_month} customers a month × ${usd(input.price_cents ?? 0)} × 12   ${usd(input.revenue_cents)}`,
          `Costs over a year (recurring costs you entered)   −${usd(input.costs_cents)}`,
          `Your own work: ${input.founder_hours_week} h/week × ${usd(input.hourly_rate_cents)}/h × 12 months   −${usd(labor)}`,
          `Normalized annual earnings   ${usd(annual)}`,
          `× ${input.multiple_low}–${input.multiple_high} (illustrative assumptions, not market data)`,
        ]
      : [
          `Earned revenue, ${periodName}   ${usd(input.revenue_cents)}`,
          `Direct costs   −${usd(input.direct_cents)}`,
          `Overhead   −${usd(input.overhead_cents)}`,
          `Operating profit   ${usd(profit)}`,
          `Your own work: ${input.founder_hours_week} h/week × ${usd(input.hourly_rate_cents)}/h × ${n} ${n === 1 ? "month" : "months"}   −${usd(labor)}`,
          `Normalized earnings, ${periodName}   ${usd(normalizedPeriod)}`,
          `Annualized (× ${Number(input.annualize_by.toFixed(2))})   ${usd(annual)}`,
          `× ${input.multiple_low}–${input.multiple_high} (illustrative assumptions, not market data)`,
        ];
  const missing: string[] = [];
  if (input.stage !== "plan" && input.costs_cents === 0)
    missing.push(
      "No costs are recorded for these months, so profit is probably overstated. Add what the business pays for.",
    );
  if (input.labor_is_default)
    missing.push(
      `Your own work uses a default (${input.founder_hours_week} h/week at ${usd(input.hourly_rate_cents)}/h). Set your real hours.`,
    );
  if (input.multiples_are_default)
    missing.push(
      "The multiples are illustrative defaults for this kind of business, not researched market data.",
    );
  if (input.stage === "early")
    missing.push(`Only ${periodName} of history: a short period annualized can mislead.`);
  if (input.revenue_sources.some((s) => s.includes("testnet")))
    missing.push(
      "NEAR revenue here is test money on testnet: the estimate shows the method, not a market value.",
    );
  if (input.revenue_sources.some((s) => s.includes("Seeded")))
    missing.push("Includes fictional seeded history for this example business.");
  const label =
    input.stage === "plan"
      ? "Value plan · if this came true · not an estimate of today's business"
      : `Estimate · scenario model · ${periodName}${input.annualize_by !== 1 ? " annualized" : ""}`;
  const sources = [
    {
      input: input.stage === "plan" ? "Planned revenue" : "Earned revenue",
      value: usd(input.revenue_cents),
      source:
        input.stage === "plan"
          ? "Estimate (your plan)"
          : input.revenue_sources.join(" + ") || "None recorded",
    },
    {
      input: "Costs",
      value: usd(input.costs_cents),
      source: input.cost_sources.join(" + ") || "None recorded",
    },
    {
      input: "Your own work",
      value: `${usd(input.labor_month_cents)}/month`,
      source: input.labor_is_default ? "Estimate (default)" : "Estimate (yours)",
    },
    {
      input: "Multiples",
      value: `${input.multiple_low}–${input.multiple_high}×`,
      source: input.multiples_are_default ? "Estimate (illustrative default)" : "Estimate (yours)",
    },
    {
      input: "Annualization",
      value: `× ${Number(input.annualize_by.toFixed(2))}`,
      source: "Computed",
    },
  ];
  return {
    inputs: input,
    normalized_annual_cents: annual,
    low_cents: low,
    high_cents: high,
    label,
    explanation,
    missing,
    sources,
  };
}

function hash(i: Inputs) {
  return createHash("sha256").update(JSON.stringify(i)).digest("hex");
}

/** The same inputs with a what-if applied; used by founders' and buyers' private scenarios. */
export function withOverrides(base: Inputs, o: Overrides): Inputs {
  const n = base.stage === "plan" ? 12 : base.months_used.length;
  const price = o.price_cents ?? base.price_cents ?? 0;
  const hours = o.founder_hours_week ?? base.founder_hours_week;
  const rate = o.hourly_rate_cents ?? base.hourly_rate_cents;
  const extraRevenue = (o.extra_customers_month ?? 0) * price * n;
  const priceDelta =
    o.price_cents !== undefined && base.stage === "plan"
      ? (o.price_cents - (base.price_cents ?? 0)) * (base.plan_customers_month ?? 0) * 12
      : 0;
  const extraCosts = (o.extra_monthly_costs_cents ?? 0) * n;
  return {
    ...base,
    revenue_cents: base.revenue_cents + extraRevenue + priceDelta,
    costs_cents: base.costs_cents + extraCosts,
    overhead_cents: base.overhead_cents + extraCosts,
    founder_hours_week: hours,
    hourly_rate_cents: rate,
    labor_month_cents: Math.round(hours * WEEKS_PER_MONTH * rate),
    labor_is_default: o.founder_hours_week === undefined && base.labor_is_default,
    multiple_low: o.multiple_low ?? base.multiple_low,
    multiple_high: o.multiple_high ?? base.multiple_high,
    multiples_are_default:
      o.multiple_low === undefined && o.multiple_high === undefined && base.multiples_are_default,
    price_cents: price,
  };
}

export class Valuation {
  constructor(
    private readonly db: Db,
    private readonly store: Store,
    private readonly books: Books,
  ) {}

  settings(businessId: string): Settings {
    const r = this.db
      .prepare("SELECT * FROM value_settings WHERE business_id = ?")
      .get(businessId) as (Omit<Settings, "share_numbers"> & { share_numbers: number }) | undefined;
    return {
      founder_hours_week: r?.founder_hours_week ?? null,
      hourly_rate_cents: r?.hourly_rate_cents ?? null,
      multiple_low: r?.multiple_low ?? null,
      multiple_high: r?.multiple_high ?? null,
      plan_customers_month: r?.plan_customers_month ?? null,
      share_numbers: Boolean(r?.share_numbers),
    };
  }

  updateSettings(founder: Person, businessId: string, patch: Partial<Settings>) {
    this.store.business(founder, businessId);
    const s = { ...this.settings(businessId), ...patch };
    const num = (v: unknown, min: number, max: number) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < min || n > max)
        throw new HttpError(400, `Use a number from ${min} to ${max}`);
      return n;
    };
    const low = num(s.multiple_low, 0.1, 20);
    const high = num(s.multiple_high, 0.1, 20);
    if (low !== null && high !== null && high < low)
      throw new HttpError(400, "The high multiple must be at least the low one");
    this.db
      .prepare(
        `INSERT INTO value_settings (business_id, founder_hours_week, hourly_rate_cents, multiple_low, multiple_high, plan_customers_month, share_numbers, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(business_id) DO UPDATE SET founder_hours_week = excluded.founder_hours_week, hourly_rate_cents = excluded.hourly_rate_cents,
           multiple_low = excluded.multiple_low, multiple_high = excluded.multiple_high, plan_customers_month = excluded.plan_customers_month,
           share_numbers = excluded.share_numbers, updated_at = excluded.updated_at`,
      )
      .run(
        businessId,
        num(s.founder_hours_week, 0, 100),
        num(s.hourly_rate_cents, 0, 100_000),
        low,
        high,
        num(s.plan_customers_month, 0, 100_000),
        s.share_numbers ? 1 : 0,
        new Date().toISOString(),
      );
    return this.settings(businessId);
  }

  /** The inputs for this business right now, from its books and settings. */
  async inputs(businessId: string, months?: Month[]): Promise<Inputs> {
    const b = this.db.prepare("SELECT family FROM businesses WHERE id = ?").get(businessId) as {
      family: string;
    };
    const d = DEFAULTS[b.family] ?? (DEFAULTS.undecided as (typeof DEFAULTS)["class"]);
    const s = this.settings(businessId);
    const all = months ?? (await this.books.months(businessId, 12)).months;
    // Only whole months count: the current month and the account's first partial month are
    // never annualized. A complete month that couldn't be read stops the estimate (job 003f).
    const complete = all.filter((m) => m.complete);
    const gaps = complete.filter((m) => m.revenue_cents === null).map((m) => m.label);
    const firstEarning = complete.findIndex((m) => (m.revenue_cents ?? 0) > 0);
    const operating = firstEarning < 0 ? [] : complete.slice(firstEarning);
    const used = operating.slice(-3);
    const hours = s.founder_hours_week ?? d.hours;
    const rate = s.hourly_rate_cents ?? DEFAULT_RATE_CENTS;
    const offer = this.store.offerOf(businessId);
    const sum = (k: "direct_cents" | "overhead_cents") => used.reduce((a, m) => a + m[k], 0);
    const base = {
      model: MODEL,
      founder_hours_week: hours,
      hourly_rate_cents: rate,
      labor_month_cents: Math.round(hours * WEEKS_PER_MONTH * rate),
      labor_is_default: s.founder_hours_week === null,
      multiple_low: s.multiple_low ?? d.low,
      multiple_high: s.multiple_high ?? d.high,
      multiples_are_default: s.multiple_low === null && s.multiple_high === null,
      price_cents: offer.first_free ? 0 : offer.price_cents,
    };
    if (gaps.length)
      return {
        ...base,
        stage: "unavailable",
        gaps,
        months_used: [],
        revenue_cents: 0,
        costs_cents: 0,
        direct_cents: 0,
        overhead_cents: 0,
        annualize_by: 1,
        plan_customers_month: null,
        revenue_sources: [],
        cost_sources: [],
      };
    if (used.length === 0) {
      const customers = s.plan_customers_month ?? d.plan;
      const current = all[all.length - 1] as Month;
      const monthlyCosts = current.direct_cents + current.overhead_cents;
      return {
        ...base,
        stage: "plan",
        months_used: [],
        revenue_cents: customers * (offer.price_cents ?? 0) * 12,
        costs_cents: monthlyCosts * 12,
        direct_cents: current.direct_cents * 12,
        overhead_cents: current.overhead_cents * 12,
        annualize_by: 1,
        plan_customers_month: customers,
        revenue_sources: ["Estimate (your plan)"],
        cost_sources: [...new Set(current.cost_sources)],
      };
    }
    return {
      ...base,
      stage: used.length >= 3 ? "operating" : "early",
      months_used: used.map((m) => m.yyyymm),
      // Exact: chain amounts are summed in base units and converted once.
      revenue_cents: revenueOf(used, this.books.decimals) ?? 0,
      costs_cents: sum("direct_cents") + sum("overhead_cents"),
      direct_cents: sum("direct_cents"),
      overhead_cents: sum("overhead_cents"),
      annualize_by: 12 / used.length,
      plan_customers_month: null,
      revenue_sources: [...new Set(used.flatMap((m) => m.revenue_sources))],
      cost_sources: [...new Set(used.flatMap((m) => m.cost_sources))],
    };
  }

  private latest(businessId: string, skip = 0) {
    return this.db
      .prepare(
        "SELECT * FROM value_snapshots WHERE business_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1 OFFSET ?",
      )
      .get(businessId, skip) as
      | { id: string; inputs_hash: string; inputs: string; output: string; created_at: string }
      | undefined;
  }

  /**
   * Computes the estimate; keeps a snapshot whenever the inputs changed. Never from incomplete
   * books (an outage is not a change), and not from an anonymous public read.
   */
  async current(businessId: string, months?: Month[], options: { snapshot?: boolean } = {}) {
    const inputs = await this.inputs(businessId, months);
    const result = estimate(inputs);
    const h = hash(inputs);
    const last = this.latest(businessId);
    if (options.snapshot !== false && inputs.stage !== "unavailable" && last?.inputs_hash !== h) {
      this.db
        .prepare(
          "INSERT INTO value_snapshots (id, business_id, model, inputs_hash, inputs, output, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          randomUUID(),
          businessId,
          MODEL,
          h,
          JSON.stringify(inputs),
          JSON.stringify(result),
          new Date().toISOString(),
        );
    }
    return result;
  }

  /** What moved between the previous snapshot and this one, input by input. */
  whatChanged(businessId: string) {
    const now = this.latest(businessId);
    const before = this.latest(businessId, 1);
    if (!now || !before) return null;
    const a = JSON.parse(before.output) as Estimate;
    const b = JSON.parse(now.output) as Estimate;
    const changes: string[] = [];
    const cmp = (label: string, x: number, y: number, fmt = usd) => {
      if (x !== y) changes.push(`${label}: ${fmt(x)} → ${fmt(y)}`);
    };
    if (a.inputs.stage !== b.inputs.stage)
      changes.push(`Stage: ${a.inputs.stage} → ${b.inputs.stage}`);
    if (a.inputs.months_used.join() !== b.inputs.months_used.join())
      changes.push(`Months used: ${a.inputs.months_used.length} → ${b.inputs.months_used.length}`);
    cmp("Revenue", a.inputs.revenue_cents, b.inputs.revenue_cents);
    cmp("Costs", a.inputs.costs_cents, b.inputs.costs_cents);
    cmp("Your own work per month", a.inputs.labor_month_cents, b.inputs.labor_month_cents);
    if (
      a.inputs.multiple_low !== b.inputs.multiple_low ||
      a.inputs.multiple_high !== b.inputs.multiple_high
    )
      changes.push(
        `Multiples: ${a.inputs.multiple_low}–${a.inputs.multiple_high}× → ${b.inputs.multiple_low}–${b.inputs.multiple_high}×`,
      );
    if (a.inputs.model !== b.inputs.model)
      changes.push(`Model: ${a.inputs.model} → ${b.inputs.model}`);
    const range = (e: Estimate) =>
      e.low_cents === null ? "no range" : `${usd(e.low_cents)}–${usd(e.high_cents ?? 0)}`;
    return {
      from: before.created_at,
      to: now.created_at,
      changes,
      range_before: range(a),
      range_after: range(b),
    };
  }

  history(businessId: string) {
    return (
      this.db
        .prepare(
          "SELECT created_at, output FROM value_snapshots WHERE business_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 20",
        )
        .all(businessId) as { created_at: string; output: string }[]
    ).map((r) => {
      const e = JSON.parse(r.output) as Estimate;
      return { at: r.created_at, low_cents: e.low_cents, high_cents: e.high_cents, label: e.label };
    });
  }

  /** A private what-if on top of today's inputs. */
  async scenario(founder: Person, businessId: string, o: Overrides) {
    this.store.business(founder, businessId);
    const base = await this.inputs(businessId);
    return { base: estimate(base), scenario: estimate(withOverrides(base, o)), overrides: o };
  }

  async saveScenario(founder: Person, businessId: string, name: string, o: Overrides) {
    const r = await this.scenario(founder, businessId, o);
    this.db
      .prepare(
        "INSERT INTO value_scenarios (id, business_id, name, overrides, result, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        randomUUID(),
        businessId,
        (name || "What if").slice(0, 80),
        JSON.stringify(o),
        JSON.stringify(r.scenario),
        new Date().toISOString(),
      );
    return this.scenarios(founder, businessId);
  }

  scenarios(founder: Person, businessId: string) {
    this.store.business(founder, businessId);
    return (
      this.db
        .prepare(
          "SELECT * FROM value_scenarios WHERE business_id = ? AND created_at >= COALESCE((SELECT MAX(at) FROM ownership WHERE business_id = ?), '') ORDER BY created_at DESC",
        )
        .all(businessId, businessId) as {
        id: string;
        name: string;
        overrides: string;
        result: string;
        created_at: string;
      }[]
    ).map((s) => {
      const e = JSON.parse(s.result) as Estimate;
      return {
        id: s.id,
        name: s.name,
        overrides: JSON.parse(s.overrides) as Overrides,
        low_cents: e.low_cents,
        high_cents: e.high_cents,
        created_at: s.created_at,
      };
    });
  }

  /** What a visitor sees when the founder chose to share numbers; nothing otherwise. */
  async publicNumbers(businessId: string) {
    if (!this.settings(businessId).share_numbers) return null;
    const { months } = await this.books.months(businessId, 12);
    // The latest whole month with revenue actually known and earned: never a month that
    // couldn't be read, and never a "loss" made of costs alone (job 003f).
    const last =
      [...months]
        .reverse()
        .find((m) => m.complete && m.revenue_cents !== null && m.revenue_cents > 0) ?? null;
    const e = await this.current(businessId, months, { snapshot: false });
    return {
      month: last && {
        label: last.label,
        revenue_cents: last.revenue_cents,
        direct_cents: last.direct_cents,
        overhead_cents: last.overhead_cents,
        profit_cents: last.profit_cents,
        revenue_sources: last.revenue_sources,
        cost_sources: last.cost_sources,
      },
      value: {
        low_cents: e.low_cents,
        high_cents: e.high_cents,
        label: e.label,
        stage: e.inputs.stage,
        missing: e.missing,
      },
    };
  }
}
