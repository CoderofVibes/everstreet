# Job 003f report: operating financials

Claude, 2026-11-02. Job: [003f](../jobs/2026-11-02_003f_operating-financials.md), with
[financial-integration-review](2026-11-02_financial-integration-review.md) as source analysis;
I verified each claim against the code before changing it.

**Commits:**

- `2b6dd69`: server semantics through every consumer, chain double, 18 tests.
- `197a749`: charts and views, finance rules, 6 tests.

**Evidence:** keyless unit and integration tests and the build. **Browser review (1440 and
1280 widths, narrow, keyboard, tooltips) is Astra's.** I didn't run a browser.

## What is observed, fictional or pending

| Data | Status |
|---|---|
| Earned, cash in, returned, owner withdrawals, sale proceeds | **Observed** from the business contract's monthly ledger on NEAR testnet (test dollars) when it can be read. In tests: the `FakeChain` double with explicit per-month fixtures, not testnet. |
| Seeded history | **Fictional.** Its own series, never added to observed months; a month with both is flagged `mixed`. |
| Founder costs | **Founder supplied** (US dollars). |
| Today's balances | **Observed now** (current stock, never a monthly figure); unreadable means unavailable. |
| AI runtime and build spend | **Computed** from the platform's own ledgers (reported tokens at declared prices, microcents). Not an invoice; unknown-cost requests are counted, not zeroed. |
| 100/20/80 end to end | **Pending the M3 ledger.** The mapping is proven with v2 period fixtures, not a live digital purchase. |

## Semantics (server, `books.ts`)

**Earned.** Each month's chain state is `observed`, `unavailable` (with the reason),
`not_connected` or `not_applicable`. Revenue is null whenever it isn't known, and so is
contribution.

- `earned` already includes used credit; `credit_used` is never added a second time.
- Prepayments are cash in. Refunds and credit withdrawals are returned money, not negative
  revenue.
- Owner withdrawals and sale proceeds are cash events, never costs or income.

**Coverage.** Each month is `complete`, `first_partial` (the account opened after the 1st),
`current_partial` or `before_start`. Only complete months feed comparisons and the estimate.

**Exact amounts.** Conversion from base units to cents uses BigInt and works for any decimals,
including below 2. An amount too large to show exactly makes that month unavailable. Multi-month
revenue is summed in base units and converted once, so sub-cent months add up correctly.

**Costs.**

- Entry needs a real calendar month (no 202513, 202500 or future months), whole cents and at
  most $1,000,000.
- Ending a cost never rewrites a closed month: a monthly cost stops after last month; a one-off
  in a closed month is kept and marked as a correction (`voided_at` and `void_note`; a new
  column, existing rows untouched).
- Digital categories come first: AI model usage, hosting, online services and APIs. The older
  categories stay valid.

**Consumers carried through:**

- **Valuation.**
  - An unreadable complete month stops the estimate: a new `unavailable` stage, its gaps named,
    "not counted as zero", and **no snapshot**.
  - The first partial month is never annualized.
  - Revenue sums are exact.
  - Buyer and anonymous reads write no snapshot.
- **Public numbers** show only the latest whole month with known, earned revenue. They never
  show an unread month or a loss made of costs alone, and say "contribution" with the
  test-dollar basis.
- **Acquisitions.**
  - Facts use the same months.
  - `verified` only when every month used is observed and unmixed (`verified_only` now
    excludes mixed months).
  - Averages are null when unknown.
  - The evidence room reuses the owner's month serializer (`financialMonth`, without cost
    lines) and the units basis, behind the existing 003p fence.
- **Payments money view** adds prepaid in, credit used and credit withdrawn, sale proceeds,
  buyer escrow and seller proceeds, and explicit read states. No `?? 0`.
- **The books endpoint** adds a period choice (1–24 months), today's balances, the two model
  spend ledgers, the basis text, and an owner recheck after its awaits.

## Views

`finance.ts` holds the tested rules. `FinanceChart.tsx` holds the SVG charts.

**DeskBooks:**

- a period selector;
- balance tiles: owed to customers, available, withdrawable, and "not business money" for
  escrow and proceeds;
- the latest whole-month comparison, which explains missing, partial, zero and negative
  baselines;
- the earned/cost/contribution chart;
- a separate cash in/out chart;
- costs by category;
- every figure with its source in a table one click away;
- AI spend from Everstreet's records;
- a cost form for any valid month, showing recurrence ("every month from … (ongoing)") and
  corrections;
- an empty business explains the next step (turn on payments, add costs); no empty charts.

**Chart conventions:**

- Unread months are hatched, labelled "?" and named "couldn't be read". Months in progress are
  outlined and labelled "so far". Seeded history is lighter.
- The contribution line breaks at gaps and negative points are marked.
- Each month is a keyboard stop with all its figures in its label, plus a live detail line and
  a written legend.
- Colour is never the only signal. Units are on the axis: US dollars, test dollars 1:1.

**Other views:**

- The evidence room shows the same charts and table from the scoped data.
- DeskMoney shows "couldn't read" instead of $0.

## Tests

`server/test/financials.test.ts` (18):

- two months read separately;
- 100/20/80: prepay is cash in (earned 0), used credit earns once (20, not 40), withdrawn
  credit is returned;
- a refund isn't subtracted from earned;
- withdrawals and proceeds aren't costs or income;
- an unreadable month is unavailable with null revenue, profit and cash and a reason, while an
  observed zero stays 0;
- not connected and before the account (with first-partial coverage);
- an outage gives no estimate and no new snapshot;
- the public page skips the unread month and the costs-only loss, and writes no snapshot;
- the first partial month isn't annualized;
- seeded plus observed: no sum, flagged mixed, excluded by `verified_only`;
- exact conversion: three months of 0.4¢ give 1¢, 2^60 units stay exact, 10^30 is refused,
  decimals 0 and 1 work;
- an amount too large to show makes the month unavailable;
- cost validation: 202513, 202500, 199912, next month, over $1M and fractional cents are all
  refused;
- a closed one-off is corrected, not deleted, while a current-month cost is removed;
- digital categories come first;
- balances are a current stock with escrow and proceeds apart, and unreadable shows null and
  unavailable in both books and money;
- runtime spend is exactly 150,000 microcents, apart from build spend;
- a buyer sees the owner's figures and states with no cost lines and the basis, and revocation
  ends reads.

`web/test/finance.test.ts` (6) covers:

- unknown shown as a dash;
- the axis includes zero and negatives;
- an empty or all-zero axis;
- the contribution line breaks at gaps;
- every comparison case;
- category totals.

## Checks

- `npm run check`: lint, types, 29 files / 319 tests passed.
- `npm run web:build`: passed, 63 modules (bundle-size advisory only).

## Not done / for review

- **Browser:** check readability at 1440, 1280 and narrow widths, keyboard focus on chart
  points, negative values, gaps, zero baselines and the empty business, in a browser.
- **The M3 customer ledger isn't built yet.** Runtime spend is shown apart from operating
  costs. Fulfilled customer use against provider compute isn't reconciled.
- **No fictional preview mode.** Seeded history is shown and labelled, but there is no
  separate "fictional example" toggle with a watermark.
- **Planned/forecast costs aren't supported.** Future months are refused.
- **Owner-entered "AI model usage" costs and the runtime ledger are separate.** A founder
  could enter the same spend twice. The category hint says so; there is no automatic
  deduplication.
- **The estimate's revenue is exact.** The per-month cents shown in the table are rounded down
  per month; the exact base units are kept on the server.
