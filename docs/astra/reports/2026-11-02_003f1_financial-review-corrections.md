# Job 003f1 report: financial review corrections

Claude, 2026-11-02. Job: [003f1](../jobs/2026-11-02_003f1_financial-review-corrections.md), from
[003f-independent-review](2026-11-02_003f-independent-review.md) and
[003f-source-review](2026-11-02_003f-source-review.md).

**Commits:**

- `c5f52fd`: server, 17 regressions.
- `ad99167`: UI and rules, 7 new web tests.

**Evidence:** keyless tests and the build only. **Browser and phone checks are Astra's:**
1280, 1440 and 390 widths, the expanded table, keyboard use and outage scenarios. I didn't run a
browser, so the phone-width fix is reasoned from CSS, not measured.

## The five reproduced defects (all through the actual API, each with a control)

| # | Defect | Now | Test |
|---|---|---|---|
| 1 | Ending an ended monthly cost again moved its end date and reopened closed months | An end date, once set, is immutable: ending again is a no-op. Each real end, open-month removal and correction writes its own audit event (`cost.ended`, `cost.removed_open_month`, `cost.corrected`). | M2 and M1 stay 0, the end stays at M3, one `cost.ended` event. With the guard removed this test fails (mutation check). |
| 2 | Months before opening became a $0 comparison baseline | `complete` is true for a before-opening month only when it has (fictional seeded) records. The UI compares the latest whole month with the **adjacent** month and explains when it can't (before opening, partial, unread, fictional against observed). | Server: before-opening and first-partial months aren't complete; seeded history before opening still is. Web: `latestPair` adjacency and every `compare` explanation. |
| 3 | An outage became "no history" in acquisition search | Facts carry `unknown` when the estimate is unavailable (an outage or no chain connected). Revenue, profit and history say "Unknown right now…". `min_months` keeps the listing with the label "History couldn't be read right now (kept, not ruled out)". `verified_only` sets it aside and says why in `hidden`, because verification can't come from missing records. | The control matches with 3 months; with M2 unreadable the listing stays, labelled unknown, never "No complete month"; `verified_only` excludes it with that explanation. |
| 4 | A late money response leaked after ownership changed | New `Store.controlEpoch` and `stillControls` (owner plus ownership generation). Money, books and value check again after their reads and before returning anything private: a former owner gets 404; leaving and coming back gets 409. | Money: former owner 404 and away-and-back 409, both with no treasury or orders; the control returns 200. Books: no months for a former owner. |
| 5 | A denied scenario save still inserted a row | Try and save use the same fence after the read **and** immediately before the insert. | Former owner 404 and 0 rows; away-and-back 409 and 0 rows; control 201 and exactly 1 row. |

## Source-reviewed issues

- **Public numbers** check sharing again after the books are read. If sharing was turned off
  meanwhile, nothing is shown (test).
- **Listing visibility and disclosure** are decided from the listing as it is after the reads:
  index, search and candidate. A listing made anonymous during a search shows its anonymous
  form (test). The seller's mode preview opts out deliberately.
- **Grant scope is versioned.** New grants get `scope_version = 3`: financials covers money in
  and out, owner withdrawals and sale proceeds, with that wording in the category label. An
  earlier grant keeps exactly what it covered: no cash detail, `cash_included: false` and an
  explanatory note (test). The 003p fences are unchanged.
- **Zero months** stay in the buyer's table. The buyer's reproduction uses the owner's exact
  totals (`reproduce.revenue_cents` and `costs_cents`), equal to the estimate's inputs (test).
- **Precision.** An exact total too large to represent makes the estimate unavailable instead
  of `?? 0` (test). Tiny ranges get distinct whole-cent ticks (test).
- **Fictional versus observed.**
  - Separate line segments: a dashed line with hollow points for fictional history (test).
  - A dotted fictional bar and its own legend entry.
  - Fictional costs are totalled apart from the founder's categories (test).
- **Partial months** are labelled "partial: opened mid-month" or "so far". Months before
  opening draw nothing and say "not open" or "before opening".
- **AI spend** gives the selected period and all time separately (`period_*` against
  `total_*`), labelled in the UI (test).
- **Outage wording** now covers "not connected" and amounts that can't be shown exactly.
- **Phone width.**
  - Charts sit in a keyboard-reachable sideways-scroll region with a 560px minimum drawing
    width, so 11px labels render at about 9.6px or more instead of about 5px.
  - The source tables sit in their own scroll region.
  - `.desk > *` and the books card get `min-width: 0`, so a wide table can't widen the page.

## Not changed (policy, per the reviews)

- A closed one-off correction still changes the corrected books. It's explicit, kept in the
  record and now audited.
- With no payments, months stay complete with $0 earned (the source review's open question).
- Any unreadable complete month stops the estimate.
- Buyers still see raw RPC reason text.

## Checks

- `npm run check`: lint, types, 30 files / 343 tests passed.
- `npm run web:build`: passed.
