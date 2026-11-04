// Job 001k: the executable Studio canvas's interaction rules, pure and testable. Three different
// versions can matter at once and are never confused:
// - SELECTED: the one the founder is looking at (the stage, its checks, compare). Local only:
//   choosing it changes nothing on the server, never makes it current and never marks a check.
// - CURRENT: the server's current version (changed only by "Make this the current version").
// - PREVIEWED: the version running in the sandboxed frame, if any. A frame always belongs to the
//   selected version: selecting another one stops it, and a late preview answer for a version no
//   longer selected is dropped (no frame opens for something the founder isn't looking at).
// The ordinary-preview gate stays on the server: a refusal (not_checked) only offers the
// explicit, warned unchecked choice for that same version; nothing opens unchecked by itself.

import type { AppVersion } from "./appApi.ts";

export interface AppCanvas {
  versions: AppVersion[];
  selected: string | null;
  /** Follow the current version as versions change (until the founder picks another one). */
  follow: boolean;
  preview: { job: string; url: string; checked: boolean } | null;
  /** The selected version whose ordinary preview was refused: the explicit choice is offered. */
  offerUnchecked: string | null;
  /** Comparing the selected version with the current one; `returnTo` gets focus on close. */
  compare: { from: string; to: string; returnTo: string } | null;
  history: boolean;
  note: string | null;
  /** A finished generation's version, shown as soon as it appears (it may not be current). */
  pendingSelect: string | null;
}

export const initialCanvas: AppCanvas = {
  versions: [],
  selected: null,
  follow: true,
  preview: null,
  offerUnchecked: null,
  compare: null,
  history: false,
  note: null,
  pendingSelect: null,
};

export type CanvasEvent =
  | { type: "versions"; versions: AppVersion[] }
  | { type: "select"; job: string }
  | { type: "previewOpened"; job: string; url: string; checked: boolean }
  | { type: "previewRefused"; job: string }
  | { type: "declineUnchecked" }
  | { type: "stop"; why: string | null }
  | { type: "openCompare"; returnTo: string }
  | { type: "closeCompare" }
  | { type: "toggleHistory" }
  | { type: "note"; note: string | null }
  | { type: "generated"; job: string }
  | { type: "gone" };

const byJob = (vs: AppVersion[], job: string | null) =>
  job === null ? null : (vs.find((v) => v.job_id === job) ?? null);
export const currentOf = (vs: AppVersion[]) => vs.find((v) => v.current) ?? null;
const newestOf = (vs: AppVersion[]) =>
  vs.reduce<AppVersion | null>((a, v) => (a === null || v.number > a.number ? v : a), null);
const label = (v: AppVersion | null) => (v ? `version ${v.number}` : "a version");

export function canvasReducer(s: AppCanvas, e: CanvasEvent): AppCanvas {
  switch (e.type) {
    case "versions": {
      const vs = e.versions;
      // 001k: a finished generation is shown when it appears, current or not (after a restore,
      // the server keeps the chosen version current; the new one is then "Not current").
      if (s.pendingSelect && byJob(vs, s.pendingSelect)) {
        const shown = canvasReducer(
          { ...s, versions: vs, pendingSelect: null },
          { type: "select", job: s.pendingSelect },
        );
        return canvasReducer(
          { ...shown, follow: shown.follow },
          { type: "versions", versions: vs },
        );
      }
      const keep = byJob(vs, s.selected);
      const selected =
        s.follow || !keep
          ? (currentOf(vs)?.job_id ?? newestOf(vs)?.job_id ?? null)
          : (keep.job_id as string);
      let next: AppCanvas = { ...s, versions: vs, selected, follow: s.follow || !keep };
      // Whatever named a version that is gone (or no longer selected) is closed, never retargeted.
      if (next.preview && (!byJob(vs, next.preview.job) || next.preview.job !== selected))
        next = {
          ...next,
          preview: null,
          note: `The preview of ${label(byJob(s.versions, s.preview?.job ?? null))} was stopped: it's no longer the version shown.`,
        };
      if (next.offerUnchecked !== null && next.offerUnchecked !== selected)
        next = { ...next, offerUnchecked: null };
      if (
        next.compare &&
        (next.compare.from !== selected ||
          !byJob(vs, next.compare.to)?.current ||
          !byJob(vs, next.compare.from))
      )
        next = { ...next, compare: null };
      return next;
    }
    case "select": {
      if (e.job === s.selected || !byJob(s.versions, e.job)) return s;
      const chosen = byJob(s.versions, e.job);
      const current = currentOf(s.versions);
      return {
        ...s,
        selected: e.job,
        follow: current?.job_id === e.job,
        preview: null,
        offerUnchecked: null,
        compare: null,
        note: s.preview
          ? `The preview of ${label(byJob(s.versions, s.preview.job))} was stopped: you're now looking at ${label(chosen)}.`
          : null,
      };
    }
    case "previewOpened":
      // A late answer for a version no longer selected opens nothing.
      if (e.job !== s.selected) return s;
      return {
        ...s,
        preview: { job: e.job, url: e.url, checked: e.checked },
        offerUnchecked: null,
        note: null,
      };
    case "previewRefused":
      return e.job === s.selected ? { ...s, offerUnchecked: e.job } : s;
    case "declineUnchecked":
      return { ...s, offerUnchecked: null };
    case "stop":
      return { ...s, preview: null, note: e.why };
    case "openCompare": {
      const current = currentOf(s.versions);
      if (!s.selected || !current || current.job_id === s.selected) return s;
      return { ...s, compare: { from: s.selected, to: current.job_id, returnTo: e.returnTo } };
    }
    case "closeCompare":
      return { ...s, compare: null };
    case "toggleHistory":
      return { ...s, history: !s.history };
    case "note":
      return { ...s, note: e.note };
    case "generated":
      return byJob(s.versions, e.job)
        ? { ...canvasReducer(s, { type: "select", job: e.job }), pendingSelect: null }
        : { ...s, pendingSelect: e.job };
    case "gone":
      return initialCanvas;
  }
}

/** What the stage shows now, in priority order. */
export type Stage =
  | { kind: "empty" }
  | { kind: "preview"; version: AppVersion }
  | { kind: "unchecked_choice"; version: AppVersion }
  | { kind: "unconfigured"; version: AppVersion }
  | { kind: "ready"; version: AppVersion };

export function stageOf(s: AppCanvas, previewAvailable: boolean): Stage {
  const v = byJob(s.versions, s.selected);
  if (!v) return { kind: "empty" };
  if (s.preview?.job === v.job_id) return { kind: "preview", version: v };
  if (s.offerUnchecked === v.job_id) return { kind: "unchecked_choice", version: v };
  if (!previewAvailable) return { kind: "unconfigured", version: v };
  return { kind: "ready", version: v };
}

/** The three roles of one version, for its labels. */
export function rolesOf(s: AppCanvas, job: string) {
  const v = byJob(s.versions, job);
  return {
    selected: s.selected === job,
    current: v?.current ?? false,
    previewing: s.preview?.job === job,
  };
}

/** One readable line that keeps the three distinct: what you see, what's current, what's running. */
export function rolesLine(s: AppCanvas) {
  const sel = byJob(s.versions, s.selected);
  const cur = currentOf(s.versions);
  const prev = byJob(s.versions, s.preview?.job ?? null);
  if (!sel) return "No version yet.";
  return [
    `Showing version ${sel.number}`,
    cur ? `current is version ${cur.number}` : "no current version",
    prev ? `version ${prev.number} is running in the preview` : "no preview running",
  ].join(" · ");
}

export const selectedOf = (s: AppCanvas) => byJob(s.versions, s.selected);

/**
 * One assistant composer at a time (001k): the brief companion's conversation is shown on every
 * Studio view except the Web app view, whose own composer changes the app's code. Set aside, the
 * conversation stays mounted, so its unsent text and any pending request are kept.
 */
export const briefComposerShown = (tab: string) => tab !== "app";
