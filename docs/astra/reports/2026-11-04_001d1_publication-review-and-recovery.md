# 001d1 report: exact review binding and editor recovery

Claude, 2026-11-04. Job: [001d1](../jobs/2026-11-04_001d1_publication-review-and-recovery.md).
Commit `a3ba11c`, on top of `78cfb1d` (Astra's seven files). Not pushed or published. No
contract, `main.ts`, package, provider or remote change. The design is updated in
[DIGITAL_PUBLICATION.md](../../design/DIGITAL_PUBLICATION.md), "Corrections in 001d1".

## Reproduced first

`server/test/publication-review.test.ts` follows Astra's recipe with the actual build, evaluation
and release routes (bounded fixture providers):
- **Steps:** review a profile showing "Invoice reader", release a version named "A different
  unreviewed public product name", then publish the reviewed draft revision.
- **Before the fix:** 200, publishing the unreviewed name, in 73 ms.
- **Missing pieces:** no review identity requirement, and no `live_outdated` signal.

## Fixed

- **Review identity.**
  - The owner view returns `review`: a sha256 of the draft revision plus the exact public
    snapshot, including each product's name and family and the release it came from.
  - Publish needs `{ draft_rev, review }`. Without it: 400 `review_required`. If the snapshot
    changed: 409 `review_changed`, and nothing goes live.
  - The stored live snapshot is the reviewed one.
- **"Already"** now means the live content equals this review. After a release change, the same
  draft revision can be reviewed again and republished (tested).
- **Content versus availability.**
  - Live names and text are immutable.
  - A Use target appears only while an active offer exists **for the reviewed release**. An offer
    for a newer release is never attached to the older reviewed name, so the product reads
    "Released, not open for use yet" until republished.
  - The owner sees `live_outdated` and a notice explaining it.
  - Snapshots from 001d without a release id still match by project.
- **Editor.** These were source findings. Each is now a tested pure helper used by the editor.
  - **Typed-ahead text** during a save is kept (`afterSave`). The old code replaced the local
    draft with the saved one unconditionally. The message says those edits aren't saved yet.
  - **Saved message:** it names the version and, if one is live, says the public page still shows
    that version. It no longer says "nothing is public yet".
  - **Take down:**
    - it marks the editor busy;
    - a refusal (4xx) is shown as such;
    - a network or server failure is "uncertain", never success;
    - the state is always re-read afterwards.

    It is retry-safe on the server: a repeated take-down returns 200. A former owner gets 404
    and the page stays up (tested).
  - **Reply ordering:** save and publish replies invalidate any older view read in flight
    (`latestLoader.invalidate`, tested).
  - **The product picker** shows the released public name, its state, and the private brief name
    beside it, from a bounded owner-only `choices` list.
- **Lint:** the `useMathMinMax` warning in `performance-disclosure.test.ts` is fixed. Lint now
  reports no warnings.

## Checks

- `npm run check`: **896 tests in 91 files**. Lint, with no warnings, and types are clean
  (887/90 before).
- `npm run web:build`: passes (791.64 kB, the existing size advisory).
- **Mutants**, one at a time and each restored. All 5 were killed:
  1. review identity unchecked;
  2. Use targets matched by project;
  3. "already" ignoring content;
  4. typed-ahead overwritten;
  5. `invalidate` as a no-op.

## Limits

- **Not browser-verified:** the editor's typed-ahead, take-down and ordering behaviour is covered
  by pure-function tests and server tests, not by an interaction run. Astra's earlier stalled
  take-down browser step was not repeated here.
- **Earlier take-down behaviour:** the old editor silently ignored the result; that was confirmed
  from source, not reproduced in a browser.
- **All six milestones stay open.**
