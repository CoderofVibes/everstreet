// Job 002e: the Studio web app view's pure rules: what each check state means in words (never
// claiming isolation from a test double or an absent engine), the preview's narrow message
// protocol, and a bounded line diff for comparing versions.
// Design: docs/design/EXECUTABLE_PRODUCTS.md §1 and §6.

import type { AppCheckState } from "./appApi.ts";

export interface CheckWords {
  label: string;
  tone: "" | "blue" | "mint" | "caution" | "error";
  detail: string;
}

/** A check's state in words; a test double's pass is never presented as isolation. */
export function checkWords(state: AppCheckState | null, testDouble: boolean): CheckWords {
  switch (state) {
    case null:
      return {
        label: "Not checked",
        tone: "",
        detail: "Its logic hasn't been checked in the isolated worker.",
      };
    case "queued":
      return { label: "Waiting for the worker", tone: "blue", detail: "One check runs at a time." };
    case "running":
      return {
        label: "Running in the isolated worker",
        tone: "blue",
        detail: "Its logic cases are running now.",
      };
    case "passed":
      return testDouble
        ? {
            label: "Passed in a test double",
            tone: "caution",
            detail:
              "A test double answered: this is not an isolation check, and the version stays unchecked.",
          }
        : {
            label: "Logic checks passed",
            tone: "mint",
            detail:
              "The isolated worker ran its logic cases and each matched. This checks its logic, not its screens.",
          };
    case "failed":
      return {
        label: "Logic checks failed",
        tone: "error",
        detail: "See which case or file failed below.",
      };
    case "unavailable":
      return {
        label: "Isolated worker unavailable",
        tone: "caution",
        detail: "Nothing ran. No isolated worker is ready on this machine.",
      };
    case "unknown":
      return {
        label: "Outcome unknown",
        tone: "caution",
        detail: "It was sent, then the worker stopped. It is never re-run automatically.",
      };
    case "cancelled":
      return { label: "Cancelled", tone: "", detail: "" };
  }
}

/**
 * The preview's only accepted message: `{everstreet_preview: 1, type: "ready"}` from that frame's
 * window, with the opaque origin "null". Anything else is ignored.
 */
export function previewMessage(
  e: { source: unknown; origin: string; data: unknown },
  frame: unknown,
): "ready" | null {
  if (!frame || e.source !== frame || e.origin !== "null") return null;
  const d = e.data as Record<string, unknown> | null;
  if (!d || typeof d !== "object" || d.everstreet_preview !== 1 || d.type !== "ready") return null;
  return "ready";
}

export type DiffLine = { kind: "same" | "add" | "del"; text: string };

/** Line diff by longest common subsequence, bounded; null when too large to compare here. */
export function lineDiff(a: string, b: string, maxCells = 4_000_000): DiffLine[] | null {
  const x = a.split("\n");
  const y = b.split("\n");
  if (x.length * y.length > maxCells) return null;
  const n = x.length;
  const m = y.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      (lcs[i] as Uint32Array)[j] =
        x[i] === y[j]
          ? ((lcs[i + 1] as Uint32Array)[j + 1] as number) + 1
          : Math.max(
              (lcs[i + 1] as Uint32Array)[j] as number,
              (lcs[i] as Uint32Array)[j + 1] as number,
            );
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ kind: "same", text: x[i] as string });
      i++;
      j++;
    } else if (
      ((lcs[i + 1] as Uint32Array)[j] as number) >= ((lcs[i] as Uint32Array)[j + 1] as number)
    ) {
      out.push({ kind: "del", text: x[i] as string });
      i++;
    } else {
      out.push({ kind: "add", text: y[j] as string });
      j++;
    }
  }
  while (i < n) out.push({ kind: "del", text: x[i++] as string });
  while (j < m) out.push({ kind: "add", text: y[j++] as string });
  return out;
}

/** Files of two versions compared: changed, added and removed paths, in order. */
export function changedFiles(
  from: { path: string; text: string }[],
  to: { path: string; text: string }[],
) {
  const a = new Map(from.map((f) => [f.path, f.text]));
  const b = new Map(to.map((f) => [f.path, f.text]));
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
  return paths
    .map((path) => ({
      path,
      status: !a.has(path)
        ? "added"
        : !b.has(path)
          ? "removed"
          : a.get(path) === b.get(path)
            ? "same"
            : "changed",
      from: a.get(path) ?? "",
      to: b.get(path) ?? "",
    }))
    .filter((f) => f.status !== "same");
}
