I found six problems worth fixing in 003f (`2b6dd69`, `197a749`, `96ea61f`). The most serious: when NEAR testnet can't be read, buyers are told the business has no history rather than "unknown", and those listings drop out of search filters. This was a read-only source review: I ran no tests and no git commands. Because I couldn't diff, I can't say which of findings 3–4 already existed before 003f; the job asked for checks after async reads either way.

## Definite source defects (by priority)

**1. A month that can't be read becomes "no history" for buyers.**
- **Where:** `server/src/acquire.ts:780-787`, `:836`, `:901-907`, `web/src/pages/AcquireRoom.tsx:31-36`.
- **Cause:** When the estimate is `unavailable`, `months_used` is empty. So `used=[]` gives `revenue`/`profit = null` and `months = 0`.
- **Effect on the listing:** revenue and profit say "No complete month yet" and history says "No complete month with earnings yet". `min_months` treats 0 as a known value and rules the listing out (`:1089`). `verified_only` drops it. The room says "nothing to reproduce". Only the value line correctly says "Unknown right now".
- **Same result** on a server with no chain connected (`not_connected`).
- **To reproduce:** set M3/M2/M1 `earned` for a named listing that shows revenue and history, then `failPeriods.add(M2)`. `POST /api/acquire/search {criteria:{min_months:1}}` rules it out on months of history. Without the filter, `revenue.text` is "No complete month yet".

**2. Months before the account opened count as complete months with $0 earned.**
- **Where:** `books.ts:461` sets `complete` true for `before_start` months, and `:425-427` gives them revenue 0 with basis `"none"`.
- **Comparison:** `lastTwoComplete` and `compare` (`web/src/finance.ts:131-154`) use those months as a $0 baseline. They can also pair months that aren't next to each other, skipping the first part-month.
- **Chart:** it draws a 1px mint bar, the hover text says "earned $0.00", and the contribution line joins pre-opening `0 − costs` points to real months (`FinanceChart.tsx:60-71, 140-149, 169-186`).
- **To reproduce:** account opened on the 15th of M2, M1 earned $100. Then whole months are `[…, M3, M1]`, and the headline reads "+$100.00 from $0.00 in M3; no percentage from a zero baseline", where M3 is before the account existed.
- **Not affected:** the valuation, because `firstEarning` cuts those months off unless seeded months come earlier. The test at `financials.test.ts:141` checks coverage but not `complete`.

**3. Ending a monthly cost again can bring closed months back.**
- **Where:** `books.ts:273-287`. The select doesn't check `until_yyyymm`, so ending an already-ended monthly cost resets it to `now−1`.
- **To reproduce:** add a monthly cost at N−6 and end it (until = N−1). After the month changes (or set `until_yyyymm = N−4` directly), `DELETE /api/businesses/:id/costs/:id` again: until becomes N−1 and N−3…N−1 are charged again.
- The UI hides the button (`DeskBooks.tsx:355`), so this is reachable through the API or a tab left open across a month boundary. No test covers ending a monthly cost.

**4. Some reads don't recheck who's allowed after waiting on the chain.**
- **`payments.money`** (`payments.ts:626-691`) checks the owner only before its `Promise.all`. It then returns treasury, the order list and customer display names with no recheck.
- **`Valuation.scenario`/`saveScenario`** (`value.ts:463-484`) checks the owner, awaits `inputs()`, then inserts into `value_scenarios`.
  - The scenario list's filter `created_at >= MAX(ownership.at)` (`:491`) means a seller's scenario written after a transfer shows up in the new owner's list.
  - **To reproduce:** delay `chain.period`, start `POST /value/scenarios` as the seller, finish the transfer, then release the read.
- **Lower confidence:** `publicNumbers` checks `share_numbers` before its await (`value.ts:515`). `index`/`candidate` also decide what's disclosed before `facts()` (`acquire.ts:809-810, 1160-1161`).

**5. The charts blend fictional history with observed months.**
- `segments` (`finance.ts:99-110`) breaks only on null, so seeded months and observed months share one contribution line with identical markers (`FinanceChart.tsx:169-186`).
- The lighter seeded bar has no legend entry (`:189-205`).
- `categories()` (`finance.ts:113-125`) adds seeded cost lines into the founder's category totals.
- The job says seeded and observed history must not look like one verified series. The hover text does say "fictional", but the drawing doesn't.

**6. The evidence room hides zero months and can falsely report a mismatch.**
- The room's table drops complete months with $0 revenue and no costs (`AcquireRoom.tsx:425-429`), so a buyer can't tell a real $0 from a missing row.
- The room's reproduce check (`:37-46`) adds up each month's rounded-down cents. The server adds exact amounts (`value.ts:363`). Near a $100 rounding edge the room can show "✗ Differs from the owner's estimate" when nothing changed.

**Minor:**
- `value.ts:363` turns a sum too large to represent into 0 with `?? 0`. This is only reachable above about 9e15 cents.
- In the AI spend section of the Books page (`DeskBooks.tsx:268`), the all-time count of requests with unknown cost sits next to a total for the selected period only (`books.ts:551`).
- `niceScale` gives repeated rounded ticks and duplicate React keys for very small ranges, such as 1¢ (`finance.ts:90`, `FinanceChart.tsx:31`).

## Policy choices and open questions (not defects)

- **Wider buyer access:** buyers with financials access now also see each month's cash flows, including owner withdrawals, sale proceeds and seeded amounts. Grants given earlier under "Monthly books" now cover more than before. That's for Tony and Astra to decide.
- **Corrections change closed months:** marking a closed one-off cost as a correction removes it from that month's figures (tested at `:283`). The row is kept and older snapshots aren't changed.
- **Payments off:** a business without payments shows complete $0-earned months.
- **Wording:** with no chain connected, the estimate still says the books "couldn't be read from NEAR testnet" (`value.ts:100`).
- **Strictness:** any unreadable complete month in the 12-month window stops the estimate, even outside the months it would use.
- **Error text to buyers:** raw RPC errors reach buyers in `chain_reason`. `chain_error` already did this, and the RPC URL holds no key.
- **Backfill:** a monthly cost entered with an old start month adds to every closed month since.

## Checked and sound

- **Conversion and sums:**
  - `unitsToCents` is exact with BigInt for any decimals ≥ 0. An amount too large makes the month unavailable.
  - Multi-month revenue is summed exactly and converted once.
  - Cost entry checks: real month, not in the future, whole cents, at most $1,000,000.
- **Accounting:**
  - `credit_used` is never counted twice; prepayments are cash in.
  - Refunds and returned credit are "returned", not negative revenue.
  - Owner withdrawals and sale proceeds are never costs or income.
- **Unreadable vs zero:**
  - Unreadable or not-connected months carry null revenue, contribution and cash through the server, `money()`, the hatched chart marker, the table, DeskMoney and `payments.money`.
  - The contribution line breaks at null months.
  - `compare` handles zero and negative baselines.
  - `niceScale` always includes zero, and `yOf` can't divide by zero.
- **Valuation:**
  - An outage gives no estimate and saves no snapshot.
  - Buyer and public reads save no snapshot.
  - The first and current part-months are never annualized.
  - Public numbers skip unread months and losses made only of costs.
  - `verified` excludes mixed months.
- **Evidence room:** it uses the owner's month data without cost lines or exact units; cost lines need the costs grant. `withGrant` rechecks access after its reads and before anything is shown or logged.
- **Books and value pages:** `/books` and `/value` recheck the owner after their awaits.
