# 002d report: customer runtime maintenance

Claude, 2026-11-04. Job: [002d](../jobs/2026-11-04_002d_customer-runtime-maintenance.md).
Commit `b549cfb`, after 001b1 (`7953801`, report `6ac6130`). Not pushed. No contract change, no
`main.ts` wiring, no live adapter. Design written first: [CUSTOMER_MAINTENANCE.md](../../design/CUSTOMER_MAINTENANCE.md).

## What it is

`server/src/maintenance.ts` holds the supervisor, the adapter guards and the health projection.

**Lifecycle.** `start()` schedules passes, `runPass()` runs one bounded pass and never overlaps
another, and `stop()` drains.

**Each pass:**
1. Claims or renews a compare-and-set lease (`maintenance_lease`). Another live holder means
   `standby`, and the lease is renewed before every item.
2. Runs, through the existing fenced operations only:
   - expire unsigned preparations (local);
   - reservation readback (`step`);
   - settlement (`settleOne`: freeze the intent when decidable, then `unitStep`);
   - result cleanup (`deleteResult`);
   - input cleanup (`deleteInput`).
3. **Bounds:** one item at a time, each raced against a deadline; a pass budget; at most 25 items
   per phase.

**What it never does:** prepare, sign, run or re-run a provider call, call
`ManagedRuntime.recover()` (that would orphan another process's live call), reconcile a sale, or
grant itself authority.

**Fairness.** Durable per-item backoff (`maintenance_backoff`) means undecidable, failing or
paused work can't block eligible work. Input selection filters in SQL before the limit. Sticky
conflict and unresolved states aren't selected.

**Uncooperative adapters.** `guardAdapters` counts underlying calls still outstanding, including
ones that outlived their timeout. A saturated phase is skipped: no call is made and no state
changes.

**Health.** `maintenanceHealth` is owner-safe, counts only, through the owner-fenced readiness.
- Readiness gains **Background maintenance**: not started or stopped (unavailable), running
  (observed, with the note that a heartbeat doesn't prove every service healthy) or overdue
  (unknown), plus this business's counts.
- **Result cleanup** now separates the capability, observed scheduled work and recorded
  deletions and failures.
- **Never shown:** ids, references, content or raw errors.

**Single-item operations** were added to `CustomerUses`. Each re-checks every rule. The existing
batch methods are unchanged.

## Reproduced first

`server/test/customer-maintenance-fairness.test.ts` failed all three cases against a first
version that drove the existing batch methods (`reconcileDue`/`settleDue`/`expireResults`/
`expireInputs`):

| Case | Result against the batch methods |
|---|---|
| Undecidable older reservations | The newer decidable one is never charged |
| Failing oldest result deletions | They fill every batch, so a deletable one is never reached |
| A deletable input behind 205 not-yet-deletable ones | Never deleted (selection limit before filtering) |

All three pass with fair selection and backoff. The 205 backlog rows are labelled synthetic SQL
copies of one real prepared request, because the fixture reader's own read ceiling bounds how
many real preparations a test makes.

## Checks

- `npm run check`: Biome and `tsc` clean, **798 tests in 71 files** (780/68 at 001b1).
- `npm run web:build`: built. Rust was not rerun (no contract change).
- **`server/test/customer-maintenance.test.ts` (14 tests):**
  - **No customer click:** a completed use reaches charged evidence; an unused reservation is
    returned after its window; an unsigned preparation only expires and no `open_hold` is ever
    sent for it.
  - **No re-run:** provider calls are unchanged throughout, and an uncertain provider run is
    released, never charged or re-run.
  - **Coordination:** the second instance stands by and takes over after the lease lapses; two
    uncoordinated workers racing still settle once (one settle call, one charge).
  - **Stalled worker:** its late writer answer is never recorded; the next worker finishes once.
  - **Restart:** new instances on the same database resume.
  - **Lifecycle:** with manual timers, start is idempotent, there is no overlap, and stop clears
    scheduling and records stopped.
  - **Stop during an await:** it resolves by the deadline, not when the adapter returns.
  - **A writer that never answers and ignores abort:** outstanding calls stay at most cap +
    batch − 1, the phase reports `adapter_saturated`, and there is no charge.
  - **Mixed schemes:** only this scheme is deleted, and retention still refuses the read; a
    missing deletion capability is reported as `deletion_unavailable`; no writer means the local
    work still runs.
  - **Delivery timeout:** a result still protecting is undecidable, then released after the
    timeout, never charged.
  - **Sale:**
    - revoked metering gives `operator_not_authorized`, counted as paused;
    - cleanup still deletes;
    - after re-appointment it is charged exactly once (one settle call).
  - **Owner health in readiness:** not started → observed → overdue; no references or content;
    a former owner gets 404; the buyer sees the stopped state.
- **Other tests:** `server/test/maintenance-preview.test.ts` (1, through the preview site);
  `customer-offers` readiness map updated with the new key.
- **Mutants**, one at a time, each restored, with the diff inspected before running. All 4 were
  killed:
  1. no backoff (3 tests);
  2. the input filter removed;
  3. the lease always granted;
  4. the guard ignored.

## Preview for Astra

```
npm run web:build
npx tsx scripts/preview-maintenance.ts    # site 127.0.0.1:8818, controls :8819
```

Not launched this session; no listener or process is running. The worker starts only by control.

**Controls:**
- `POST :8819/maintenance/start`, `/maintenance/stop` and `/maintenance/pass`;
- `/writer/hang` and `/writer/heal`;
- `/sale`;
- `/hold/expire`;
- `/lose/<route>`;
- `GET /` shows the state and health counts.

**Walk-through.**
1. As Cara, one use at `/use/<offer>`: authorize, run, show the result.
2. Don't press Settle.
3. Start the worker, or call `/maintenance/pass`. The unit reads charged.
4. As Ava, `/build/<project>?view=service&task=customers` → readiness shows Background
   maintenance as stopped, running or overdue, and Result cleanup.

## Limits and remaining live gates

- **No production wiring:** no `main.ts` construction, holder identity per process, or live
  reader/writer/protection adapters.
- **Runtime recovery:** a single-instance or process-fenced `ManagedRuntime.recover()` isn't
  automated. A crashed process's running invocation stays undecidable, backed off.
- **Concurrency:** one item at a time. The worker heartbeat is platform-level; counts are per
  business.
- **No alerting** on overdue or attention states.
- **Not browser-verified here.**
- **Synthetic maintenance** is not live NEAR or production operation evidence. All six
  milestones stay open.
