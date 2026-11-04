// Job 003u: pure rules for the buyer's Digital performance tab. A hidden count is always written
// as "Fewer than 3" and never drawn as a value; costs are exact (microcents as text, through
// BigInt); "not in this grant" and "nothing recorded" are different sentences.

import type { PerformanceEvidence, Shown } from "./api5.ts";
import { microcentsUsd } from "./operations.ts";

export const FEWER = "fewer_than_3";
export const isHidden = (v: Shown | string): v is "fewer_than_3" => v === FEWER;

export const shownText = (v: Shown) => (isHidden(v) ? "Fewer than 3" : String(v));

/** Exact dollars, or the hidden marker in words. */
export const costShown = (micro: string) =>
  isHidden(micro) ? "Hidden (fewer than 3 calls)" : microcentsUsd(micro);

/** For drawing only: a hidden count has no height (it is drawn as a marker instead). */
export const drawn = (v: Shown) => (isHidden(v) ? 0 : v);

type Month = PerformanceEvidence["months"][number];

export function describeMonth(m: Month): string {
  const name = `${m.label}${m.so_far ? " (so far)" : ""}`;
  const uses =
    m.requested === 0
      ? "no customer uses (recorded zero)"
      : `${shownText(m.requested)} customer uses`;
  const cust =
    m.customers.calls === 0
      ? "no runtime calls serving customers"
      : `serving customers ${costShown(m.customers.microcents)} over ${shownText(m.customers.calls)} calls`;
  const founder =
    m.founder.calls === 0
      ? "no founder trials or checks"
      : `founder trials and checks ${microcentsUsd(m.founder.microcents)} over ${m.founder.calls} calls${m.founder.unknown_cost_calls ? `, ${m.founder.unknown_cost_calls} with unknown cost` : ""}`;
  return `${name}: ${uses}; ${cust}; ${founder}`;
}

/** The tab's state: what the grant allows, then whether anything was recorded. */
export function performanceState(p: PerformanceEvidence | undefined): {
  kind: "not_granted" | "nothing_recorded" | "recorded";
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
  return { kind: "recorded", text: "" };
}
