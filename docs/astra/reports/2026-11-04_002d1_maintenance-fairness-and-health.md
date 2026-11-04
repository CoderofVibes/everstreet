# 002d1 report: maintenance fairness and truthful health

Claude, 2026-11-04. Job: [002d1](../jobs/2026-11-04_002d1_maintenance-fairness-and-health.md).
Commit `fde3d42`, on top of `c365897` (Astra's six docs). Not pushed. No contract change, no
`main.ts` or live wiring. Design updated: [CUSTOMER_MAINTENANCE.md](../../design/CUSTOMER_MAINTENANCE.md),
section "Corrections in 002d1".

## Reproduced first

All six cases in `server/test/customer-maintenance-health.test.ts` failed before the fix:

| Case | Before the fix |
|---|---|
| **Astra recipe 1:** active A; standby B starts, passes (`standby`) and stops | A read `stopped`, expected `running` |
| Start alone | Wrote a "running" health row |
| A standby repeatedly starting while the holder is overdue | Made the holder look fresh (then `stopped`) |
| A pass that loses its lease mid-await | Still published its backoff and outcome |
| **Astra recipe 2:** a slow settlement (21 ms against a 20 ms budget, backoff 1 ms), four passes | The expired result stayed `stored` |
| A restarted instance on each pass | Always started at the busy early phase (0 of 3 deleted) |

## Changes

1. **`publish()`.** One transaction writes the heartbeat, pass outcome, phase cursor, and on stop
   the "stopped" state plus releasing the lease (so takeover is immediate). It writes only while
   this instance holds the lease: holder, generation and an unexpired `until_ms`.
   - `start()` writes nothing.
   - A standby or stale instance writes nothing.
   - After each item's await, the lease is rechecked. If it was lost, there is no backoff and no
     outcome (`lease_lost`).
2. **A durable phase rotation** (`maintenance_cursor`, written only by the holder):
   - the next pass starts at the first phase that had eligible work but no budget left;
   - otherwise, at the phase after this pass's start.
   
   So every phase leads at least once every five passes, and a phase squeezed out by budget leads
   the very next pass. This survives restarts and takeovers. Budget, batch and limits are
   unchanged, and nothing loops until empty.
3. **Unchanged:** per-request and per-settlement financial fencing, adapter guards, the 002d
   automatic return and charge, and the owner-safe readiness. Health reads have no side effects.

## Checks

- `npm run check`: **805 tests in 72 files** (798/71 before).
- `npm run web:build`: passes.
- **New tests:** the 6 reproductions, plus "a budget-skipped phase goes first in the very next
  pass".
- **One existing test changed deliberately:** the 002d lifecycle test now expects
  `not_started` after `start()` and `running` once the scheduled pass runs.
- **Mutants**, one at a time, each restored, with the diff inspected before running. All 4 were
  killed:
  1. publish without the holder check;
  2. no lease check after an await;
  3. the cursor ignored;
  4. no preference for budget-skipped phases.

## Limits

- Health still shows a platform-level worker. A standby is invisible until it takes over, by
  design.
- No browser repeat here.
- All six milestones stay open.
