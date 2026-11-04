// Job 001k: the executable canvas's interaction rules (web/src/appCanvas.ts), driven through the
// same events the Web app view dispatches. What this proves: selected, current and previewed
// versions stay distinct; a frame always belongs to the version shown (selecting another stops
// it; a late preview answer for an old selection opens nothing); the unchecked choice is only
// ever offered for the shown version after the server refused an ordinary preview, and nothing
// opens unchecked without an explicit open; comparison opens only against the current version,
// carries its focus-return target and closes when its versions change; a vanished version is
// never silently replaced in the preview; the brief composer is set aside only on the Web app view.

import { describe, expect, it } from "vitest";
import type { AppVersion } from "../src/appApi.ts";
import {
  type AppCanvas,
  briefComposerShown,
  type CanvasEvent,
  canvasReducer,
  initialCanvas,
  rolesLine,
  rolesOf,
  stageOf,
} from "../src/appCanvas.ts";

const v = (n: number, current = false, state: string | null = null): AppVersion => ({
  job_id: `job-${n}`,
  number: n,
  name: `Plan estimator ${n}`,
  description: "",
  digest: String(n).repeat(64).slice(0, 64),
  bytes: 1000,
  base_job: n > 1 ? `job-${n - 1}` : null,
  instructions: n > 1 ? "Make priority support cheaper" : null,
  files: [{ path: "index.html", bytes: 100 }],
  checks: [],
  latest_check: state
    ? ({ id: `c-${n}`, state, test_double: false, finished_at: null } as AppVersion["latest_check"])
    : null,
  current,
  created_at: "",
});
const run = (events: CanvasEvent[], from: AppCanvas = initialCanvas) =>
  events.reduce(canvasReducer, from);
const loaded = (...vs: AppVersion[]): CanvasEvent => ({ type: "versions", versions: vs });

describe("001k canvas: selected, current and previewed stay distinct", () => {
  it("shows the current version first, and follows a new current version after a generation", () => {
    let s = run([loaded(v(1), v(2, true))]);
    expect(s.selected).toBe("job-2");
    expect(stageOf(s, true)).toMatchObject({ kind: "ready", version: { number: 2 } });
    s = run([{ type: "previewOpened", job: "job-2", url: "u2", checked: true }], s);
    expect(rolesOf(s, "job-2")).toEqual({ selected: true, current: true, previewing: true });
    // A generation made version 3 current: the stage follows it and the old frame is stopped.
    s = run([loaded(v(1), v(2), v(3, true))], s);
    expect(s.selected).toBe("job-3");
    expect(s.preview).toBeNull();
    expect(s.note).toMatch(/preview of version 2 was stopped/);
    expect(stageOf(s, true)).toMatchObject({ kind: "ready", version: { number: 3 } });
  });

  it("selecting an older version only shows it: current is unchanged, the frame stops, refreshes keep the choice", () => {
    let s = run([
      loaded(v(1), v(2, true)),
      { type: "previewOpened", job: "job-2", url: "u2", checked: true },
      { type: "select", job: "job-1" },
    ]);
    expect(rolesOf(s, "job-1")).toEqual({ selected: true, current: false, previewing: false });
    expect(rolesOf(s, "job-2")).toEqual({ selected: false, current: true, previewing: false });
    expect(s.preview).toBeNull();
    expect(s.note).toMatch(/you're now looking at version 1/);
    expect(rolesLine(s)).toBe("Showing version 1 · current is version 2 · no preview running");
    // Polling brings the same versions again: the founder's choice stays.
    s = run([loaded(v(1), v(2, true))], s);
    expect(s.selected).toBe("job-1");
    // Making it current (a server action) is reflected only when the server says so.
    s = run([loaded(v(1, true), v(2))], s);
    expect(rolesOf(s, "job-1")).toEqual({ selected: true, current: true, previewing: false });
  });

  it("a late preview answer for a version no longer shown opens nothing", () => {
    const s = run([
      loaded(v(1), v(2, true)),
      { type: "select", job: "job-1" },
      { type: "previewOpened", job: "job-2", url: "late", checked: true },
    ]);
    expect(s.preview).toBeNull();
    expect(stageOf(s, true).kind).toBe("ready");
    expect(rolesLine(s)).toMatch(/no preview running/);
  });

  it("a version that disappears is never replaced in the preview", () => {
    let s = run([
      loaded(v(1), v(2, true)),
      { type: "select", job: "job-1" },
      { type: "previewOpened", job: "job-1", url: "u1", checked: false },
    ]);
    expect(s.preview?.job).toBe("job-1");
    s = run([loaded(v(2, true))], s);
    expect(s.selected).toBe("job-2");
    expect(s.preview).toBeNull();
    expect(s.note).toMatch(/preview of version 1 was stopped/);
  });
});

describe("001k canvas: a finished generation is shown", () => {
  it("after a restore, the new version is shown even though the chosen one stays current", () => {
    // Version 1 was restored (current); version 2 exists. A generation makes version 3, which the
    // server does NOT make current (the chosen pointer wins).
    let s = run([loaded(v(1, true), v(2)), { type: "generated", job: "job-3" }]);
    expect(s.selected).toBe("job-1"); // not listed yet: remembered, nothing guessed
    s = run([loaded(v(1, true), v(2), v(3))], s);
    expect(s.selected).toBe("job-3");
    expect(rolesOf(s, "job-3")).toEqual({ selected: true, current: false, previewing: false });
    expect(rolesLine(s)).toMatch(/^Showing version 3 · current is version 1/);
    // Further refreshes keep showing it.
    expect(run([loaded(v(1, true), v(2), v(3))], s).selected).toBe("job-3");
  });

  it("when the new version is already listed it is shown at once, stopping another frame", () => {
    const s = run([
      loaded(v(1, true), v(2)),
      { type: "previewOpened", job: "job-1", url: "u1", checked: true },
      { type: "generated", job: "job-2" },
    ]);
    expect(s.selected).toBe("job-2");
    expect(s.preview).toBeNull();
    expect(s.pendingSelect).toBeNull();
  });
});

describe("001k canvas: the unchecked choice stays explicit", () => {
  it("is offered only for the shown version after a refusal, and only an explicit open runs it", () => {
    let s = run([loaded(v(1, true, null))]);
    // A refusal for another version (a stale answer) offers nothing.
    expect(run([{ type: "previewRefused", job: "job-9" }], s).offerUnchecked).toBeNull();
    s = run([{ type: "previewRefused", job: "job-1" }], s);
    expect(stageOf(s, true)).toMatchObject({ kind: "unchecked_choice", version: { number: 1 } });
    expect(s.preview).toBeNull(); // nothing runs until the founder opens it
    expect(stageOf(run([{ type: "declineUnchecked" }], s), true).kind).toBe("ready");
    const opened = run([{ type: "previewOpened", job: "job-1", url: "u", checked: false }], s);
    expect(stageOf(opened, true).kind).toBe("preview");
    expect(opened.preview?.checked).toBe(false);
    expect(opened.offerUnchecked).toBeNull();
  });

  it("states without a version or without preview have their own stage", () => {
    expect(stageOf(run([loaded()]), true)).toEqual({ kind: "empty" });
    expect(stageOf(run([loaded(v(1, true))]), false).kind).toBe("unconfigured");
    expect(rolesLine(run([loaded()]))).toBe("No version yet.");
  });

  it("Stop removes the frame and keeps its reason", () => {
    const s = run([
      loaded(v(1, true, "passed")),
      { type: "previewOpened", job: "job-1", url: "u", checked: true },
      { type: "stop", why: "The preview tried to open another page and was stopped." },
    ]);
    expect(s.preview).toBeNull();
    expect(s.note).toMatch(/another page/);
  });
});

describe("001k canvas: comparison and history", () => {
  it("compares the shown version with the current one, returning focus to the opener", () => {
    let s = run([loaded(v(1), v(2, true))]);
    // The current version can't be compared with itself.
    expect(run([{ type: "openCompare", returnTo: "x" }], s).compare).toBeNull();
    s = run(
      [
        { type: "select", job: "job-1" },
        { type: "openCompare", returnTo: "app-compare-open" },
      ],
      s,
    );
    expect(s.compare).toEqual({ from: "job-1", to: "job-2", returnTo: "app-compare-open" });
    expect(run([{ type: "closeCompare" }], s).compare).toBeNull();
    // Choosing another version closes it rather than comparing something else silently.
    expect(run([{ type: "select", job: "job-2" }], s).compare).toBeNull();
    // So does a change of the current version.
    expect(run([loaded(v(1), v(2), v(3, true))], s).compare).toBeNull();
  });

  it("history toggles without changing the selection; gone clears everything private", () => {
    let s = run([loaded(v(1), v(2, true)), { type: "toggleHistory" }]);
    expect(s.history).toBe(true);
    expect(s.selected).toBe("job-2");
    s = run([{ type: "select", job: "job-1" }, { type: "gone" }], s);
    expect(s).toEqual(initialCanvas);
  });
});

describe("001k one assistant composer at a time", () => {
  it("the brief conversation is set aside only on the Web app view", () => {
    expect(briefComposerShown("app")).toBe(false);
    for (const t of ["preview", "brief", "proposal", "versions", "builds", "service"])
      expect(briefComposerShown(t)).toBe(true);
  });
});
