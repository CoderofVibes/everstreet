# 003t1 report: operations time bounds and truthful status

Claude, 2026-11-04. Job: [003t1](../jobs/2026-11-04_003t1_operations-time-and-status.md).
Commit `eba6aaf`, on top of `9d99173` (Astra's six docs). Not pushed. No contract, `main.ts`,
package or live wiring change. The design is updated in
[CUSTOMER_OPERATIONS.md](../../design/CUSTOMER_OPERATIONS.md), section "Corrections in 003t1".

## Reproduced first

`server/test/customer-operations-time.test.ts` follows Astra's recipe: an executed use, then its
request, its execution and every runtime call of the business set to 2026-11-05T13:45Z, read
as of 2026-11-04T13:45Z. Before the fix it gave `[requested, ran, customer calls, founder calls]
= [1, 1, 1, 8]`, against an expected `[0, 0, 0, 0]`.

All four new tests failed before the fix:
- the recipe;
- the boundary;
- the exclusive current-work groups;
- worker-qualified settlement.

## Changes

1. **One as-of instant.** These all use `created_at <= as_of`, and the instant is returned as
   `as_of`:
   - requests;
   - executions (request and execution `created_at`);
   - runtime calls;
   - offers;
   - the "ever" count.

   The exact instant is included, a millisecond later is excluded, and earlier rows are kept.
   Source timestamps are read, never rewritten.
2. **"Open now" is replaced by "Current customer work (all time)".** Its groups are exclusive and
   use the usage buckets' precedence:
   - need attention;
   - awaiting settlement;
   - reserved, not yet settled;
   - awaiting reservation readback;
   - prepared, awaiting the customer's signature, only while it can still be signed (on the
     customer service's clock).

   Charged and returned uses are in no group. The basis list gains "Current work".
3. **Settlement claims follow `settlement.worker`,** taken from the maintenance health the
   customer service already reads, on its own clock:
   - "Settles and returns units by itself" appears only for `running`;
   - `overdue`, `stopped`, `not_started` and `unknown` each say that units wait;
   - paused-by-authority is named.

   The read starts nothing, polls nothing and changes no metering. "Settling" labels became
   "Awaiting settlement" across the tiles, chart, legend and table.
4. **The Books empty message** now says "No payment or revenue records yet … revenue is not
   known, not zero". When operations are recorded, it points to them below.
5. **The operations preview label** states the fixture sale clock (it started at
   2026-11-02T00:10Z) and that customer uses run on this computer's clock. The sale terms are
   unchanged.

## Checks

- `npm run check`: **824 tests in 76 files**, lint and types clean (817/75 before).
- `npm run web:build`: passes (761.65 kB, the existing size advisory).
- **New tests:**
  - 4 server tests;
  - 3 web tests (current work, settlement text, empty message);
  - preview label assertions for the fixture clock.
- **Updated tests:** the 003t `current` expectation, now the exclusive groups plus the worker
  state, and the month text ("awaiting settlement").
- **Mutants**, one at a time and each restored. All 4 were killed:
  1. the as-of instant ignored;
  2. the cost query alone unbounded;
  3. expired preparations still counted;
  4. an overdue worker described as settling by itself.

## Limits

- **Preview label:** its new assertion wasn't run against the old label. The old text plainly
  lacked the clock.
- **Worker health:** an explicit `runPass` publishes a heartbeat (the 002d1 design). Right after
  a requested pass, the books say "running"; three intervals later they say "overdue".
- **Not browser-verified.** Astra's pending browser sale-intent step was not performed or
  substituted.
- **All six milestones stay open.**
