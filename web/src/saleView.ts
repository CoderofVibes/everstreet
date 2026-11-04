// Job 001i: the sale and handover workspace's rules (docs/design/ACQUISITION_WORKSPACE.md,
// "Composition and states"). Where the sale stands, step by step, in words; the one next action;
// and the continuity facts, all from the controller's state and the contract evidence. Nothing is
// ever called completed unless the evidence shows it: recording is not signing, and a close is
// known here only from an applied intent (a reading of the contract's outcome).

import type { OwnerHandoverState } from "./handover.ts";
import { reviewProblem } from "./handover.ts";
import type { ObservedDeal, SaleEvidence } from "./handoverApi.ts";

export type StepStatus = "completed" | "current" | "waiting" | "blocked";
export interface SaleStep {
  key: "read" | "record" | "close" | "apply" | "takeover";
  title: string;
  status: StepStatus;
  detail: string;
}

export const STEP_WORD: Record<StepStatus, string> = {
  completed: "Completed",
  current: "Current",
  waiting: "Waiting",
  blocked: "Blocked",
};

type View = Pick<OwnerHandoverState, "evidence" | "intents">;

const shownDeal = (ev: SaleEvidence | null): ObservedDeal | null => ev?.observed?.deal ?? null;

/** Whether the deal shown now has an intent recorded for exactly this version. */
export function recordedShown(v: View): boolean {
  const d = shownDeal(v.evidence);
  return d
    ? v.intents.some(
        (i) => i.deal.seq === d.seq && i.deal.version === d.version && i.deal.digest === d.digest,
      )
    : false;
}

export function saleSteps(v: View): SaleStep[] {
  const ev = v.evidence;
  const deal = shownDeal(ev);
  const applied = v.intents.find((i) => i.status === "applied");
  const recorded = v.intents.find((i) => i.status === "recorded");
  const unusable = ev?.state === "paused" || ev?.state === "unbound";
  const problem = reviewProblem(ev);
  const read: SaleStep = {
    key: "read",
    title: "Read the sale terms from the contract",
    status: unusable ? "blocked" : deal || applied || recorded ? "completed" : "current",
    detail: unusable
      ? (ev?.message ?? "The contract can't be read for this business here.")
      : deal
        ? `Deal ${deal.seq}, version ${deal.version}, read at block ${ev?.observed?.block.height}.`
        : ev?.observed
          ? "The last reading shows no sale in progress."
          : "Nothing has been read from the contract yet.",
  };
  // A recorded intent covers the shown deal only if it is exactly that version; a revised
  // version needs its own review (the older record never stands in for it).
  const done = applied ?? (recordedShown(v) ? recorded : deal ? undefined : recorded);
  const record: SaleStep = {
    key: "record",
    title: "Review and record the exact version",
    status: done ? "completed" : deal && problem ? "blocked" : deal ? "current" : "waiting",
    detail: done
      ? `Version ${done.deal.version} of deal ${done.deal.seq} is recorded here. Recording doesn't sign or send anything.`
      : deal && problem
        ? problem
        : deal
          ? "Not recorded yet. Review the terms, then record exactly this version."
          : "Waiting for a sale on the contract.",
  };
  const close: SaleStep = {
    key: "close",
    title: "The contract closes the sale",
    status: applied ? "completed" : recorded ? "current" : "waiting",
    detail: applied
      ? "A reading of the contract showed this exact sale closed."
      : recorded
        ? "Not known yet. Only a reading of the contract's outcome shows whether it closed."
        : "Happens on the contract, after both sides accept.",
  };
  const apply: SaleStep = {
    key: "apply",
    title: "Apply the close here",
    status: applied ? "completed" : recorded ? "current" : "waiting",
    detail: applied
      ? "Applied here once."
      : recorded
        ? "When the contract shows it closed, check its outcome to apply it here."
        : "After a recorded version closes on the contract.",
  };
  const takeover: SaleStep = {
    key: "takeover",
    title: "The buyer takes over",
    status: applied ? "current" : "waiting",
    detail: applied
      ? "The buyer manages the business here; customers keep their access."
      : "After the close is applied here.",
  };
  return [read, record, close, apply, takeover];
}

export type SaleAction =
  | "check_access"
  | "recover"
  | "retry"
  | "selling"
  | "reconcile"
  | "record"
  | "review"
  | "refresh"
  | "none";

/** The one next action, from the state; each maps to an existing controller method or link. */
export function saleNext(
  s: Pick<
    OwnerHandoverState,
    "status" | "access" | "evidence" | "intents" | "reviewing" | "unanswered"
  >,
): { action: SaleAction; label: string; intent?: string } {
  if (s.access === "unconfirmed") return { action: "check_access", label: "Check access" };
  if (s.unanswered) return { action: "recover", label: "Recover my original request" };
  if (s.status === "error" || !s.evidence) return { action: "retry", label: "Try again" };
  if (s.evidence.state === "unbound") return { action: "selling", label: "Go to Selling" };
  if (s.evidence.state === "paused") return { action: "none", label: "" };
  const recorded = s.intents.find((i) => i.status === "recorded");
  if (s.reviewing) return { action: "record", label: "Record this exact version" };
  // A revised version on the contract is reviewed before an older record's outcome is checked.
  if (shownDeal(s.evidence) && !reviewProblem(s.evidence) && !recordedShown(s))
    return { action: "review", label: "Review this version" };
  if (recorded)
    return { action: "reconcile", label: "Check the contract's outcome…", intent: recorded.id };
  return { action: "refresh", label: "Read the contract again" };
}

/** One sentence: where the sale stands, as read. */
export function saleSentence(v: View): string {
  const ev = v.evidence;
  const applied = v.intents.find((i) => i.status === "applied");
  if (applied) return `Deal ${applied.deal.seq} was applied here: the buyer manages the business.`;
  if (!ev || ev.state === "unbound") return "This business has no v3 contract here.";
  if (ev.state === "paused") return ev.message ?? "Reading the contract is paused here.";
  const o = ev.observed;
  if (!o) return "Nothing has been read from the contract yet.";
  const d = o.deal;
  const recorded = v.intents.find((i) => i.status === "recorded");
  if (!d)
    return recorded
      ? `Version ${recorded.deal.version} of deal ${recorded.deal.seq} is recorded here; the last reading shows no live sale, so check the contract's outcome.`
      : `No sale is in progress at block ${o.block.height}.`;
  const who = [d.seller_accepted && "the seller", d.buyer_accepted && "the buyer"].filter(Boolean);
  const accepted = who.length ? `${who.join(" and ")} accepted` : "nobody has accepted yet";
  const rec = recordedShown(v) ? " This version is recorded here." : " Not recorded here yet.";
  return `Deal ${d.seq}, version ${d.version} is ${d.state} on the contract; ${accepted}. Read at block ${o.block.height}.${rec}`;
}
