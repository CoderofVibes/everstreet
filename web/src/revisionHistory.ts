// What the Versions view shows. Revisions are immutable, so fetched ones are cached by number
// and a response can only ever fill its own slot: a late or out-of-order answer never
// replaces the revision the founder is looking at. A new head (after a save or restore)
// moves the selection to it.

import type { Revision } from "./productsApi.ts";

export interface HistoryState {
  projectId: string;
  head: Revision;
  /** The selected revision number, remembered for the head it was chosen under. */
  chosen: { head: number; number: number } | null;
  fetched: Record<number, Revision>;
  errors: Record<number, string>;
}

export type HistoryAction =
  | { type: "select"; number: number }
  | { type: "head"; head: Revision }
  | { type: "received"; projectId: string; revision: Revision }
  | { type: "failed"; projectId: string; number: number; message: string };

export function initialHistory(projectId: string, head: Revision): HistoryState {
  return { projectId, head, chosen: null, fetched: {}, errors: {} };
}

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "select": {
      const { [action.number]: _dropped, ...errors } = state.errors;
      return { ...state, chosen: { head: state.head.number, number: action.number }, errors };
    }
    case "head":
      if (action.head.number === state.head.number) return { ...state, head: action.head };
      return { ...state, head: action.head, chosen: null };
    case "received":
      if (action.projectId !== state.projectId) return state;
      return {
        ...state,
        fetched: { ...state.fetched, [action.revision.number]: action.revision },
      };
    case "failed":
      if (action.projectId !== state.projectId) return state;
      return { ...state, errors: { ...state.errors, [action.number]: action.message } };
  }
}

/** The selected number: the founder's choice if it was made under the current head. */
export function selectedNumber(state: HistoryState): number {
  return state.chosen && state.chosen.head === state.head.number
    ? state.chosen.number
    : state.head.number;
}

export function shownRevision(state: HistoryState): {
  number: number;
  isHead: boolean;
  revision: Revision | null;
  error: string | null;
  /** True when the selected revision still has to be fetched. */
  needsFetch: boolean;
} {
  const number = selectedNumber(state);
  const isHead = number === state.head.number;
  const revision = isHead ? state.head : (state.fetched[number] ?? null);
  const error = isHead ? null : (state.errors[number] ?? null);
  return { number, isHead, revision, error, needsFetch: !revision && !error };
}
