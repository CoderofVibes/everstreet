# 001i1 Current sale evidence: report

Claude, 2026-11-04. Job: [001i1](../jobs/2026-11-04_001i1_current-sale-evidence.md). Code `995fca3`.
Design: "The current sale (job 001i1)" in `docs/design/ACQUISITION_WORKSPACE.md`.

## Reproduced first, on the dfeecae rules

Five new tests in `web/test/saleView.test.tsx` all failed before the fix. They drive the real `OwnerHandover` over the real API:

- **The first sale.** Ava records deal 1 → the contract fixture shows it closed → Ava checks the outcome and applies it → Ava's page is gone → Noah opens the workspace as the new owner.
  - With no live deal, the sentence said "Deal 1 was applied here: the buyer manages the business." Record, close and apply showed Completed.
- **Deal 2.** A synthetic deal 2, labelled, is built on the closed fixture: seller `buyer.near`, buyer `third.near` (a fictional person, linked), proposed, nobody accepted.
  - The server observed it, but the sentence still described deal 1, and record/close/apply showed Completed while the action offered Review.
- **Versions 1 and 2 of deal 1, both recorded.** The action checked version 1's outcome. The list puts version 2 first, so this was not ordering luck: version 1 won because it was the first recorded status found.
- **Paused, and terminal history.** Paused evidence with an applied history said "applied". Terminal history alongside a live deal 2 made close and apply Current.

## Fix

`saleCurrent` resolves the current sale once:

| Kind | When |
|---|---|
| unavailable | paused or unbound; a pending record is mentioned, never counted |
| unread | nothing read yet |
| live | the shown deal; its record is the intent with the same sequence, version and digest, anywhere in the list (a precedence rank breaks duplicates) |
| pending | no live deal, plus the newest recorded intent by deal then version, never by list order |
| none | no live deal and nothing pending |

- **Shared by everything on the page.** `saleSteps`, `saleNext`, `saleSentence`, the page's "recorded below" note, and the list's new "Current sale" / "History" labels all read this one result.
- **No-live-deal wording.** It reads "No sale is in progress at block H" (with "(stale)" or "(flagged)" when that applies). A pending record says its outcome is unknown and must be checked.
- **Unchanged:**
  - the recovery priority order (Check access, Recover, Try again, Selling, none, Record);
  - per-intent reconciliation (an older recorded version keeps its own outcome check in the list);
  - the controller, the server and the authority protocol.
- **Behaviour change.** A live deal with a reading problem and only an older record now offers "Read the contract again" rather than the older record's outcome.

## Checks

- **Coverage.** The five tests cover all of these, with every synthetic construction labelled:
  - applied deal 1 then proposed deal 2, with no live deal in between: sentence, steps and action agree;
  - recording deal 2 (Lena linked) points the outcome at deal 2's intent;
  - the same answers in either list order;
  - versions 1 and 2, with the exact match second in the list;
  - with the live deal removed, version 2 is pending;
  - paused with a pending record: blocked, waiting, mentioned;
  - paused and stale evidence with an applied history;
  - ended and superseded history with and without a live deal.
- **Mutants.** 4 were killed: matching by sequence only, pending chosen by list order, any applied intent completing the close, and a pending record counted while paused.
- **Unchanged checks still pass:** no close is completed from a recorded intent alone, seller access ends on apply, and the continuity groups and recovery behave as before.
- **Full run.** `npm run check` gave 1087 tests in 110 files, with lint and types clean. `npm run web:build` passed at 844.27 kB, with the existing size advisory.

## Limits

- **Not browser-verified.** I had no browser tool. For Astra:
  - the "Current sale" / "History" pills at 390px;
  - a second-sale run in the preview, which needs a deal-2 control the preview doesn't have; this job didn't add one.
- **Synthetic only.** Astra's approved first-sale browser repeat is synthetic, as is the deal 2 here. Neither is live NEAR or the 100/20/80 gate.
- **Still open.** The 001i room, zoom and reduced-motion gates and all six milestones remain open. 001j and 003v are not started.
