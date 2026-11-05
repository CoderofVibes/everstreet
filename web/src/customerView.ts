// Job 001j: where a customer's use stands, step by step, in words (docs/design/CUSTOMER_WORKSPACE.md,
// "Composition and states"). Pure, from the workspace state the real API produced: nothing here
// makes a request, and nothing is called completed unless the request's own state shows it. A
// result is "completed" only as a complete extraction; anything else is never styled as success.

import type { UseView } from "./customerApi.ts";
import type { DoubtAction, WorkspaceState } from "./customerWorkspace.ts";

export type CustomerStepStatus = "completed" | "current" | "waiting" | "stopped" | "attention";
export interface CustomerStep {
  key: "document" | "authorize" | "run" | "result";
  title: string;
  status: CustomerStepStatus;
  detail: string;
}

export const CUSTOMER_STEP_WORD: Record<CustomerStepStatus, string> = {
  completed: "Completed",
  current: "Current",
  waiting: "Waiting",
  stopped: "Stopped",
  attention: "Needs checking",
};

type View = Pick<WorkspaceState, "use" | "result" | "check" | "unanswered" | "draft" | "inDoubt">;

const ENDED: UseView["state"][] = ["refused", "unresolved", "cancelled", "expired"];
const is = (status: CustomerStepStatus, detail: string) => ({ status, detail });

/**
 * Astra 02:43: a use that never ran and now never can (its unit is returned or being returned, or
 * the request ended): no step or panel may invite running it or promise a result.
 */
export function wontRun(u: UseView | null | undefined): "returned" | "returning" | "ended" | null {
  if (!u || u.execution) return null;
  if (ENDED.includes(u.state)) return "ended";
  if (u.units.unit === "returned") return "returned";
  if (u.units.unit === "release_pending") return "returning";
  return null;
}

/** The words for a use that won't run, for its result step and its result panel. */
export const WONT_RUN_RESULT: Record<"returned" | "returning" | "ended", string> = {
  returned: "No result: this use didn't run, and its unit was returned. Nothing was charged.",
  returning: "No result: this use won't run. Its unit is being returned; you aren't charged.",
  ended: "No result: this request ended before it ran.",
};

/** Whether the shown result is a complete extraction (every required field found). */
export const completeResult = (s: Pick<WorkspaceState, "result">) =>
  s.result?.result.outcome === "extracted";

function documentStep(s: View) {
  const u = s.use;
  if (u)
    return is(
      "completed",
      `${u.input.chars.toLocaleString()} characters, checked by your browser.`,
    );
  if (s.unanswered)
    return is(
      "current",
      "Your last request wasn't answered. Recover it first; it is never made twice.",
    );
  return s.draft.trim()
    ? is("current", `${s.draft.length.toLocaleString()} characters ready to review.`)
    : is("current", "Paste the document you want turned into data.");
}

function authorizeStep(s: View) {
  const u = s.use;
  if (!u) return is("waiting", "Nothing is reserved or charged by reviewing.");
  if (u.state === "prepared")
    return s.check && !s.check.ok
      ? is("stopped", s.check.problem ?? "This request couldn't be checked.")
      : is("current", "Check the terms, then authorize exactly this one use.");
  if (u.state === "reserve_requested" || u.state === "reserve_unknown")
    return is("current", "Sent. Waiting for the contract to show one unit held.");
  // Astra's CustomerStepReview: "reserved" persists after a charge or return, so this states the
  // confirmed reservation as history; the unit's present state is the unit card's evidence.
  if (u.state === "reserved")
    return is(
      "completed",
      "Authorized: the contract confirmed one unit reserved for this use. Its state now is under Your unit.",
    );
  return is("stopped", u.explanation);
}

function runStep(s: View) {
  const u = s.use;
  const x = u?.execution ?? null;
  if (u?.state !== "reserved")
    return is("waiting", u && ENDED.includes(u.state) ? "Not run." : "After the unit is held.");
  if (!x)
    return u.units.unit === "release_pending"
      ? is(
          "stopped",
          "Not run: you asked for your unit back. Waiting for the contract to confirm the return.",
        )
      : u.units.unit === "returned"
        ? is("stopped", "Not run: the contract confirmed your unit returned.")
        : is("current", "One run of the released product on this document.");
  if (x.state === "running")
    return is("current", "Running. Checking progress never runs it again.");
  if (x.state === "completed") return is("completed", "The run finished.");
  if (x.state === "unknown")
    return is(
      "stopped",
      "It can't be told whether this run finished. It is never run again automatically.",
    );
  return is(
    "stopped",
    x.state === "cancelled" ? "Cancelled." : "This run didn't produce a usable result.",
  );
}

function resultStep(s: View) {
  const x = s.use?.execution ?? null;
  if (s.result)
    return completeResult(s)
      ? is("completed", "Every required field was found. Compare it with your document.")
      : is("attention", "Not a complete extraction. Read what's missing before you use it.");
  const ended = wontRun(s.use);
  if (ended) return is("stopped", WONT_RUN_RESULT[ended]);
  if (!x || x.state === "running") return is("waiting", "Appears here after the run.");
  if (x.result === "available") return is("current", "Ready. Only you can read it.");
  if (x.result === "pending") return is("current", "Being saved privately.");
  if (x.result === "expired") return is("stopped", "Removed after its retention time.");
  return is("stopped", "No usable result. A use without one isn't charged.");
}

// 001j1: which step a lost answer leaves in doubt.
const DOUBT_STEP: Record<DoubtAction, CustomerStep["key"]> = {
  authorize: "authorize",
  cancel: "authorize",
  run: "run",
  release: "run",
  check_unit: "result",
};
const DOUBT_DETAIL: Record<DoubtAction, string> = {
  authorize: "Sent, but no answer came back: it may have been received. Check this request.",
  cancel: "Your cancel was sent, but no answer came back. Check this request.",
  run: "Sent, but no answer came back: it may have run. Check this request; it is never run again automatically.",
  release: "Your return was sent, but no answer came back. Check this request.",
  check_unit: "Settling was sent, but no answer came back. Check this request.",
};

export function customerSteps(s: View): CustomerStep[] {
  const steps = baseSteps(s);
  // 001j1: after a lost answer the request shown is stale: its step needs checking, and nothing
  // after it is claimed until a fresh read of the same request answers.
  const d = s.inDoubt;
  if (!d || d.useId !== s.use?.id) return steps;
  const at = steps.findIndex((st) => st.key === DOUBT_STEP[d.action]);
  return steps.map((st, i) =>
    i < at
      ? st
      : i === at
        ? { ...st, status: "attention", detail: DOUBT_DETAIL[d.action] }
        : { ...st, status: "waiting", detail: "After this request is checked." },
  );
}

function baseSteps(s: View): CustomerStep[] {
  return [
    { key: "document", title: "Your document", ...documentStep(s) },
    { key: "authorize", title: "Review and authorize one use", ...authorizeStep(s) },
    { key: "run", title: "Run it on your document", ...runStep(s) },
    { key: "result", title: "Your result", ...resultStep(s) },
  ];
}

/** The step the page is about now: the first not yet completed, else the last. */
export function activeCustomerStep(s: View): CustomerStep["key"] {
  const steps = customerSteps(s);
  return steps.find((st) => st.status !== "completed")?.key ?? "result";
}
