# 001k Executable Studio canvas: report

Job: `docs/astra/jobs/2026-11-04_001k_executable-studio-canvas.md`, after
ExecutableStudioCompositionReview.

**Commits:**
- `732306d`: Astra's WorkerConformanceReview and INDEX, committed after the check passed.
- `e023a11`: the canvas: code, tests and the CANVAS_STUDIO section "Executable canvas".

**Status: in review. Not browser-reviewed by me** (no browser here). The tests are
interaction-controller and static-render checks, not pixel or focus proof in a real browser.

No host, VM or conformance work was done: 002f stays in review (13/15, not engine acceptance).
I did not start 003w.

## What changed for the founder (Studio → Web app)

**Version tools** (one compact row above the stage):
- a "Version" picker (newest first, "(current)" marked);
- the shown version's Current / Not current and check-state pills;
- Run logic checks;
- Compare with current and "Make this the current version" (only when the shown version isn't
  current);
- History (N).

Beneath the row, a mono line keeps the three roles apart: "Showing version 2 · current is version
3 · version 2 is running in the preview".

**The stage** (the local dark surface, beside the composer on a wide canvas, first in the
workspace) shows exactly one of:
- the shown version's sandboxed frame. Its boundary is unchanged: `allow-scripts` only, a
  separate site, no referrer, single page, and Stop. The bar and title name the version.
- a placeholder: "Version N: name — It isn't running. <check words>" with "Preview version N";
- the server-gated unchecked choice, after a `not_checked` refusal: the warned text, "Open
  unchecked preview" and "Not now";
- "No web app yet", which points at the composer;
- "Preview isn't configured on this server", with no preview button.

**One assistant composer at a time:**
- **"Change the web app"** (*Assistant · code*) is the only composer on this view.
  - It explains that it writes code as a new version, using the AI budget.
  - It notes that a change starts from the current version when another version is shown.
  - It links to "shape the brief".
- **Kept unchanged in it:**
  - "Recover my request" (the same request again), the typed-ahead draft, the budget field and its
    limits;
  - generate and cancel, "Check progress", and the finite polling;
  - the shown version's case-by-case check results and cancel-check.
- **The brief companion** is now *Companion · brief* and says it doesn't change the app's code.
  On this view its conversation is set aside, still mounted, so unsent text and pending proposal
  requests survive. A note and "Shape the brief instead" take its place.

**Comparison** is a panel under the stage.
- Opening it moves focus to its title.
- "Close comparison" or Escape closes it and returns focus to "Compare with current".
- It closes, rather than retargeting, when the shown or current version changes.

**History** is a toggled panel of compact rows: version, name, Current / Shown / In preview,
check words, digest and the request. Select is a pressed button.

**Rules (`web/src/appCanvas.ts`, pure):**
- Selecting only changes the view: it never sets current or a check.
- The shown version follows current until another is picked.
- Selecting another version stops a running frame, with a note.
- A late preview answer for a version no longer shown opens nothing.
- A vanished version is never replaced in the frame.
- A finished generation is shown as soon as it is listed, even when the server keeps a restored
  version current. I found this while reviewing: after a restore, the server's chosen pointer
  wins, so "ready on the stage" would otherwise have shown the old version.

**Layout:**
- A wide canvas puts the stage and the composer (sticky) side by side.
- The placeholder and frame heights use `clamp(…, 100vh − …, …)`, so the stage and its controls
  start inside the first workspace viewport at 1440 and 1280.
- At ≤ 880 px canvas (a container query, so zoom too), one column: stage, composer, panels.
- At ≤ 480 px (390), a full-width picker, a wrapping toolbar and a tighter stage. Code scrolls
  inside its own region.

**Unchanged:**
- `?view=app` deep links;
- the scope key (person, project, owner epoch);
- the Preview and Brief schema canvas with its Try and Edit tools;
- every server rule.

## Evidence

**`web/test/appCanvas.test.ts`** (10 tests; the view's events):
- the shown version follows current through a generation, and the old frame is stopped;
- selecting an older version leaves current unchanged, stops the frame and survives refreshes;
- a late preview answer opens nothing;
- a vanished version is never replaced in the frame;
- a finished generation is shown after a restore (and at once when it is already listed);
- the unchecked choice is offered only for the shown version after a refusal, and opens only
  explicitly;
- the empty and unconfigured stages;
- Stop and its reason;
- comparison only against current, with its return target, closing on change;
- history and `gone`;
- the brief composer set aside only on `app`.

**`web/test/appView.test.tsx`** (+5) statically renders each stage state: the placeholder action
and no frame; the explicit unchecked choice and no frame; empty and unconfigured; the frame,
titled with its version and sandboxed. Also history rows with their roles and pressed state.

**`web/test/appLayout.test.ts`** keeps the 390 containment contract, now on `.app-canvas` and
`.app-stage-col`.

**Checks:**
- **`npm run check`:** exit 0, lint and types clean. 1198 passed and 1 skipped (1199), across 125
  passed and 1 skipped files.
- **`npm run web:build`:** 880.23 kB JS (was 871.93) and 72.52 kB CSS, with the existing
  chunk-size warning.

## For Astra's browser review (finite, local, fictional)

```
npm run web:build
npx tsx scripts/preview-app.ts        # NO --wsl: no worker, no VM; checks say nothing ran
```

**Open** `http://127.0.0.1:8858/build/<printed id>?view=app` (as Ava Chen). Previews load from
`http://localhost:8858`. Ctrl+C ends it; it is in memory and nothing remains. I smoke-ran it for 25
s: page 200, controls answered, and it exited at the deadline.

**Scripted states** (controls on `http://127.0.0.1:8859/`, loopback):
- **Two versions exist:**
  - pick the older one to see Not current, Compare and Make current;
  - Preview gives the explicit unchecked choice in the stage, because no worker means not
    checked;
  - "Open unchecked preview" opens the frame; Stop removes it.
- **Lost answer:** `POST /generation/lose`, then generate. "Recover my request" appears in the
  composer and resends the same request.
- **Pending and finish:** generations stay queued (Generating, Cancel, Check progress) until
  `POST /generation/complete`. The new version is then shown on the stage.
- **Read failures:** `POST /reads/fail/3` shows "Couldn't refresh… Showing what was last read"
  with Retry.
- **Composer isolation:** "Show the companion" on this view shows the set-aside note (no second
  composer). "Shape the brief instead" goes to Brief with the conversation intact.
- **Comparison:** with an older version shown, "Compare with current" moves focus to the panel
  title. Escape returns it to the button.

**To check:**
- 1440 and 1280: the stage is in the first workspace viewport;
- 390: no overlap or overflow;
- keyboard focus and return;
- reduced motion and zoom;
- empty, loading and failure states.

**Not claimed:**
- that the browser view passed isolated checks;
- live AI or worker isolation;
- deployed customer apps;
- complete M1 or M2.

All six milestones remain open, as do 003w, 004b, 005c, 005d and 006a. Astra's concurrent files
are untouched and uncommitted:
- the WorkerConformanceReview edit;
- INDEX;
- the new `jobs/2026-11-04_002f1_worker-readiness-corrections.md`.
