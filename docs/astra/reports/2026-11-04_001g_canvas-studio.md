# 001g Canvas studio: report

Builder: Claude (Opus 5.5, high), sole writer. Job: `jobs/2026-11-04_001g_canvas-studio.md`.
Design first: `docs/design/CANVAS_STUDIO.md` is the composition and interaction map, written
before the code.

## What changed for the founder

- **The canvas is the workspace.** On Preview the prototype sits on a local dark stage, the one
  dark area the direction allows. On Brief the brief is a document. The other six views
  (Proposal, Versions, Checks, Builds, Service, Continuity) are unchanged in behaviour. They are
  now visually grouped as Shape and Run in the same tablist. The arrow keys, plus Home and End,
  move between views.
- **Companion.** The left column now holds only the conversation (and the source note when the
  idea came from a request). It is no longer a three-way switch with the brief and screen forms.
  "Edit the brief yourself" opens Brief in Edit mode. "Ask again" from a proposal opens the
  companion.
- **Try it / Edit.** One explicit switch, shared by Preview and Brief (Read / Edit on Brief).
  - **Try it** is the working prototype, as before.
  - In **Edit**, nothing can submit: no form, input, select or textarea is rendered in the
    stage. Each supported part is a real labelled button, for example "Edit field: Invoice file".
- **Supported selections**, each a real edit to the saved schema:
  - product name;
  - screen (from the nav or its heading);
  - form field;
  - form button;
  - list columns and stages;
  - model result field;
  - each brief section (name, audience, problem, promised result, features, pricing).
- **Not selectable, with the reason shown:**
  - a model step's behaviour ("comes from a build, not from this prototype");
  - sample entries ("appear in Try it");
  - the foundation and "where it started" (set when the project is made).
- **Context tools** (right of the stage; under it when the canvas is narrower than 880 px):
  - With a selection: only that element's editor, with the same controls, ids, limits and
    removal guards as before.
  - With nothing selected: a screens outline with Add form, list or model step (same limits,
    now with the reason when disabled), or the brief's sections.
  - Footer: change note, Save revision, Discard changes (when dirty), and **Undo / Redo** of
    unsaved edits.
- **Keyboard:**
  - Enter or Space on a selectable part moves focus to its first control.
  - Escape in the tools returns focus to that part; the selection stays.
  - Done returns focus to the part as well.
  - Ctrl/Cmd+S still saves.
- **Header Next.** A brief to-do now opens Brief in Edit mode on that section and focuses its
  field (same ids as before). The "input" to-do opens the first form screen. "Brief checks" in
  Progress and status now opens Checks.
- **Versions.** The restore hint now also says a released build and its customers don't change
  until you build and release again.

## Preserved (and where)

- **Unsaved draft:**
  - still per person, project and owner epoch in this browser;
  - offered back on reload;
  - Save refuses an outdated base (409, "Load the latest revision");
  - Discard confirms.
  - Every tools edit goes through one `edit()` that records undo.
  - Server replacements (`adopt`: load, save, restore, apply, discard) and "Bring them back"
    reset the undo history.
- **Conversation:** `ConversationPanel` is mounted once per scope (`key={scope}`) and never
  hidden behind a sub-switch now. Typed-ahead text, the outbox, lost/unknown sends and the
  owner-epoch reset are unchanged.
- **Sample state, mode and selection:** held in `ProductStudio`, so they survive view, mode,
  companion and layout switches. A selection whose element no longer exists resolves to nothing,
  never to another element (`resolveSelection`). A removed field returns the tools to its screen.
- **Unchanged components:**
  - Proposal inspect/apply, with its stale-base and previous-owner fencing;
  - revision compare/restore;
  - Builds;
  - Service (Try / Evaluate and release / Customer access), still mounted once opened;
  - Continuity;
  - status records and the summary line;
  - `?view=&task=` links, Back/Forward and `StudioBody`'s hidden-not-unmounted companion.

## Verification

- `web/test/canvasEdit.test.ts` (9 tests):
  - selections resolve only to their own element, including the same key on the wrong screen
    kind;
  - removal and restore resolve to nothing;
  - per-view selections;
  - distinct valid DOM ids and labels;
  - undo coalesces typing in one control, never structural changes;
  - undo/redo exactness, dropping the redo branch, the 50-step bound;
  - the add-screen and remove-screen limits and reasons.
- `web/test/canvasStudio.test.tsx` (10 tests, static render):
  - Try it renders the real form and submit;
  - Edit renders no form, submit, input, select or textarea, only labelled selectable buttons,
    with the selected one pressed;
  - the model step's reason;
  - the tools show only the selected field's, button's or brief section's editor, with the
    focus-target ids;
  - the outline when nothing is selected;
  - the Try hint;
  - Undo/Redo enabled only when there is history; Discard only when dirty.
- `server/test/studio-preview.test.ts` now also asserts the preview's empty state: the brief-only
  project at revision 1 is untitled, with no audience or promise, a name to-do, and a starter
  form that Edit mode can select.
- **Existing regressions pass unchanged:** `studioLayout`, `studioRecords`, `studioStatus`,
  conversation, service and offer tests.
- **Mutants**, each run alone with a time ceiling, all killed:
  1. a field selection resolving on a model screen's output with the same key: canvasEdit
     fails;
  2. every edit coalescing into the previous step: 2 tests fail;
  3. the real form rendering in Edit: the render test fails;
  4. the Brief view showing prototype selections: canvasEdit fails;
  5. a selected field opening its whole screen editor: the tools test fails.
- `npm run check`: lint clean (293 files), types clean, **1007 tests / 99 files passed**.
- `npm run web:build`: passed (816.11 kB bundle; same size advisory as before).

## Preview for Astra (fictional, in memory; not started or left running by me)

```
npm run web:build
npx tsx scripts/preview-studio.ts      # site 127.0.0.1:8816, controls :8817; Ctrl+C ends it
```

Act as Ava Chen. The projects:
- **Empty, brief only:** untitled, never built; the header's Next opens a brief to-do in Edit.
- **Released with a newer brief:** the summary line keeps "revision 1 released; the brief has
  changed since (revision 2)".
- **Failed release check:** built, never released.
- **Customer access:** `?view=service&task=customers`.

Building is deliberately not connected. Trials run on the scripted runtime. `POST :8817/lose/…`
and `/provider/fail` exercise lost answers and provider failure in Service.

## Limitations and unverified gates

- **No browser:** this builder has no browser tool. Layouts at 1440, 1280 and 390, 200 % zoom,
  reduced motion, real focus movement (Enter→tools, Escape→stage, Done), sticky tools and the
  390 px tab bar wrap are **not browser-verified**. The tests are static renders and pure rules.
  Astra's browser review is the gate.
- **1280 px fit:** with the companion (300 px) and tools (up to 340 px), the stage is about
  570 px wide. Whether that is comfortable, or whether the tools should drop under the stage
  sooner, needs a visual check.
- **Undo is in memory only.** It isn't kept across a reload (the draft itself still is). There
  is no Ctrl+Z binding: text fields keep their native undo.
- **Not in this job:**
  - no drag, reorder or direct inline text editing in the stage (selection opens tools);
  - no new schema capabilities, generated code, model runs or evaluations;
  - Builds, Service and Continuity weren't recomposed, only regrouped.
- **Discard placement:** Discard and the change note live in the tools footer (Preview and
  Brief). On other views the header's Save and unsaved state remain, but discarding means
  returning to Preview or Brief.
- **Astra's concurrent files:** they appeared during this pass and were left unstaged:
  `docs/astra/INDEX.md` (Home read boundary row), `2026-11-04_HomeReadBoundaryReview.md`,
  `jobs/2026-11-04_001f2_home-read-boundaries.md`, `acquisition-before-001i-2026-11-04.jpg` and
  `home-actor-race-2026-11-04.jpg`. They are for a later review.
- **Queued follow-ups, not started:** 003u2, 001h, and the Home false-empty catalog during an
  outage (Astra's 001f2).
- **Scope:** M1 and M2 remain open; all six milestones remain open. No provider, RPC, wallet,
  signing, deploy, push or spending. Searches used `git grep` and `rg` on named tracked paths
  only.
