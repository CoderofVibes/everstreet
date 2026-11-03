# 004a2 report: clear private import state when access ends, and fence late answers

Claude, 2026-11-03. Job: [004a2](../jobs/2026-11-03_004a2_import-access-invalidation.md). Commit
`f1d682a`.

**Files:** `web/src/importWorkspace.ts` (new), `web/test/importWorkspace.test.ts` (new),
`web/src/pages/Import.tsx`. No server, contract or other product changes.

## The defect

Astra reproduced it in the browser: ownership moved during an inspection, the server correctly
answered 404, and the page kept the workspace, facts, drafts and report.

The cause is in the source. Only the page's `load()` reset state on a 404; the inspection, save and
report callbacks each handled failures themselves and didn't reset. Two source concerns from the
review also hold:

- After `load()` cleared the view, an older successful answer could be accepted again, because an
  empty view counted as "fresh" and `alive` stayed true.
- A different `owner_epoch` was accepted from any answer, in either direction.

## The change: one controller owns the lifecycle

`WorkspaceController` (`importWorkspace.ts`) holds the workspace's view, details and dependency
drafts, the manifest being prepared, the inspection attempt and the saved-report selection. It
issues every request. The page renders its state through `useSyncExternalStore` and holds none of
its own. The route is still keyed by person and workspace, and leaving the page calls `dispose()`.

- **Scope.** Each request captures the scope number when it starts. These all retire it:
  - access loss;
  - a new control epoch;
  - leaving the page.

  A retired request's success, failure, file read or saved-report result is dropped. It can't
  restore anything or clear newer input.
- **Access loss, one path.** A 404 from an inspection (new or recovered), a details save, a
  dependency save or a saved-report read triggers a guarded workspace read.
  - If that read is 404, `lost()` retires the scope and clears the view, every draft, the manifest,
    the attempt and the snapshot. The page then shows only "This import is no longer available…",
    with no editing controls; every action is a no-op because there is no view.
  - A 404 from `load()` itself does the same.
  - No error text is parsed: the distinction comes from the guarded read.
- **A missing saved report** (404, but the workspace read succeeds) shows "Report N doesn't exist."
  Drafts and the view stay.
- **Control epochs.**
  - Only an explicit read (`load` or the guarded read) may move to another epoch. A write answer
    naming another epoch is never shown; it starts an explicit read instead.
  - A read naming an older generation than the one shown is ignored.
  - A newer generation retires the scope and drops every draft, including away and back, where
    the same person owns the business again.
- **Within one valid epoch** the 004a1 counter merge, typed-ahead rebasing, conflict handling and
  the lost-inspection recovery (same key and file) are unchanged.

## Tests (`web/test/importWorkspace.test.ts`, 12)

The tests drive the controller the page uses, with a scripted API whose every call waits until the
test answers it, in any order.

| # | Scenario | Result |
|---|---|---|
| 1 | Inspection 404, then the guarded read 404 | Everything private cleared; later inspect and save send nothing |
| 2 | Details save 404 and dependency save 404 | Cleared the same way |
| 3 | Report 404 with the workspace still visible | "Report 7 doesn't exist." Drafts and view kept |
| 4 | Report 404 with the workspace read 404 | Cleared |
| 5 | A delayed old save success after a newer denial | Nothing restored; a late file read and a late report are also dropped |
| 6 | Two reads; the newer epoch answers first and the older last | The newer is kept |
| 7 | A read started after the change answers with an older epoch | Ignored |
| 8 | Away and back (`mara:0` → `mara:2`) | Drafts and manifest dropped; text typed afterwards survives the old save's late answer |
| 9 | A write answer naming another epoch | Not shown; explicit read; a 404 there clears |
| 10 | Typed-ahead text and a lost inspection while valid | Recovered with the same key and file; typed text kept |
| 11 | Two dependency saves answered in reverse | Both stay shown; both rows "saved" |
| 12 | A 404 that isn't access loss ("No such item", workspace visible) | Drafts kept; shown as a refusal |
| 13 | Leaving the page | Retires the save in flight |

(Rows 3 and 4 are one test, as are rows 1 and its follow-up.)

**Mutation checks** (each reverted):

| Mutant | Tests failing |
|---|---|
| Access loss keeps the cached view and only adds a message (the old behaviour) | 5 |
| Older generations allowed to win | Test 7 |
| No scope checks after a details save's answer | 4 |

The older-generation mutant at first went uncaught: scope retirement already dropped the stale
read in test 6. Test 7 was added so the epoch check itself is exercised.

## Commands

```
npx vitest run web/test/importWorkspace.test.ts  → 12 passed
npm run check        Test Files 34 passed (34); Tests 385 passed (385)
npm run web:build    built (existing chunk-size advisory only)
```

## Still needs Astra's browser repeat

- The original reproduction: ownership moved during an inspection. The page should show only "no
  longer available", with no facts, drafts or report.
- The same during a details save, a dependency save and a saved-report read.
- A missing report while access holds.
- Away and back.
- The 004a1 draft and recovery paths, again.

I didn't use a browser. The page wiring (`useSyncExternalStore`, the effect that loads and
disposes) is covered by type-checking and the build, not by a DOM test.

M4 stays open.
