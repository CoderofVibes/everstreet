# 003t report: customer operating performance

Claude, 2026-11-04. Job: [003t](../jobs/2026-11-04_003t_customer-operating-performance.md).
Commit `351e8e3`, on top of `66bd012` (002d1). Not pushed. No contract change, no `main.ts` or
live wiring, no package change. The design was written first:
[CUSTOMER_OPERATIONS.md](../../design/CUSTOMER_OPERATIONS.md).

## What the owner gets

The existing books (`/desk/:id`, Books card) gain a **Digital operations** section. The legacy
books, seeded history, the "AI spend" ledger and buyer disclosure are unchanged. The section
holds:
- **Tiles:**
  - uses requested (charged and returned);
  - usable results out of runs;
  - open now (settling and needs attention, all time);
  - runtime cost serving customers, with founder trials and checks beside it.
- **Customer uses chart:** stacked by current outcome, one bar per UTC month. The current month
  is framed and labelled "so far". A recorded empty month shows "0".
- **Runtime cost chart:** serving customers beside founder trials and checks. A "?" marks a month
  with unknown-cost calls.
- **"Every operations figure" table** with the four basis statements.
- **Next step:** "not started" (no offer and no use) shows a link to start a product in Studio.
- **Links:** Customer access and settling (per product, with its active and retired offer
  counts), Ownership and continuity, and Sale and handover.

## Metric definitions

- **Cohort:**
  - A use counts in the UTC month of `customer_requests.created_at`, which is written once.
  - Its status is its *current* recorded outcome, so a month's split can change as outcomes
    resolve. Its total can't.
  - Rows dated after now are excluded. At most 24 months.
- **Buckets** (exclusive; they add up to the requests): charged, returned, settling
  (`requested`/`unknown` settlement), needs attention (conflict or unresolved), reserved not
  settled, awaiting reservation, never reserved.
- **Execution facts:** these overlap the buckets.
  - Ran: an execution exists.
  - Usable: the charging-eligibility rule (delivered + extracted + invocation completed with an
    extraction).
  - The rest are not usable, undecided or unknown.
- **Cost:**
  - `runtime_invocations` by the UTC month of each call.
  - `customer_use` counts as serving customers; `trial`/`release`/`evaluation` count as founder
    trials and checks. Build stays its own ledger.
  - Sums are SQLite `SUM` cast to text, then BigInt. They are never rounded per call or summed as
    floats.
  - Calls with `partial`/`unknown` usage are counted apart, with their reserved cents. They are
    never treated as zero.
  - The two groups sum exactly to the runtime ledger's period total (tested).
- **Value:** omitted. No revenue, cash or profit comes from customer uses. Charged counts are
  units.

## Fencing and continuity

- **Owner fence:** the books route checks control before and after its reads. A non-owner and
  another business's founder get 404.
- **Browser:**
  - `DeskPage` is now keyed by who is acting and which business, so a switch unmounts it and late
    answers land nowhere.
  - A 401/403/404 on a reload clears every figure.
  - Loads are sequenced.
- **Continuity:** after the actual app reconciliation (`v3/intents/:id/reconcile`, fixture
  transport), the buyer sees identical totals, the former owner gets 404, and the customer keeps
  their result. No SQL ownership write is used.
- **Buyer evidence:** not expanded.

## Preview

```
npm run web:build
npx tsx scripts/preview-operations.ts
```

- **Setup:** site on :8820, controls on :8821, 127.0.0.1 only. It is built on the acquisition
  preview and the label is shown on every page.
- **Recorded activity:** this month, through the app's own routes:
  - 3 charged (one by the customer, two by worker passes);
  - 1 returned (unsupported document);
  - 1 settling (a synthetic lost settle answer);
  - 1 reserved;
  - 1 prepared;
  - 1 cancelled.
- **Nothing is backdated:** earlier months are recorded zeros, and the label says so.
- **Controls:** `/maintenance/pass`, `/use`, `/deal/<state>`, `/metering/appoint`.
- **Test:** `server/test/operations-preview.test.ts` drives it through the site's fetch. It
  covers the owner's figures, the actual sale, identical buyer totals, the former owner's 404, the
  customer's kept result, and a later use plus passes adding exactly one use and one call.
- No listener was left running.

## Checks

- `npm run check`: **817 tests in 75 files**, lint and types clean (805/72 before).
- `npm run web:build`: passes.
- **New tests:**
  - `customer-operations.test.ts` (7): totals against the DB, repeated passes, month boundary
    and future rows, not started / recorded zero / unknown cost, exact sums past 2^53, two owners
    and retired offers, actual reconciliation.
  - `operations-preview.test.ts` (1).
  - `web/test/operations.test.ts` (4): exact formatting, integer axes, zero vs unknown text,
    "so far".
- **Mutants**, one at a time and each restored. All 4 were killed:
  1. Founder `release`/`evaluation` calls counted as serving customers.
  2. `unknown` usage not counted as unknown cost.
  3. `addDecimal` through `Number`. It first **survived**: the test's total was even, and a float
     holds it. I strengthened the test to an odd total above 2^53 plus a direct `addDecimal`
     check, and it was then killed.
  4. The browser formatter through `Number`.

## Limits

- **Not browser-verified:** no layouts checked at 1440/1280/390, no keyboard pass, no screen
  reader.
- **No component test** for the access-loss clearing or the actor/business keying. These are
  covered by reasoning and the route tests only.
- **Chart bar heights** use a float above 2^53. Text and table stay exact.
- **"Open now" is all time;** every other figure is for the period.
- **The preview shows one populated month,** because nothing is backdated.
- **All six milestones stay open.** M3/M5 are not claimed from fixtures.
