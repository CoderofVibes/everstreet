// Job 001i: the sale and handover workspace's rules (docs/design/ACQUISITION_WORKSPACE.md,
// "Composition and states"). Where the sale stands, step by step, in words; the one next action;
// and the continuity facts, all from the controller's state and the contract evidence. Nothing is
// ever called completed unless the evidence shows it: recording is not signing, and a close is
// known here only from an applied intent (a reading of the contract's outcome).
//
// Job 001i1: the intent list is the business's whole history (newest first), so the current sale
// is resolved once, by exact identity, and the sentence, steps and action all read that one
// resolution. A historical record never completes a newer sale, and order never decides a match.

import type { OwnerHandoverState } from "./handover.ts";
import { reviewProblem } from "./handover.ts";
import type { Intent, IntentStatus, ObservedDeal } from "./handoverApi.ts";

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

/**
 * The sale this page is about, resolved once:
 * - `unavailable`: the contract can't be read here (paused or unbound). Nothing after the
 *   reading is known; a pending record is mentioned, never completed.
 * - `unread`: nothing has been read yet.
 * - `live`: the contract shows a deal; `record` is the intent for exactly that sequence, version
 *   and digest, if any (any status), wherever it is in the list.
 * - `pending`: no live deal is shown and a recorded intent awaits its outcome (the deal closed or
 *   ended on the contract); its outcome check is the current step.
 * - `none`: no live deal and nothing pending. Applied, ended and superseded records are history.
 */
export type SaleCurrent =
  | { kind: "unavailable"; message: string; pending: Intent | null }
  | { kind: "unread" }
  | { kind: "live"; deal: ObservedDeal; record: Intent | null }
  | { kind: "pending"; record: Intent }
  | { kind: "none" };

const exact = (i: Intent, d: ObservedDeal) =>
  i.deal.seq === d.seq && i.deal.version === d.version && i.deal.digest === d.digest;

// When several intents name the same exact deal (not expected), the most decisive status wins.
const RANK: Record<IntentStatus, number> = { applied: 3, recorded: 2, ended: 1, superseded: 0 };

const newer = (a: Intent, b: Intent) => {
  const sa = BigInt(a.deal.seq);
  const sb = BigInt(b.deal.seq);
  if (sa !== sb) return sa > sb;
  if (a.deal.version !== b.deal.version) return a.deal.version > b.deal.version;
  if (a.created_at !== b.created_at) return a.created_at > b.created_at;
  return a.id > b.id;
};

/** The pending record awaiting an outcome: the newest by deal and version, not by list order. */
function pendingOf(intents: Intent[]): Intent | null {
  let best: Intent | null = null;
  for (const i of intents) if (i.status === "recorded" && (!best || newer(i, best))) best = i;
  return best;
}

export function saleCurrent(v: View): SaleCurrent {
  const ev = v.evidence;
  if (!ev || ev.state === "unbound" || ev.state === "paused")
    return {
      kind: "unavailable",
      message:
        ev?.message ??
        (ev?.state === "paused"
          ? "Reading the contract is paused here."
          : "This business has no v3 contract here."),
      pending: pendingOf(v.intents),
    };
  const o = ev.observed;
  if (!o) return { kind: "unread" };
  const d = o.deal;
  if (d) {
    let record: Intent | null = null;
    for (const i of v.intents)
      if (exact(i, d) && (!record || RANK[i.status] > RANK[record.status])) record = i;
    return { kind: "live", deal: d, record };
  }
  const pending = pendingOf(v.intents);
  return pending ? { kind: "pending", record: pending } : { kind: "none" };
}

/** Whether the deal shown now has an intent recorded for exactly this version. */
export function recordedShown(v: View): boolean {
  const c = saleCurrent(v);
  return c.kind === "live" && c.record !== null;
}

const recordLine = (i: Intent) =>
  `Version ${i.deal.version} of deal ${i.deal.seq} is recorded here. Recording doesn't sign or send anything.`;

export function saleSteps(v: View): SaleStep[] {
  const ev = v.evidence;
  const cur = saleCurrent(v);
  const problem = reviewProblem(ev);
  // The record that stands for the current sale, if any: only ever an exact or pending one.
  const rec = cur.kind === "live" || cur.kind === "pending" ? cur.record : null;
  const applied = rec?.status === "applied";
  const awaiting = rec?.status === "recorded";
  const unknown = "Not known while the contract can't be read here.";

  const read: SaleStep = {
    key: "read",
    title: "Read the sale terms from the contract",
    status:
      cur.kind === "unavailable" ? "blocked" : cur.kind === "unread" ? "current" : "completed",
    detail:
      cur.kind === "unavailable"
        ? cur.message
        : cur.kind === "unread"
          ? "Nothing has been read from the contract yet."
          : cur.kind === "live"
            ? `Deal ${cur.deal.seq}, version ${cur.deal.version}, read at block ${ev?.observed?.block.height}.`
            : `The last reading (block ${ev?.observed?.block.height}) shows no sale in progress.`,
  };
  const record: SaleStep = {
    key: "record",
    title: "Review and record the exact version",
    status: rec ? "completed" : cur.kind === "live" ? (problem ? "blocked" : "current") : "waiting",
    detail: rec
      ? recordLine(rec)
      : cur.kind === "live"
        ? (problem ?? "Not recorded yet. Review the terms, then record exactly this version.")
        : cur.kind === "unavailable"
          ? unknown
          : "Waiting for a sale on the contract.",
  };
  const close: SaleStep = {
    key: "close",
    title: "The contract closes the sale",
    status: applied ? "completed" : awaiting ? "current" : "waiting",
    detail: applied
      ? "A reading of the contract showed this exact sale closed."
      : awaiting && cur.kind === "live" && !cur.deal.seller_accepted
        ? "Waiting for your acceptance."
        : awaiting && cur.kind === "live" && !cur.deal.buyer_accepted
          ? "Waiting for the buyer's acceptance."
          : awaiting
            ? "Not known yet. Only a reading of the contract's outcome shows whether it closed."
            : rec
              ? "This version didn't close: it ended or was replaced."
              : cur.kind === "unavailable"
                ? unknown
                : "Happens on the contract, after both sides accept.",
  };
  const apply: SaleStep = {
    key: "apply",
    title: "Apply the close here",
    status: applied ? "completed" : "waiting",
    detail: applied ? "Applied here once." : "After the contract closes it.",
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
  | "accept"
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
  if (s.reviewing) return { action: "record", label: "Record this exact version" };
  const cur = saleCurrent(s);
  const outcome = (i: Intent) => ({
    action: "reconcile" as const,
    label: "Check the contract's outcome…",
    intent: i.id,
  });
  if (cur.kind === "live") {
    // A shown version without its own record is reviewed first; an older record never stands in.
    if (!cur.record && !reviewProblem(s.evidence))
      return { action: "review", label: "Review this version" };
    // Review #43: the seller's own acceptance comes first, on the sale page.
    if (cur.record?.status === "recorded" && !cur.deal.seller_accepted)
      return { action: "accept", label: `Accept version ${cur.deal.version}` };
    if (cur.record?.status === "recorded") return outcome(cur.record);
  }
  if (cur.kind === "pending") return outcome(cur.record);
  return { action: "refresh", label: "Read the contract again" };
}

/** One sentence: where the current sale stands, as read. History is never presented as current. */
export function saleSentence(v: View): string {
  const ev = v.evidence;
  const cur = saleCurrent(v);
  if (cur.kind === "unavailable")
    return cur.pending
      ? `${cur.message} Version ${cur.pending.deal.version} of deal ${cur.pending.deal.seq} is recorded here; its outcome can't be checked until the contract can be read.`
      : cur.message;
  if (cur.kind === "unread") return "Nothing has been read from the contract yet.";
  const o = ev?.observed;
  const h = o?.block.height;
  const as = o?.flag ? " (flagged)" : o?.freshness === "stale" ? " (stale)" : "";
  if (cur.kind === "pending")
    return `Version ${cur.record.deal.version} of deal ${cur.record.deal.seq} is recorded here; the last reading${as} shows no live sale, so check the contract's outcome.`;
  if (cur.kind === "none") return `No sale is in progress at block ${h}${as}.`;
  const d = cur.deal;
  const who = [d.seller_accepted && "the seller", d.buyer_accepted && "the buyer"].filter(Boolean);
  const accepted = who.length ? `${who.join(" and ")} accepted` : "nobody has accepted yet";
  const rec = !cur.record
    ? " Not recorded here yet."
    : cur.record.status === "applied"
      ? " This version's close was applied here."
      : cur.record.status === "recorded"
        ? " This version is recorded here."
        : " This version's record ended without a sale.";
  return `Deal ${d.seq}, version ${d.version} is ${d.state} on the contract; ${accepted}. Read at block ${h}${as}.${rec}`;
}
