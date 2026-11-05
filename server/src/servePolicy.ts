// Job 003wf4 (docs/design/OWNER_PLAN_SETUP.md §5, Astra D1/D2): whether THIS server can serve a
// plan's holds, and the operational cutoffs for one hold. One policy, used by guided plan creation,
// plan inspection, offer creation, customer prepare, submission and readiness, evaluated at each
// read against the current configuration.
//
// Two kinds of deadline are never merged. The contract's expiry (accept_by = serve_until −
// MIN_SERVE_MS) is when a signed hold can still OPEN on the contract: it proves impossibility and
// is never shortened here. The operational cutoffs below are when this server can still RUN it.

import { MIN_SERVE_MS } from "./customerSigning.ts";

/** The server's existing "a minute to sign" rule. */
export const MIN_SIGN_MS = 60_000;

export interface ServeTiming {
  serveWindowMs: number;
  submitMarginMs: number;
  executionMarginMs: number;
  deliveryTimeoutMs: number;
  maxBlockAgeMs: number;
  maxFutureSkewMs: number;
  /** The runtime's execution time limit. */
  timeoutMs: number;
}

/** Serve time that must remain when execution starts (execution's own timeLeft check). */
export const reserveMs = (t: ServeTiming) =>
  Math.max(Number(MIN_SERVE_MS), t.timeoutMs + t.executionMarginMs);

/**
 * One hold's operational cutoffs, absolute, counted back from its signed serve_until (chain time):
 * execute_by (execution can still pass timeLeft), submit_by (the last moment a submission may
 * start), sign_by (local time, less the accepted future skew so a lagging local clock can't push a
 * signature past submit_by).
 */
export function cutoffs(t: ServeTiming, serveUntilMs: bigint) {
  const executeBy = serveUntilMs - BigInt(reserveMs(t));
  const submitBy = executeBy - BigInt(t.submitMarginMs);
  const signBy = submitBy - BigInt(t.maxFutureSkewMs);
  return { executeBy, submitBy, signBy };
}

/** The settlement grace a plan needs so a result delivered at the latest moment can be settled. */
export const minGraceMs = (t: ServeTiming) =>
  Math.max(0, t.timeoutMs + t.deliveryTimeoutMs + t.submitMarginMs - reserveMs(t));

/** The shortest hold usable even from the oldest block `fresh` accepts. */
export const minUsableHoldMs = (t: ServeTiming) =>
  t.maxBlockAgeMs + reserveMs(t) + t.submitMarginMs + t.maxFutureSkewMs + MIN_SIGN_MS;

export interface PlanTiming {
  hold_ttl_ms: string | number;
  settle_grace_ms: string | number;
}

/** Whether a plan's holds are usable by this server, from the worst accepted block (§5). */
export function planUsability(t: ServeTiming, plan: PlanTiming) {
  const hold = Number(plan.hold_ttl_ms);
  const window = Math.min(t.serveWindowMs, hold);
  const signWithin = window - t.maxBlockAgeMs - reserveMs(t) - t.submitMarginMs - t.maxFutureSkewMs;
  const usable = signWithin >= MIN_SIGN_MS;
  const graceOk = Number(plan.settle_grace_ms) >= minGraceMs(t);
  return {
    usable,
    /** At least this much hold is needed here (ms). */
    min_hold_ms: minUsableHoldMs(t),
    /** The settlement grace a result delivered at the latest moment needs (ms). */
    min_grace_ms: minGraceMs(t),
    grace_ok: graceOk,
    reason: usable
      ? null
      : `Customers need at least ${Math.ceil(minUsableHoldMs(t) / 1000)} s of hold here to sign and run (this plan's hold is ${Math.floor(hold / 1000)} s, and this server serves at most ${Math.floor(t.serveWindowMs / 1000)} s of it). Create a new plan with a longer hold.`,
  };
}
