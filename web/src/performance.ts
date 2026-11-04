// Job 003u/003u1: pure rules for the buyer's Digital performance tab. A withheld figure is written
// as "Withheld" with no size claimed and is never drawn as a value; costs are exact (microcents as
// text, through BigInt); "not in this grant" and "nothing recorded" are different sentences.

import type { PerformanceEvidence, Shown } from "./api5.ts";
import { microcentsUsd } from "./operations.ts";

export const WITHHELD = "withheld";
export const isWithheld = (v: Shown | string): v is "withheld" => v === WITHHELD;

export const shownText = (v: Shown) => (isWithheld(v) ? "Withheld" : String(v));

/** Exact dollars, or "Withheld". */
export const costShown = (micro: string) => (isWithheld(micro) ? "Withheld" : microcentsUsd(micro));

type Month = PerformanceEvidence["months"][number];

export function describeMonth(m: Month): string {
  const name = `${m.label}${m.so_far ? " (so far)" : ""}`;
  const uses = isWithheld(m.requested)
    ? "customer uses withheld"
    : m.requested === 0
      ? "no customer uses (recorded zero)"
      : `${m.requested} customer uses`;
  const cust = isWithheld(m.customers.calls)
    ? "runtime calls and cost serving customers withheld"
    : m.customers.calls === 0
      ? "no runtime calls serving customers"
      : `serving customers ${costShown(m.customers.microcents)} over ${m.customers.calls} calls`;
  const founder =
    m.founder.calls === 0
      ? "no founder trials or checks"
      : `founder trials and checks ${microcentsUsd(m.founder.microcents)} over ${m.founder.calls} calls${m.founder.unknown_cost_calls ? `, ${m.founder.unknown_cost_calls} with unknown cost` : ""}`;
  return `${name}: ${uses}; ${cust}; ${founder}`;
}

/** The tab's state: what the grant allows, then whether anything was recorded or withheld. */
export function performanceState(p: PerformanceEvidence | undefined): {
  kind: "not_granted" | "nothing_recorded" | "withheld" | "recorded";
  text: string;
} {
  if (!p)
    return {
      kind: "not_granted",
      text: "Digital performance isn't in this grant. Your team can ask for it in a new request; the seller decides.",
    };
  if (p.state === "not_started")
    return {
      kind: "nothing_recorded",
      text: "No customer uses are recorded for this business in this window. That is a recorded zero, not missing data.",
    };
  if (p.withheld)
    return {
      kind: "withheld",
      text: "Some group of customer uses here is small, so the breakdowns and customer costs are withheld. Only the total that can't single anyone out is shown; the founder's own trials and checks are shown in full.",
    };
  return { kind: "recorded", text: "" };
}
