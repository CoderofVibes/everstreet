# 002d2 report: scheduled worker versus a one-off pass

Claude, 2026-11-04. Job: [002d2](../jobs/2026-11-04_002d2_scheduled-versus-one-pass.md). Commit
`ed876c9`, on top of `4a2e085` (Astra's six docs). Not pushed. No contract, `main.ts`, package,
provider or scheduler-startup change. The design is updated in
[CUSTOMER_MAINTENANCE.md](../../design/CUSTOMER_MAINTENANCE.md), section "Corrections in 002d2".

## Reproduced first

`server/test/customer-maintenance-schedule.test.ts`: all four tests failed before the fix, each
reading `running`.

1. **Astra's recipe:** a supervisor with no `start()` and one `runPass()`. Health, the books'
   `settlement.worker`, the digital desk and readiness must not promise automatic settlement.
2. **`start()` then a pass:** reads `running`. `stop()` reads `stopped`. A pass after stop must
   not read running or re-arm a timer (counted timers).
3. **A pass in progress:** must read `in_flight`, with the settle submission held, and only while
   it is held.
4. **A pre-002d2 database:** a throwaway file holding the old `maintenance_status` table with a
   fresh "running" row. After `openDb` migrates it, it must read `not_scheduled`.

## Changes

- **Two new `maintenance_status` fields,** both written only inside `publish()`'s holder and
  generation transaction:
  - `scheduled`: 1 only while `start()` is in effect and the holder isn't stopping;
  - `pass_started_ms`: set at the pass heartbeat, cleared at finish and at stop.
- **Migration:** adds them with `scheduled = 0`, so old rows read conservatively.
- **`maintenanceHealth` worker states:**
  - `running`: scheduled, with a fresh heartbeat;
  - `overdue`: scheduled, with a stale heartbeat;
  - `not_scheduled` (new): passes ran only when asked;
  - `stopped`;
  - `not_started`.

  Plus `in_flight`, and the unchanged `last_pass_at`/`last_outcome`. No holder id is exposed.
- **Readiness:** "Not scheduled: a pass ran only when asked (last at …)", state `unavailable`.
- **Books/desk wording:** "No background worker is scheduled: a maintenance pass ran only when
  asked … Units wait …". Only `running` says units settle by themselves.
- **Unchanged:** 002d1 fencing, rotation and fairness, standby, takeover and late-finish
  behaviour, and the preview controls (which still run one-off passes, now reported honestly).

## Tests changed deliberately

These encoded the old meaning, where a one-off pass read as running or overdue:
- the 002d1 takeover test now starts A and B, so both are scheduled;
- the 003t and 003t1 expectations now read `not_scheduled` for passes run on request;
- 001c's desk fixture starts its worker, plus a new test that unscheduled passes read
  `not_scheduled`.

## Checks

- `npm run check`: **845 tests in 81 files**, lint and types clean (840/80 before).
- `npm run web:build`: passes (769.47 kB, the existing size advisory).
- **Mutants**, one at a time and each restored. All 4 were killed:
  1. `scheduled` written whenever running;
  2. the migration defaulting to scheduled;
  3. the finish leaving the pass in flight;
  4. the browser wording promising automatic settlement for `not_scheduled`.

## Limits

- **`in_flight`** relies on a recent `pass_started_ms` (within three intervals). A crashed pass's
  marker ages out, it isn't cleared.
- **Not browser-verified.**
- **All six milestones stay open.**
