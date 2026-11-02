// The Versions view's selection and late-response handling (web/src/revisionHistory.ts),
// driven through the sequences the browser review reproduced. The view renders exactly
// shownRevision(state), so these are the states a founder would see.

import { describe, expect, it } from "vitest";
import type { Revision } from "../src/productsApi.ts";
import {
  type HistoryAction,
  historyReducer,
  initialHistory,
  shownRevision,
} from "../src/revisionHistory.ts";

const rev = (number: number, name = `Name ${number}`): Revision => ({
  number,
  brief: {
    name,
    audience: "",
    problem: "",
    promise: "",
    features: [],
    price: { model: "undecided", amount_cents: null, note: "" },
  },
  prototype: { schema: 1, screens: [] },
  content_hash: `hash-${number}`,
  note: `Revision ${number}`,
  restored_from: null,
  author: "Ava Chen",
  created_at: "2026-11-02T10:00:00.000Z",
});

const run = (projectId: string, head: Revision, actions: HistoryAction[]) =>
  actions.reduce(historyReducer, initialHistory(projectId, head));

describe("version history selection", () => {
  it("shows the new head after a restore even when the old revision's response arrives late", () => {
    // Revision 2 is current; the founder selects 1, restores it as 3, and only then does the
    // request for revision 1 (started before or during the restore) come back.
    const state = run("p1", rev(2), [
      { type: "select", number: 1 },
      { type: "head", head: rev(3, "Name 1") },
      { type: "received", projectId: "p1", revision: rev(1) },
    ]);
    const shown = shownRevision(state);
    expect(shown.number).toBe(3);
    expect(shown.isHead).toBe(true);
    expect(shown.revision?.number).toBe(3);
  });

  it("keeps the latest selection when answers arrive out of order", () => {
    const state = run("p1", rev(3), [
      { type: "select", number: 1 },
      { type: "select", number: 2 },
      { type: "received", projectId: "p1", revision: rev(2) },
      { type: "received", projectId: "p1", revision: rev(1) },
    ]);
    expect(shownRevision(state)).toMatchObject({ number: 2, isHead: false });
    expect(shownRevision(state).revision?.number).toBe(2);
    // Going back to 1 uses the answer that already arrived, without another request.
    const back = historyReducer(state, { type: "select", number: 1 });
    expect(shownRevision(back)).toMatchObject({ number: 1, needsFetch: false });
    expect(shownRevision(back).revision?.number).toBe(1);
  });

  it("asks for a revision it has not seen and shows nothing stale meanwhile", () => {
    const state = run("p1", rev(4), [
      { type: "select", number: 2 },
      { type: "received", projectId: "p1", revision: rev(2) },
      { type: "select", number: 3 },
    ]);
    expect(shownRevision(state)).toMatchObject({ number: 3, revision: null, needsFetch: true });
  });

  it("ignores answers meant for another project", () => {
    const state = run("p1", rev(2), [
      { type: "select", number: 1 },
      { type: "received", projectId: "p2", revision: rev(1, "Other project") },
      { type: "failed", projectId: "p2", number: 1, message: "nope" },
    ]);
    expect(shownRevision(state)).toMatchObject({ number: 1, revision: null, error: null });
  });

  it("reports a failed load for that revision only, and retries when selected again", () => {
    const failed = run("p1", rev(3), [
      { type: "select", number: 1 },
      { type: "failed", projectId: "p1", number: 1, message: "Network down" },
    ]);
    expect(shownRevision(failed)).toMatchObject({ number: 1, error: "Network down" });
    const other = historyReducer(failed, { type: "select", number: 3 });
    expect(shownRevision(other)).toMatchObject({ number: 3, isHead: true, error: null });
    const retry = historyReducer(other, { type: "select", number: 1 });
    expect(shownRevision(retry)).toMatchObject({ number: 1, error: null, needsFetch: true });
  });

  it("moves the selection to a new head after a save", () => {
    const state = run("p1", rev(2), [
      { type: "select", number: 1 },
      { type: "head", head: rev(3) },
    ]);
    expect(shownRevision(state)).toMatchObject({ number: 3, isHead: true });
    // The same head object again (a re-render) does not move a later choice.
    const chosen = historyReducer(state, { type: "select", number: 2 });
    const again = historyReducer(chosen, { type: "head", head: rev(3) });
    expect(shownRevision(again).number).toBe(2);
  });
});
