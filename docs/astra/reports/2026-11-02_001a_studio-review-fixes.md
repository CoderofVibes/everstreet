# Job 001a report: studio review fixes

Builder: Claude. Date: 2026-11-02. Job: `docs/astra/jobs/2026-11-02_001a_studio-review-fixes.md`.
Code commit: `45fc476`. M1 acceptance stays with Astra; nothing here was checked in a browser.

## Changes

1. **Stale revision details (race).** Cause, confirmed in source: after a restore, the effect
   that loads revision details re-ran once with the *old* selection and the new head, started
   a fetch for revision 1, and that response landed after the selection had moved to the new
   head, overwriting it ("This is the current revision" over revision 1's content). Fix:
   `web/src/revisionHistory.ts`, a small reducer used by `VersionsView`. Fetched revisions are
   cached by number (they are immutable), so a response can only fill its own slot; answers
   for another project are ignored; a new head clears the selection; errors are per revision
   and cleared when it is selected again. The detail renders only when the loaded revision's
   number equals the selection.
2. **1280px overflow.** Cause, from the CSS: at 1280 the canvas content box was about 490px,
   the versions grid gave the details column ~177px, and the details' 160px label column plus
   unbreakable content pushed ~90px past it, matching the reported 1357 vs 1265 scroll width.
   Fix in `web/src/styles.css`: the canvas is a size container and Versions, Continuity,
   Checks, the brief document and the prototype frame reflow by the canvas's own width
   (Versions stacks at ≤600px, Continuity at ≤820px, label columns collapse at ≤560px);
   grid children may shrink, detail text wraps, the Restore button may wrap; at ≤1366px the
   step rail moves above the work (giving the canvas ~685px at 1280 by arithmetic). Nothing
   is clipped or hidden; the version list scrolls vertically when stacked.
3. **Check copy.** Step rail: "Test · Brief checks n/7", never marked done. Checks tab badge
   "brief n/7"; heading "Brief checks · n of 7 rules met" with "They do not test a product: no
   build exists yet." Home: Prepare is "A continuity checklist … runtime readiness is not
   verified yet" (Partly); Launch and hand over is Partly ("digital products join later").

## Verification

| Command | Result |
|---|---|
| `npm run format` | no changes needed |
| `npm run check` | lint and types clean; 70 tests passed (9 files; 6 new) |
| `npm run web:build` | built (CSS 33.7 kB, JS 477.0 kB) |

New `web/test/revisionHistory.test.ts` drives the reducer the view renders from: the
reviewed sequence (select 1, restore as 3, revision 1 answers late → shows 3 as current);
two selections answered out of order; no stale content while a revision loads; answers for
another project ignored; per-revision error and retry; selection moves to a new head after a
save but not on a re-render. It tests the state logic, not the DOM: the repo has no DOM test
tooling and none was added.

## Not verified

No browser in this session, so the 1440/1280/390 layouts and the restore sequence in the
real UI are unchecked by me. Widths above are arithmetic from the stylesheet. Astra's browser
acceptance is the check.
