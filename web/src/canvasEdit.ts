// Job 001g: the canvas studio's editing model, as pure rules. In Edit mode one supported element
// of the prototype or brief is selected and its context tools change the unsaved draft; a
// selection whose element no longer exists resolves to nothing (never to a different element).
// Unsaved edits can be undone and redone; typing in one control is one step. Undo is local to
// the unsaved draft and never touches a saved revision, release or customer offer.

import type { Brief, Prototype, Screen } from "./productsApi.ts";

export type Mode = "try" | "edit";

export type BriefSection = "name" | "audience" | "problem" | "promise" | "features" | "price";

export const BRIEF_SECTIONS: { id: BriefSection; label: string }[] = [
  { id: "name", label: "Product name" },
  { id: "audience", label: "Who it's for" },
  { id: "problem", label: "Problem" },
  { id: "promise", label: "Promised result" },
  { id: "features", label: "Core features" },
  { id: "price", label: "Pricing assumption" },
];

/** One supported element; each maps to a real field of the saved schema. */
export type Selection =
  | { kind: "brief"; section: BriefSection }
  | { kind: "screen"; screen: string }
  | { kind: "field"; screen: string; key: string }
  | { kind: "submit"; screen: string }
  | { kind: "stages"; screen: string }
  | { kind: "output"; screen: string; key: string };

export interface Content {
  brief: Brief;
  prototype: Prototype;
}

const screenOf = (p: Prototype, id: string): Screen | undefined =>
  p.screens.find((s) => s.id === id);

/** The selection if its element still exists in this prototype, else null. */
export function resolveSelection(sel: Selection | null, p: Prototype): Selection | null {
  if (!sel) return null;
  if (sel.kind === "brief") return BRIEF_SECTIONS.some((b) => b.id === sel.section) ? sel : null;
  const s = screenOf(p, sel.screen);
  if (!s) return null;
  switch (sel.kind) {
    case "screen":
      return sel;
    case "field":
      return s.kind === "form" && s.fields.some((f) => f.key === sel.key) ? sel : null;
    case "submit":
      return s.kind === "form" ? sel : null;
    case "stages":
      return s.kind === "list" ? sel : null;
    case "output":
      return s.kind === "model" && s.outputs.some((o) => o.key === sel.key) ? sel : null;
  }
}

/** Which selections a view's tools show: the preview shows the product name and screens; the brief document its sections. */
export function selectionFor(view: "preview" | "brief", sel: Selection | null): Selection | null {
  if (!sel) return null;
  if (view === "brief") return sel.kind === "brief" ? sel : null;
  return sel.kind !== "brief" || sel.section === "name" ? sel : null;
}

export const selectionKey = (sel: Selection): string =>
  sel.kind === "brief"
    ? `brief-${sel.section}`
    : sel.kind === "field" || sel.kind === "output"
      ? `${sel.kind}-${sel.screen}-${sel.key}`
      : `${sel.kind}-${sel.screen}`;

/** The selectable element's DOM id in the stage (focus returns there on Escape). */
export const elementDomId = (sel: Selection): string =>
  `pick-${selectionKey(sel).replace(/[^A-Za-z0-9_-]/g, "_")}`;

/** The screen a selection belongs to, so the stage can show it. */
export const screenOfSelection = (sel: Selection | null): string | null =>
  sel && sel.kind !== "brief" ? sel.screen : null;

/** What the tools' heading calls the selection. */
export function selectionLabel(sel: Selection, p: Prototype): string {
  if (sel.kind === "brief")
    return BRIEF_SECTIONS.find((b) => b.id === sel.section)?.label ?? "Brief";
  const s = screenOf(p, sel.screen);
  const on = s ? ` on ${s.title || "an untitled screen"}` : "";
  switch (sel.kind) {
    case "screen":
      return `Screen: ${s?.title || "untitled"}`;
    case "field": {
      const f = s?.kind === "form" ? s.fields.find((x) => x.key === sel.key) : undefined;
      return `Field: ${f?.label || "unlabelled"}${on}`;
    }
    case "submit":
      return `Button${on}`;
    case "stages":
      return `Columns and stages${on}`;
    case "output": {
      const o = s?.kind === "model" ? s.outputs.find((x) => x.key === sel.key) : undefined;
      return `Result field: ${o?.label || "unlabelled"}${on}`;
    }
  }
}

// ---------- undo of unsaved edits ----------

/**
 * The one string leaf two values differ in (its path), or null when they differ in more than one
 * place, in shape (an added or removed item) or not at all. Typing in a single control changes one
 * string leaf, so consecutive keystrokes there coalesce into one undo step; structural changes
 * never coalesce.
 */
export function changeKey(a: unknown, b: unknown): string | null {
  const paths: string[] = [];
  let structural = false;
  const walk = (x: unknown, y: unknown, path: string) => {
    if (structural || paths.length > 1) return;
    if (Object.is(x, y)) return;
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length) {
        structural = true;
        return;
      }
      for (let i = 0; i < x.length; i++) walk(x[i], y[i], `${path}/${i}`);
      return;
    }
    if (x && y && typeof x === "object" && typeof y === "object") {
      const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
      for (const k of keys)
        walk((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k], `${path}/${k}`);
      return;
    }
    if (typeof x === "string" && typeof y === "string") paths.push(path);
    else structural = true;
  };
  walk(a, b, "");
  return !structural && paths.length === 1 ? (paths[0] ?? null) : null;
}

export const UNDO_LIMIT = 50;

export interface EditHistory<T> {
  past: T[];
  future: T[];
  /** The leaf the last recorded edit changed; the next edit to it coalesces. */
  lastKey: string | null;
}

export const emptyHistory = <T>(): EditHistory<T> => ({ past: [], future: [], lastKey: null });

/** Record an edit from `before` to `after`. A redo branch is dropped; at most UNDO_LIMIT steps. */
export function recordEdit<T>(h: EditHistory<T>, before: T, after: T): EditHistory<T> {
  const key = changeKey(before, after);
  if (key !== null && key === h.lastKey && h.past.length > 0)
    return { past: h.past, future: [], lastKey: key };
  return { past: [...h.past, before].slice(-UNDO_LIMIT), future: [], lastKey: key };
}

/** Step back: the value to show, and the history; null when there is nothing to undo. */
export function undoEdit<T>(
  h: EditHistory<T>,
  current: T,
): { value: T; history: EditHistory<T> } | null {
  const value = h.past[h.past.length - 1];
  if (value === undefined) return null;
  return {
    value,
    history: { past: h.past.slice(0, -1), future: [current, ...h.future], lastKey: null },
  };
}

export function redoEdit<T>(
  h: EditHistory<T>,
  current: T,
): { value: T; history: EditHistory<T> } | null {
  const value = h.future[0];
  if (value === undefined) return null;
  return {
    value,
    history: {
      past: [...h.past, current].slice(-UNDO_LIMIT),
      future: h.future.slice(1),
      lastKey: null,
    },
  };
}

/** The first form screen (where a brief to-do about inputs takes you), or null. */
export const firstForm = (p: Prototype): string | null =>
  p.screens.find((s) => s.kind === "form")?.id ?? null;
