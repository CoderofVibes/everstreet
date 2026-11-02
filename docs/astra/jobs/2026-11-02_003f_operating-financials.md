# M3 financial foundation and visual operating dashboard

**Why (Tony's words):** "The financial performance page is plain too - no charts, graphs,
or anything."

## What the person sees and does

Make the business's performance understandable at a glance and inspectable in detail. An
owner selects a period and sees earned revenue, operating costs, operating contribution,
customer prepayments still owed, available treasury, usage and customer activity where those
records actually exist. A prominent time chart and cost breakdown explain what changed.
The underlying table remains available for precision and keyboard/screen-reader access.

Revenue/profit lines must have real axes, units, legends and meaningful hover/focus details.
Show incomplete months distinctly. Use mint/blue for positive activity, restrained amber/red
for exceptions, and do not rely on color alone. Avoid empty decorative charts or fabricated
growth. Explain an empty business with its next useful action; fictional example history can
be previewed only when clearly identified and separated from observed operations.

Acquirers receive only the granted financial evidence. Private books are not made public by
adding a graph. The evidence view reuses the same correctly scoped metrics and provenance.

## Underneath: checked gaps

Astra read `server/src/books.ts` on Nov 2. It currently reads period `earned`, `refunds` and
`orders_in`, labels all earned amounts "delivered orders", defaults missing chain amounts
to zero, and sums seeded history alongside chain revenue in a month. v2 also has `prepaid_in`,
`credit_used`, `credit_withdrawn`, owner withdrawals and treasury liabilities. Correct these
semantics before drawing charts. Preserve legacy records and their source labels.
Propagate the metric model through `value.ts`, `acquire.ts`, the public-number endpoints,
`api4.ts`/`api5.ts`, DeskBooks, AcquireRoom and PublicPage; fixing the chart while valuation
still coerces missing observations to zero would leave a misleading buyer experience. The
default cost categories and hints should lead with model usage, hosting and online services.

- Separate accrual-like earned activity from cash inflow, customer liabilities, refunds,
  owner withdrawals and sale proceeds. A 100-use prepayment is not fully earned revenue;
  consumption earns its settled portion. Do not subtract a return of unearned customer
  credit twice or call an owner withdrawal an operating expense.
- Keep each metric's currency/asset, precision, period and provenance. Testnet tokens and
  real USD provider cost are distinct units; do not claim real-dollar profit by subtracting
  them. If a demo-equivalent view is useful, label its conversion assumption explicitly.
- Missing, unavailable, not-connected and observed zero must remain distinguishable through
  API, summaries, comparison math and plots. A partial RPC outage should not render a crash
  in revenue, produce a misleading profit or overwrite a prior verified observation as zero.
- Do not aggregate fictional seeded and observed history into an apparently verified series.
  Expose separate series/modes or explicit mixed provenance that cannot be mistaken for
  evidence of actual trading. Imported history later needs its own source.
- Pull runtime costs/usage from the actual M2 ledger when present. Until then show not
  connected, not invented usage. Avoid rounding every sub-cent call to a full cent in totals.
- Comparisons need compatible periods and sources. Do not annualize a partial current month
  as a fact. Explain division by zero, negative baseline and missing-data comparisons.
- Founder-entered costs need valid calendar months (not merely a six-digit range), bounded
  safe amounts and clear recurrence. Keep precise token amounts through aggregation to avoid
  silent Number overflow; convert only within explicit checked display bounds.

Use lightweight repository-native chart components (accessible SVG is sufficient) or justify
a scoped dependency through Claude's normal package ownership. Charts are ordinary app code;
no image generation needed. Integrate existing evidence/access boundaries on every API read.

### Integration review and refinements

Read `../reports/2026-11-02_financial-integration-review.md` as source analysis, then verify
the relevant claims. Coordinate with 003p for disclosure/access fences and 003b for deal
reconciliation; do not implement contradictory financial serializers in parallel.

Astra independently reproduced the missing-month problem through `GET /books`: an in-memory
period fixture reports October 2026 earned revenue of 10,000 cents. Making only that month's
RPC fail changes its revenue/profit/paid-in fields to zero and removes its sources/lines,
while keeping `complete: true`; only a top-level chain_error records the outage. This is a
reproduced API defect, not merely a hypothetical chart risk. No real chain was contacted.

- Correct the test double first: `FakeChain.period` currently repeats lifetime order totals
  for every requested month. Add explicit per-month fixtures, failure injection, prepaid
  inflow/usage/refund amounts and account-start metadata. Tests must distinguish two months.
- v2 `earned` already includes consumed credit; do not add `credit_used` a second time.
  Prepayments are cash in, and unearned refunds/credit withdrawals reduce obligations rather
  than earned revenue. Seller proceeds and buyer escrow are separate from operating cash.
- Carry the new state/unit/source model through `payments.money` and DeskMoney as well as
  the consumers above. No `?? 0` for unavailable financial observations. Do not save a new
  valuation snapshot from an outage, or fabricate a loss on the public page from costs alone.
- Distinguish the first partial observed month, current partial month and dates before an
  account existed. Do not turn either partial month into a factual annual run rate. Preserve
  imported/fictional earlier history as its own source. Future planned costs, if supported,
  must remain forecasts rather than recorded operating activity.
- Build expense is a separate ledger from per-customer runtime cost; default it to a separate
  build-spend view, not operating contribution. USD costs computed from declared provider
  prices and reported tokens are not an invoice. Partial/final usage and conservative budget
  reservations remain distinct. Runtime cost stays not connected until its ledger exists.
- Preserve closed cost history when ending recurrence or removing a current cost. If edits
  to closed records are supported, make the correction explicit and traceable rather than
  silently deleting the event that earlier snapshots used.
- No new public disclosure is implied by adding charts. Share only currently authorized
  fields, with provenance labels and explicit access checks after asynchronous reads.

Prefer a prominent monthly earned/cost chart, an independently labelled cash-flow view,
current obligations/available-money tiles, and a useful category breakdown with the source
table one action away. Separate currencies by default; any demo-equivalent contribution
mode must disclose its conversion directly beside the chart. Do not fabricate historical
treasury snapshots from today's balance or confuse a current stock with a monthly flow.

## Done when

Tests cover prepay/consume/refund accounting, missing vs zero, partial RPC failure, source
separation, partial periods, precision, period validation and revoked/expired evidence grants.
Browser review checks readable 1440/1280/narrow views, keyboard tooltips/table access, negative
values, gaps, zero baselines and an empty business. All 100/20/80 numbers reconcile when the
M3 ledger is available; distinguish existing v2 fixtures from later digital proof.
Run `npm run check` and web build; report exactly which data is observed, fictional or pending.

## Not in this job

No fabricated customers/revenue, market valuation claim, live transaction, deployment or
release. No access to Tony's runtime database; use isolated fixtures. This is an operating
view, not tax/accounting certification or investment advice.

## Priority and size

P0 / M-L. Can start once the current code writer is free; initial chart/accounting work is
independent of live model credentials. Complete runtime/entitlement integration as those land.
