# 003f integration review: operating financials (read-only, source analysis only)

I didn't execute anything, so none of this is test evidence. The working tree has uncommitted `server/src/build.ts` and `server/src/db.ts` from the active writer. I treated the build ledger as still changing.

The biggest problems:
- **Partial outage reads as zero.** If one month's chain read fails, that month shows as zero revenue. That can change the value estimate, write a snapshot, and show a loss on the public page.
- **Mixed months count as "verified".** Fictional seeded revenue and testnet revenue are added together in the same month, and any month that includes chain revenue is treated as "verified" by the buyer filters.
- **Sale terms bypass grants.** Proposed sale terms copy revenue, profit and customer money into what the buyer sees, whatever the buyer's grant is (even revoked or never granted).
- **The test double can't test multi-month books.** `FakeChain.period` ignores the month, so it has to be fixed before any multi-month test means anything.

## 1. Data contracts and consumers that must carry missing-vs-zero and source separation

| Producer | Consumers | What changes |
|---|---|---|
| `Books.months()` `server/src/books.ts:169` | `GET /books` (`app.ts:376`), DeskBooks; `GET /value` (`app.ts:389`), Value.tsx | Main contract: per-month state, units, separate series |
| `Valuation.inputs/current/publicNumbers` `value.ts:278,349,475` | Value.tsx; `GET /api/public/businesses/:slug` (`app.ts:256`), PublicPage.tsx:415-445 | Don't estimate or snapshot from unavailable months; public month can't be an artifact of an outage |
| `Acquisitions.facts()` `acquire.ts:729` | `index` (search, compare, listing preview), `candidate`, `room`, `exportRoom`, AcquireRoom.tsx | Revenue, profit, "verified" and history figures |
| `Deals` terms `deals.ts:202-236` | Deal terms digest, buyer acceptance | Embeds `revenue_month`, `profit_month`, `customer_money` (privacy, see §3) |
| `Payments.money()` `payments.ts:625-677` | DeskMoney.tsx:141-177 | Missing month fields; `?? 0` in the UI turns unknown into $0 |
| `Acquisitions.operations()` treasury `acquire.ts:1504-1521` | Room "operations", deal terms | Loses precision when converting; scope question |
| Web types `api4.ts:5` `Month`, `api5.ts:150` `RoomMonth`/`Room`, `api.ts:142` `numbers` | The pages above | Must carry state and unit, not bare `*_cents: number` |

**Smallest new contract.** One chain RPC returns the whole month, so chain state is tracked per month, not per field.

```ts
type Unit = "test_token" | "usd";            // never summed with each other
type Provenance = "chain_testnet" | "founder" | "seeded_fictional" | "computed_declared_pricing";
type Amount = { base: string; unit: Unit; decimals: number };   // exact integer string
type ChainMonth =
  | { state: "observed"; period: Record<keyof Period, Amount>; read_at: string }
  | { state: "unavailable"; reason: string }          // RPC failed for this month
  | { state: "not_connected" }                        // account exists but no chain configured
  | { state: "not_applicable" };                      // before the account existed
interface LedgerMonth {
  yyyymm: number; label: string;
  coverage: "complete" | "current_partial" | "first_partial" | "before_start";
  chain: ChainMonth;
  seeded: { revenue: Amount; note: string } | null;          // separate series, never merged
  costs: { direct: Amount; overhead: Amount; lines: CostLine[] };  // usd, founder/seeded
  build_spend: { state: "final" | "incomplete" | "not_connected"; amount?: Amount } ;
}
```

An observed zero is just `observed` with `"0"`. Keep `months()` as a thin adapter only until every consumer is moved over, and make it return `null`, not `0`, for unavailable revenue.

## 2. Current financial and accounting bugs

**Missing data reads as zero**
- **A failed month becomes zero.** `books.ts:186-195`: if one month's read fails, the month is left out of `fromChain`. It then renders as zero revenue with no source. `chain_error` is a single string where the last error wins, so the row can't tell it failed.
- **No chain configured, no error.** `books.ts:178`: if the account exists but `chain` is null, every month silently reads as zero and `chain_error` stays null.
- **The outage then spreads into the estimate:**
  - `value.ts:286` uses `revenue_cents > 0` to find the first earning month, so an outage changes the stage and `months_used`.
  - `value.ts:354-368` saves a snapshot from that data, so `whatChanged` reports a drop that never happened.
  - `publicNumbers` (`value.ts:478-484`) can pick a month with costs only and show a public "profit" loss. It also writes a snapshot on an anonymous GET.

**Prepaid inflow, used credit, refunds**
- **Cash in is understated.** `books.ts:191`: `paid_in` reads `orders_in` only and leaves out `prepaid_in`. `credit_withdrawn`, `owner_withdrawals` and `sale_proceeds` are dropped completely.
- **Earned already includes used credit.** The contract adds `credit_used` into `earned` (`contracts/business-v2/src/lib.rs:395-398`). Reading `earned` alone is right; any new "earned + credit_used" double counts. The label "Earned from delivered orders" (`books.ts:212`) is wrong once credit is used.
- **Refunds aren't contra-revenue.** Refunds only apply to `Paid` orders that weren't delivered (`lib.rs:720-726`). They reduce what's owed to customers and must never be subtracted from earned revenue. Label them "returned before delivery".
- **Refunds and withdrawals are booked at settlement.** They land in the month of the callback (`lib.rs:444-447`), not the month the order was placed.

**Withdrawals and proceeds**
- **These are correct today, but the new model must keep them separate.** Books ignores both, which is right:
  - Owner withdrawals are payments to the owner, not an operating expense.
  - `sale_proceeds` is booked in the business's month at close (`lib.rs:792`). It's the seller's money from the sale, not business income or cash in. Show it as an ownership event only.
- **`money()` misses fields.** `payments.ts:661-675` leaves out `prepaid_in`, `credit_used` and `credit_withdrawn` for the month, and leaves out `deal_holds` and `seller_proceeds` from the treasury. `held` includes buyer escrow, so never present `held` as the business's money.

**Unsafe conversions**
- **Sub-cent amounts are lost.** `Number(BigInt(x) / 10n ** BigInt(decimals - 2))` appears at `books.ts:181,189-191`, `payments.ts:62-68` and `acquire.ts:1507-1508`. It rounds down each month before adding, so sub-cent activity disappears.
- **No safe-integer check.** Very large amounts aren't checked before conversion to `Number`.
- **Small `decimals` crashes.** A token config with `decimals` below 2 throws `RangeError`.
- **Fix:** add up exact `BigInt` base units and convert only for display, inside checked bounds.

**Units**
- **Profit mixes test tokens and dollars.** `books.ts:246` computes "profit" as test-token earnings minus founder-entered USD costs, shown as `$` on DeskBooks and PublicPage. That subtraction is only honest on a labelled "test dollars counted 1:1" demo basis.

**Source separation**
- **Seeded and chain revenue are summed.** `books.ts:206-233` adds both in the same month.
- **Mixed counts as verified.** `acquire.ts:746` sets `verified` if any source includes chain. So mixed fictional-plus-testnet history passes `verified_only` (`acquire.ts:1035`) and is described as "includes revenue verified on NEAR testnet" (`acquire.ts:850`).

**Partial months**
- **The account's first month counts as complete.** `books.ts:242` uses `complete: m < now`, so an account created on the 28th gives a full "complete" month. `value.ts:331` then annualizes it.
- **Months before the account read as 0.** They should read as not applicable.

**Cost entry**
- **No amount bound.** `books.ts:105` has no upper limit, so sums can reach `Infinity`.
- **Month validation is loose.** `books.ts:108` accepts `202500` or `202613`.
- **Closed history gets deleted.** `endCost` (`books.ts:135-139`) DELETEs one-off costs in closed months. That contradicts its own comment ("History stays for months already closed") and rewrites past snapshots.

**Test double**
- **`FakeChain.period` ignores the month.** `server/test/fake-chain.ts:204-217` returns lifetime totals for every month, and prepaid/credit are always 0. Every multi-month chain test would be wrong. Fix this first.

**Out of 003f's reach**
- **No credit methods in the app.** The `Chain` interface (`chain.ts:89-201`) has no prepay, use-credit or withdraw-credit methods. 100/20/80 can be tested in the books mapping with fixtures, but can't be shown end to end until a Claude NEAR job adds those methods.

**UI**
- **Load errors are swallowed.** `DeskBooks.tsx:36` catches load errors silently, so the card stays blank.
- **Unknown shows as $0.** `DeskMoney.tsx:147-177` uses `?? 0`.

## 3. Privacy leak paths

1. **Sale terms bypass the grant.** `propose` only requires a request that wasn't declined or withdrawn (`deals.ts:289-294`), so pending, revoked and expired requests all qualify. Terms then embed revenue, profit and customer money from `facts` (`deals.ts:227-234`), whatever was granted.
   - **Fix:** include figures only under an active `financials` grant; otherwise put "Not shared". Show the seller exactly what goes into the terms.
   - This overlaps 003a's close characterization, so coordinate with that writer.
2. **The calculation reveals undisclosed figures.** In `candidate`, if only `value` is disclosed, the calculation is still shown (`acquire.ts:1131-1138`). Its explanation lines include revenue, direct costs, overhead and operating profit (`value.ts:111-115`), even when revenue and profit weren't disclosed. Fix: drop those lines, or require all three disclosures.
3. **The operations grant exposes treasury figures.** `acquire.ts:1436,1504-1521` shows customer money and available balance under the "operations" category, which is described as "Owner work, helpers, customer promises". Move them under financials, or say so in the category label.
4. **Data can outlive a revoked grant in the browser.** The server checks the grant on every request (`grantFor`), but nothing sends `Cache-Control` (no matches in `server/src`). AcquireRoom loads once (`AcquireRoom.tsx:244`) and never re-checks.
   - **Fix:** send `no-store` on room, export, try, scenarios, books and value.
   - **Fix:** re-check on `visibilitychange` and clear charts on a 403.
   - Any new series endpoint must go through `grantFor` and the same scoping function. No second serializer.
5. **Buyer scenarios keep the seller's inputs.** `acquire.ts:1696` saves the full `Estimate` (revenue, costs, months) into rows the buyer owns. Today they're only readable through the gated room, but any future buyer workspace view or chart would leak them. Store only overrides plus low/high.
6. **Sorting leaks exact asking prices.** Anonymous listings sort by exact `asking_cents` (`acquire.ts:1057-1061`), which reveals the order inside a band. Sort by the band's low value.
7. **Minor:**
   - `whatChanged` after a transfer compares the previous owner's labor figure (`value.ts:373-408`).
   - Listings disclose revenue and profit by default (`acquire.ts:577`); that's a product decision for Tony.
   - The public page must stay at its current scope (one month plus the estimate). Closing a sale resetting `share_numbers` (`deals.ts:648`) is correct.

## 4. Smallest metric model and chart set

**Metrics.** Each is computed within one unit and one source; nothing is summed across fictional and observed data.

| Metric | Formula | Unit / source |
|---|---|---|
| Earned | `earned` | test dollars, chain |
| Cash in | `orders_in + prepaid_in` | test dollars, chain |
| Returned before delivery | `refunds + credit_withdrawn` | test dollars, chain |
| Owner withdrawals | `owner_withdrawals` (payment to owner) | test dollars, chain |
| Owed to customers now | `unearned_orders + customer_credit` (current only; no history unless every month is observed) | test dollars, chain |
| Available / withdrawable / pending payouts | treasury | test dollars, chain |
| Buyer escrow, unclaimed seller proceeds | treasury | shown apart as "not business money" |
| Operating costs | direct + overhead | USD, founder or seeded |
| Build spend | — | USD, computed from declared prices × reported tokens (`build.ts:125`), "incomplete" unless `usage_final` |
| Demo contribution | earned − costs | only when both are present; labelled "test dollars counted 1:1, not real profit" |

**Owner Books view**
1. **Monthly bars:** earned next to operating costs, on a dollar axis titled with the 1:1 demo basis. The contribution line breaks at gaps.
   - Unavailable months: a hatched "couldn't read" marker.
   - Not-applicable months: "—".
   - The current month: outlined as partial.
2. **Cash and obligations flows:** cash in above the axis, returned and withdrawals below, with distinct patterns. Sale proceeds appear as an event marker.
3. **Stat tiles** for the current treasury values.
4. **Cost breakdown** by category, with build spend as its own row.
5. **Accessible table:** every cell's state and source. Charts are SVG with keyboard focus points, and shown through patterns and labels, not color alone.

**Rules**
- **No run-rate for the current month.**
- **Comparisons only between complete, observed, same-source months.** Say why when the baseline is zero, negative or missing.
- **Fictional history is a separate mode with a "Fictional example" watermark.** It's never mixed into observed data.

**Buyer room:** the same component with scoped data (financials → monthly bars; costs → breakdown; customers → counts).
**Public page:** no new chart.

**Corrections to the 003f spec**
- **Prepayment is already handled.** `earned` doesn't include a prepayment until it's used, so "a 100-use prepayment is not fully earned" is already true on-chain. The real risk is double counting `credit_used`.
- **"Real USD provider cost" is computed, not billed.** It's declared price × reported tokens, not an invoice. Label it that way.
- **Build spend isn't an operating cost.** It's one-time spend on the "build" ledger (`builds.ts:11-12`). Keep it out of contribution by default. Who bears it is a question for Tony.
- **The runtime ledger doesn't exist yet.** Show it as not connected.
- **"Imported history needs its own source" holds.** Give imported history its own source value now.

## 5. Tests and rollout slices (all keyless, in memory)

| Slice | Contents |
|---|---|
| 0 | FakeChain: per-month periods, prepay / use-credit / withdraw-credit helpers, `failPeriod(yyyymm)`, backdated `created_at` |
| 1 | `books.ts` ledger model with BigInt sums, cell states, coverage, separate series; adapter for old consumers |
| 2 | Move consumers over: `value.ts` (no estimate or snapshot with unavailable months; first partial month excluded; strict `verified`), `acquire` facts/index/room/compare, `publicNumbers`, `payments.money` |
| 3 | Privacy: `no-store` headers, gate the candidate calculation, decide treasury scope, minimal buyer scenarios, band sort. Deal-terms gating goes in after 003a, coordinated with that writer |
| 4 | Web: SVG chart module (pure scale/format functions), DeskBooks, AcquireRoom, PublicPage labels, DeskMoney nulls |
| 5 | Read-only build-spend adapter, after 002a1 commits |
| 6 (optional) | Persist observed complete months. They don't change once closed, apart from late payout callbacks, so add a grace window. This cuts the N×12 RPC calls per search. |

**Tests that matter**
- **100/20/80:**
  - Prepay 100 → cash in 100, earned 0, owed 100.
  - Use 20 → earned 20 (not 40), owed 80.
  - Withdraw credit 80 → returned 80, earned unchanged.
- **Refunds, withdrawals, proceeds:**
  - Paid 35 then refunded → earned 0, nothing subtracted.
  - Withdrawals and proceeds never appear in costs, earned or contribution.
- **Missing vs zero:**
  - A failed month → `unavailable`, contribution null, no snapshot, public month not that one.
  - An observed zero → `"0"`.
  - Chain null with an account → `not_connected`.
  - A month before the account → `not_applicable`.
- **Partial months:** the first partial month is excluded from valuation; the current month is never annualized.
- **Source separation:** a mixed month → two series and `verified=false`, and `verified_only` excludes it.
- **Precision:**
  - Sub-cent amounts across 3 months add up correctly.
  - Values above 2^53 base units stay exact.
  - `decimals` below 2 doesn't throw.
- **Cost validation:** reject `202513`, `202500`, future months and oversized amounts; closed one-off costs survive `endCost` if that fix is adopted.
- **Privacy:**
  - Revoked or expired grants return 403 on room, export, try, scenarios and any series endpoint.
  - Room responses carry `no-store`.
  - Terms carry no figures without an active financials grant.
  - The candidate calculation hides revenue when it isn't disclosed.
  - Anonymous sorting doesn't reveal order inside a band.
  - The public page has no numbers when sharing is off.
- **Chart math:** negative values, a zero baseline, gaps, all-unavailable and an empty business. The web package has no test files, so put this math in a pure module that vitest already covers.

The browser checks at 1440, 1280 and narrow widths stay on Astra's review list after slice 4.
