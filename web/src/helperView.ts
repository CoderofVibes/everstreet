// Job 005b: the Helping page's rules (docs/design/HELPER_READ_AUTHORITY.md). Private sections
// appear only for a capability confirmed now in the latest answer; an ended or denied answer, or a
// refused read, clears reply drafts; an unconfirmed or failed read hides private sections but keeps
// drafts for a retry in the same authorized context; an action with no answer is "outcome
// unknown" and the page re-reads rather than resending.

import type { HelperDesk } from "./api4.ts";
import type { LoadState } from "./latestLoad.ts";

export type HelperShown =
  | { kind: "loading" }
  | { kind: "failed"; error: string | null }
  | { kind: "refused"; error: string | null }
  | { kind: "ended" | "denied" | "unconfirmed"; desk: HelperDesk }
  | {
      kind: "active";
      desk: HelperDesk;
      inquiries: NonNullable<HelperDesk["inquiries"]> | null;
      orders: NonNullable<HelperDesk["orders"]> | null;
    };

/** The page's state update: a failed read drops older data, so a retry never re-shows it. */
export function helperPatch(
  prev: LoadState<HelperDesk>,
  p: Partial<LoadState<HelperDesk>>,
): LoadState<HelperDesk> {
  return { ...prev, ...p, ...(p.status === "failed" ? { data: null } : {}) };
}

/** What the page may show from the latest read. A failed re-read never shows older private data. */
export function helperShown(s: LoadState<HelperDesk>): HelperShown {
  if (s.status === "refused") return { kind: "refused", error: s.error };
  if (s.status === "failed") return { kind: "failed", error: s.error };
  const d = s.data;
  if (!d) return { kind: "loading" };
  if (s.status === "loading" && d.access !== "active") return { kind: "loading" };
  if (d.access !== "active") return { kind: d.access, desk: d };
  return {
    kind: "active",
    desk: d,
    inquiries: d.capabilities.support.state === "authorized" ? d.inquiries : null,
    orders: d.capabilities.fulfillment.state === "authorized" ? d.orders : null,
  };
}

/** Reply drafts survive a retry in the same authorized context, never an ended or denied one. */
export function keepDrafts(shown: HelperShown): boolean {
  return shown.kind !== "ended" && shown.kind !== "denied" && shown.kind !== "refused";
}

/** What an action's failure means for the page. */
export function actionOutcome(e: unknown): "refused" | "conflict" | "unknown" | "failed" {
  const status = (e as { status?: unknown } | null)?.status;
  if (typeof status !== "number") return "unknown"; // no answer: it may or may not have happened
  if (status === 401 || status === 403 || status === 404) return "refused";
  if (status === 409) return "conflict";
  return "failed";
}

/** The sentence for an action's outcome; the page then re-reads what is recorded. */
export function actionMessage(kind: ReturnType<typeof actionOutcome>, error: string): string {
  switch (kind) {
    case "unknown":
      return "No answer came back, so it's not known whether that went through. Checking what is recorded, without sending it again.";
    case "refused":
      return `Not done: ${error}`;
    case "conflict":
      return `Not done: ${error} What is recorded now is shown.`;
    default:
      return `Not done: ${error}`;
  }
}
