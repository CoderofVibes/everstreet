// Job 004a1: an import workspace's private, unsaved state, kept apart from what the server has
// saved, with rules for the order requests finish in. Pure, so the rules are tested without a
// browser. Nothing here is written to browser storage: drafts live only in the open page, and
// are dropped when the person, the workspace or control of the business changes.

import type { Category, ImportView, Manifest, ProductKind, Report } from "./importsApi.ts";

// ---------- which server answer is newest ----------

/**
 * Every write the server accepts raises one of these counters, and each answer describes the
 * state right after its own write. So for one business owner, two answers can be ordered by
 * comparing them counter by counter; an answer that finishes late can't replace a newer one.
 */
export function freshness(v: ImportView): number[] {
  return [
    v.workspace.version,
    ...v.inventory.map((i) => i.version),
    v.source.history.length,
    v.report.history.length,
  ];
}

export type Order = "newer" | "same" | "older" | "incomparable";

/** How `incoming` relates to `current`. */
export function order(current: ImportView, incoming: ImportView): Order {
  const a = freshness(current);
  const b = freshness(incoming);
  if (a.length !== b.length) return "incomparable";
  let up = false;
  let down = false;
  for (const [i, x] of a.entries()) {
    const y = b[i] as number;
    if (y > x) up = true;
    if (y < x) down = true;
  }
  if (up && down) return "incomparable";
  return up ? "newer" : down ? "older" : "same";
}

export type Reconcile =
  /** Show it. */
  | "accept"
  /** An older answer finished late: its write is already in what is shown. */
  | "ignore"
  /** Control of the business changed: show it and drop every private draft. */
  | "reset"
  /** Neither contains the other: fetch the server's current state. */
  | "reload";

export function reconcile(current: ImportView | null, incoming: ImportView): Reconcile {
  if (!current) return "accept";
  if (current.workspace.id !== incoming.workspace.id) return "reset";
  if (current.workspace.owner_epoch !== incoming.workspace.owner_epoch) return "reset";
  const o = order(current, incoming);
  return o === "newer" || o === "same" ? "accept" : o === "older" ? "ignore" : "reload";
}

// ---------- the manifest being prepared ----------

export interface ManifestDraft {
  /** Raised by every selection, paste or clear; a file read applies only to its own revision. */
  rev: number;
  value: Manifest | null;
  /** A chosen file is still being read. */
  reading: boolean;
  error: string | null;
}

export const emptyManifest = (): ManifestDraft => ({
  rev: 0,
  value: null,
  reading: false,
  error: null,
});

/** A file was chosen: its contents arrive later, for this revision only. */
export const fileChosen = (d: ManifestDraft): ManifestDraft => ({
  rev: d.rev + 1,
  value: null,
  reading: true,
  error: null,
});

/** A file read finished. Ignored if anything was chosen, pasted or cleared since. */
export function fileRead(
  d: ManifestDraft,
  rev: number,
  result: { manifest: Manifest } | { error: string },
): ManifestDraft {
  if (rev !== d.rev) return d;
  return "error" in result
    ? { ...d, reading: false, value: null, error: result.error }
    : { ...d, reading: false, value: result.manifest, error: null };
}

export const pasted = (d: ManifestDraft, text: string, tooLarge: boolean): ManifestDraft => ({
  rev: d.rev + 1,
  reading: false,
  value: text.trim() ? { file_name: null, content: text } : null,
  error: tooLarge ? "That text is larger than 64 KiB." : null,
});

export const cleared = (d: ManifestDraft): ManifestDraft => ({
  ...emptyManifest(),
  rev: d.rev + 1,
});

// ---------- an inspection request ----------

export interface InspectAttempt {
  /** Fixed for this request: a retry sends the same key and the same file. */
  key: string;
  manifest: Manifest;
  /** The draft revision it was sent from; finishing clears the draft only if it is unchanged. */
  draftRev: number;
  state: "sending" | "unknown" | "refused";
  message: string | null;
}

/**
 * Starts an inspection of the current draft, or recovers an unanswered one. Null while one is
 * being sent, while a file is still being read, or with nothing to send. If an earlier request
 * for this same file got no answer, its key is reused, so the server answers it from its record
 * and nothing is inspected twice.
 */
export function startInspect(
  d: ManifestDraft,
  prior: InspectAttempt | null,
  mint: () => string,
): InspectAttempt | null {
  if (prior?.state === "sending") return null;
  if (d.reading || d.error || !d.value) return null;
  const same =
    prior &&
    prior.state === "unknown" &&
    prior.manifest.content === d.value.content &&
    prior.manifest.file_name === d.value.file_name;
  return {
    key: same ? prior.key : mint(),
    manifest: d.value,
    draftRev: d.rev,
    state: "sending",
    message: null,
  };
}

/** Re-sends an unanswered request exactly as it was, whatever the draft now holds. */
export function recoverInspect(prior: InspectAttempt | null): InspectAttempt | null {
  return prior?.state === "unknown" ? { ...prior, state: "sending", message: null } : null;
}

export type Outcome = { ok: true } | { ok: false; status: number; message: string };

/** A 4xx is a refusal (nothing was saved); anything else without an answer is unknown. */
export function inspectFinished(
  d: ManifestDraft,
  a: InspectAttempt,
  outcome: Outcome,
): { draft: ManifestDraft; attempt: InspectAttempt | null } {
  if (outcome.ok) return { draft: d.rev === a.draftRev ? cleared(d) : d, attempt: null };
  if (outcome.status >= 400 && outcome.status < 500)
    return { draft: d, attempt: { ...a, state: "refused", message: outcome.message } };
  return {
    draft: d,
    attempt: {
      ...a,
      state: "unknown",
      message:
        "No answer arrived, so it may or may not have been inspected. Checking again sends the same request, which is never inspected twice.",
    },
  };
}

// ---------- product details ----------

export interface Details {
  name: string;
  description: string;
  product_kind: ProductKind;
}

export interface DetailsDraft extends Details {
  /** The saved version these edits started from; a stale base is refused, not overwritten. */
  base: number;
}

export const savedDetails = (v: ImportView): Details => ({
  name: v.workspace.name,
  description: v.workspace.description,
  product_kind: v.workspace.product_kind,
});

/** Whether a draft says what is saved (the server trims what it stores, so compare trimmed). */
export const sameDetails = (saved: Details, d: Details) =>
  saved.name === d.name.trim() &&
  saved.description === d.description.trim() &&
  saved.product_kind === d.product_kind;

/** The details being edited: the draft if there is one, otherwise what is saved. */
export const detailsShown = (v: ImportView, d: DetailsDraft | null): DetailsDraft =>
  d ?? { ...savedDetails(v), base: v.workspace.version };

/** After an edit: no draft when it equals what is saved and starts from the current version. */
export function editDetails(v: ImportView, d: DetailsDraft): DetailsDraft | null {
  return sameDetails(savedDetails(v), d) && d.base === v.workspace.version ? null : d;
}

/**
 * After a save attempt and the server's current view. The draft survives unless the server now
 * holds exactly it, which also covers a save whose answer was lost and whose retry was refused
 * as stale: the text was saved, so nothing is lost and nothing is reported as a conflict.
 */
export function detailsAfter(v: ImportView, d: DetailsDraft): DetailsDraft | null {
  return sameDetails(savedDetails(v), d) ? null : d;
}

/**
 * After this page's own save succeeded with `submitted`: whatever was typed meanwhile is kept,
 * rebased onto the version that save produced (it was built on it), so saving it next isn't
 * refused as stale. Edits started from some other base keep theirs.
 */
export function detailsAfterOwnSave(
  v: ImportView,
  submitted: DetailsDraft,
  current: DetailsDraft | null,
): DetailsDraft | null {
  if (!current) return null;
  const rebased =
    current.base === submitted.base ? { ...current, base: v.workspace.version } : current;
  return detailsAfter(v, rebased);
}

// ---------- dependency statements ----------

export type Uses = "yes" | "no" | "unsaid";

export interface DepDraft {
  uses: Uses;
  note: string;
  /** The saved version of this item these edits started from. */
  base: number;
}

export function savedDep(
  v: ImportView,
  c: Category,
): { uses: Uses; note: string; version: number } {
  const e = v.inventory.find((i) => i.category === c);
  const a = e?.assertion ?? null;
  return {
    uses: a ? (a.uses ? "yes" : "no") : "unsaid",
    note: a?.note ?? "",
    version: e?.version ?? 0,
  };
}

export function depShown(v: ImportView, c: Category, d: DepDraft | undefined): DepDraft {
  if (d) return d;
  const s = savedDep(v, c);
  return { uses: s.uses, note: s.note, base: s.version };
}

const sameDep = (s: { uses: Uses; note: string }, d: { uses: Uses; note: string }) =>
  s.uses === d.uses && (d.uses === "unsaid" || s.note === d.note.trim());

/** Keeps a draft only while it differs from what is saved (or started from an older version). */
export function editDep(v: ImportView, c: Category, d: DepDraft): DepDraft | null {
  const s = savedDep(v, c);
  return sameDep(s, d) && d.base === s.version ? null : d;
}

/** After a save attempt: the draft goes once the server holds exactly it. */
export function depAfter(v: ImportView, c: Category, d: DepDraft): DepDraft | null {
  return sameDep(savedDep(v, c), d) ? null : d;
}

/** After this row's own save succeeded: typed-ahead edits are kept, rebased onto that save. */
export function depAfterOwnSave(
  v: ImportView,
  c: Category,
  submitted: DepDraft,
  current: DepDraft | null,
): DepDraft | null {
  if (!current) return null;
  const rebased =
    current.base === submitted.base ? { ...current, base: savedDep(v, c).version } : current;
  return depAfter(v, c, rebased);
}

/** What one row's last request did, shown beside the row. Independent of which view is shown. */
export type RowStatus =
  | { state: "saving" }
  | { state: "saved" }
  | { state: "conflict"; message: string }
  | { state: "refused"; message: string }
  | { state: "unknown"; message: string };

export function rowStatus(outcome: Outcome, savedNow: boolean): RowStatus {
  if (outcome.ok || savedNow) return { state: "saved" };
  if (outcome.status === 409) return { state: "conflict", message: outcome.message };
  if (outcome.status >= 400 && outcome.status < 500)
    return { state: "refused", message: outcome.message };
  return {
    state: "unknown",
    message: "No answer arrived. Your text is still here; saving again is safe.",
  };
}

// ---------- which report is shown ----------

export type Snapshot =
  | { selected: null }
  | { selected: number; state: "loading" }
  | { selected: number; state: "loaded"; created_at: string; report: Report }
  | { selected: number; state: "error"; message: string };

export const live = (): Snapshot => ({ selected: null });

/** Selecting a saved report shows "loading" for it at once, never the previous report. */
export const select = (n: number | null): Snapshot =>
  n === null ? { selected: null } : { selected: n, state: "loading" };

/** A report finished loading: applied only if it is still the one selected. */
export function snapshotLoaded(
  s: Snapshot,
  n: number,
  result: { created_at: string; report: Report } | { error: string },
): Snapshot {
  if (s.selected !== n) return s;
  return "error" in result
    ? { selected: n, state: "error", message: result.error }
    : { selected: n, state: "loaded", created_at: result.created_at, report: result.report };
}
