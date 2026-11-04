// Job 001f2: Home and the composer's read states, as pure rules. A failed read is a failure with
// a retry, never an empty catalog or a missing product type; the composer only starts a project
// for a product type that was actually offered and chosen.

import type { PublicBusiness } from "./api.ts";
import { marketOrder } from "./discover.ts";
import type { LoadState } from "./latestLoad.ts";
import type { Foundation, FoundationInfo } from "./productsApi.ts";

export type CatalogView =
  | { kind: "loading" }
  | { kind: "failed"; error: string | null }
  | { kind: "empty"; software: boolean }
  | { kind: "list"; shown: PublicBusiness[]; earlierOnly: boolean; more: boolean };

/** What "On Everstreet now" shows. Data already confirmed stays shown while a retry fails. */
export function catalogView(s: LoadState<PublicBusiness[]>, category: string): CatalogView {
  if (s.data === null)
    return s.status === "loading" ? { kind: "loading" } : { kind: "failed", error: s.error };
  const ordered = marketOrder(s.data);
  const shown = ordered.filter((b) => category === "all" || b.family === category).slice(0, 8);
  const hasSoftware = ordered.some((b) => b.family === "software" || b.digital);
  if (shown.length === 0)
    return {
      kind: "empty",
      software: category === "software" || (category === "all" && !hasSoftware),
    };
  return {
    kind: "list",
    shown,
    earlierOnly: category === "all" && !hasSoftware,
    more: ordered.length > shown.length,
  };
}

/**
 * Whether the composer may start a project now, and if not why. The product types must have been
 * read, and the chosen one must be among them: a failed or still-loading read never submits a
 * default the person didn't see.
 */
export function composerReady(
  types: LoadState<FoundationInfo[]>,
  chosen: Foundation,
): { canSubmit: boolean; reason: string | null } {
  if (types.data === null)
    return {
      canSubmit: false,
      reason:
        types.status === "loading"
          ? "Loading the kinds of product you can start…"
          : "The kinds of product couldn't be loaded, so nothing can be started yet. Your idea is kept.",
    };
  if (!types.data.some((t) => t.id === chosen))
    return {
      canSubmit: false,
      reason: "The kind of product you chose isn't offered here now. Choose one of those shown.",
    };
  return { canSubmit: true, reason: null };
}
