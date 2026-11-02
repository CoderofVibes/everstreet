# Financial implementation: independent review

Astra, Nov2,14:10 Pacific. Through96ea61f. Independent lint/types/all319 tests and web build
passed. All probes use isolated SQLite/FakeChain or scripted providers. No testnet evidence.
Read-only Claude review saved in003f-source-review (session9f2a547d-b061-4be2-8d63-577ac252125d,
exec7701 completed); its statements are source analysis until independently checked below.

## Independently reproduced server defects

1. **Repeatedly ending a recurring cost resurrects a closed month.** A fixture hosting cost
   ended inSeptember2026 has October direct cost0. Calling `Books.endCost` again moves its end
   toOctober, and October becomes25000 cents. The API select permits already-ended rows. Keep
   the first end immutable/idempotent, with any genuine later correction an explicit new action.
2. **Pre-opening months become comparison baselines.** Account opened September15,October
   earned10000 cents. `lastTwoComplete` choosesAugust(before_start,complete:true) andOctober.
   Headline: +$100 from$0 inAugust. Before-start/unconnected periods are not observed zero and
   comparisons must explain missing contiguous coverage rather than silently skipSeptember.
3. **RPC outage becomes no trading history in acquisition search.** Named software listing
   has3 earning months; min_months1 matches before an outage, returns no match when one month
   fails. Unfiltered listing says No complete month yet and history months0/verifiedfalse;
   only valuation says unavailable. Preserve unknown versus known-zero history through facts,
   figures and filtering; explain whether an unknown criterion is included or excluded.
4. **Late money response leaks after ownership changes.** Gate FakeChain.period, GET/money
   as old owner, change owner in isolated DB, release gate. Response200 includes treasury.
   Add final authority checks for all awaited private reads, including wallet/order details.
5. **Late scenario save writes despite denial.** Gate period, POST/value/scenarios as old
   owner, transfer owner, release. Response404 but one value_scenarios row was inserted. Guard
   before the commit as well as before the response; include ownership-away/back tests.

## Browser evidence and corrections

Isolated fictional Ledgerline Labs, six months, a missingSeptember observation, August zero,
negative contributions, first/current partial months and recorded costs. Dashboard shows
separate earned/cost/contribution and cash charts, gap breaks, unknown hatching, negative
points, units and a source table. Period changes update both figures and category totals.
Keyboard Tab reaches each chart month and updates its text details; focus is visible.

1440 and1280 desktop views inspected;1280 document width1265, no page overflow. At390 the
collapsed view has document width375. **Expanding Every figure, with its source makes the
document width704 at viewport390.** Contain table overflow in its own accessible region so
navigation and controls keep their width. SVG axis/month labels also scale to roughly5px at
390, so phone users cannot read them; use responsive axes or a scrollable chart region with
readable type. First historical partial month should say partial, not month in progress/so far.

Internal images `m3f-books-1280.jpg` and `m3f-books-390.jpg` in the task visualization folder.
QA81705 stopped; tabs11/12 closed; viewport reset. The first failed QA launch exited before
listening because the API requires its in-memory booking dependency; the corrected fixture
included it. No real runtime was started.

## Source-review issues to resolve with tests

- Separate fictional and observed series visually and in category aggregation; breaking only
  at null values draws one apparent trend across sources. Add a clear fictional legend.
- Keep observed zero months in the buyer's table. Its reproduction check must use the same
  exact totals/rounding as the server; rounded per-month cents cannot prove a mismatch.
- Guard aggregate numeric bounds without `?? 0`, and tiny/sub-cent chart scales without
  duplicate keys/ticks. Qualify selected-period versus all-time unknown-cost counts.
- Audit late public disclosure/listing changes after awaits. Existing003p private grant fences
  must remain. Preserve previous disclosure scope when adding cash/withdrawal/proceeds fields:
  old grants must not silently gain newly sensitive detail; version/describe any expanded scope.
- A closed one-off correction is explicitly recorded and can change corrected books; do not
  confuse it with the reproduced end-date resurrection. Preserve the audit trail and labels.

003f1 requests these corrections. Charts are a useful implemented step, not fullM3 acceptance.
