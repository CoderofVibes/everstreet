// Job 001j: where a customer's use stands, step by step, in words (docs/design/CUSTOMER_WORKSPACE.md,
// "Composition and states"). Pure, from the workspace state the real API produced: nothing here
// makes a request, and nothing is called completed unless the request's own state shows it. A
// result is "completed" only as a complete extraction; anything else is never styled as success.

import type { UseView } from "./customerApi.ts";
import type { WorkspaceState } from "./customerWorkspace.ts";

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

type View = Pick<WorkspaceState, "use" | "result" | "check" | "unanswered" | "draft">;

const ENDED: UseView["state"][] = ["refused", "unresolved", "cancelled", "expired"];
const is = (status: CustomerStepStatus, detail: string) => ({ status, detail });

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
  if (!x || x.state === "running") return is("waiting", "Appears here after the run.");
  if (x.result === "available") return is("current", "Ready. Only you can read it.");
  if (x.result === "pending") return is("current", "Being saved privately.");
  if (x.result === "expired") return is("stopped", "Removed after its retention time.");
  return is("stopped", "No usable result. A use without one isn't charged.");
}

export function customerSteps(s: View): CustomerStep[] {
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
