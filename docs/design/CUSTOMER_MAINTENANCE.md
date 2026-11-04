# Customer runtime maintenance (job 002d)

Claude, 2026-11-04. Authority: [002d](../astra/jobs/2026-11-04_002d_customer-runtime-maintenance.md).
Builds on [CUSTOMER_USE_RUNTIME.md](CUSTOMER_USE_RUNTIME.md). This is written before the code, and
the final section records what was built.

## What it does and never does

A bounded supervisor (`server/src/maintenance.ts`) advances customer obligations that are
**already authorized**, through the existing, fenced service operations in `customerUse.ts`:

| Phase | Operation | Effect |
|---|---|---|
| 1 | `expirePrepared(id)` | A prepared, unsigned request past its sign-by time becomes `expired`. It is local and never authorized. |
| 2 | `step(id)` | A signed reservation (`reserve_requested`/`reserve_unknown`) is read back. The identical stored payload is resent only within the existing bounded attempts and deadline. |
| 3 | `settleOne(id)` | The unit intent is frozen when decidable (`ensureIntent`), then `unitStep`: exact readback, then settle or release through the existing platform-authority and evidence checks. |
| 4 | `deleteResult(id)` | A result past its retention, under this storage's scheme, is deleted. |
| 5 | `deleteInput(id)` | A protected input that can never run again is deleted. |

**It never:**
- prepares a request, or signs for a customer;
- runs, or re-runs, a provider call;
- calls `ManagedRuntime.recover()`, which marks every running invocation unknown and so would
  orphan another process's live call;
- reconciles a sale;
- grants itself authority: every metering call still needs current `platformMeters` evidence from
  the same pinned read.

## Lifecycle

| Call | Behaviour |
|---|---|
| `start()` | Records the worker as running and schedules passes `intervalMs` apart through injected timers. Idempotent. |
| `runPass()` | One bounded pass. If a pass is already running, it returns `busy` and never overlaps. |
| `stop()` | Schedules no more passes. Resolves when the current pass ends, which is bounded by the pass budget plus one operation deadline. Records the worker as stopped. |

Nothing starts by itself. `main.ts` does not construct a supervisor. Only the isolated tests and
the disposable preview call `start()`.

## A pass, in order

1. **Coordination.** Claim or renew the durable `maintenance_lease` row by compare-and-set: free,
   expired, or already ours. If another live holder has it, the pass is `standby` and does
   nothing. The lease is renewed before each item. If it was lost, the pass stops: a stalled
   process can't keep working. Every item is additionally fenced by the existing per-request and
   per-settlement lease generations, so two supervisors racing on the same row can't both apply.
2. **The phases above, in order**, each taking up to `batch` items (default 10, at most 25).
3. **Heartbeat.** It is recorded at the start and end of the pass, with safe counts only.

**Limits.**
- **Each item** is raced against `opDeadlineMs`. On timeout the pass moves on and the item is
  backed off. A late completion is fenced by its lease.
- **The pass** stops starting items when `passBudgetMs` is spent.
- **Concurrency** is one item at a time, which is a bound in itself.
- **No database transaction** spans an await. Atomic transitions happen only in the existing
  service methods.

## Fair selection and backoff

**Selection.** Each phase selects only rows that are eligible now. Rows backed off in
`maintenance_backoff(task, subject, failures, next_ms, code)` are excluded. A row that makes no
progress gets `next_ms = now + min(maxMs, baseMs · 2^(failures−1))`. Defaults: base 10 s,
maximum 10 min.

**Outcomes.**

| Outcome | Examples | Effect on backoff |
|---|---|---|
| No progress | `not_decidable`, `read_failed`, `pending`, `operator_not_authorized`, `writer_unavailable`, `attempts_exhausted`, a failed deletion, a timeout | Backed off |
| Progress | A decision, a submission, a deletion | Clears it |
| Someone else's turn | `not_due`, `stale` | Unchanged |

**The fixes.** So undecidable, failing or paused rows can't monopolize a batch, and later
eligible work is reached in bounded passes. This fixes the source concerns:
- `settleDue`'s oldest 25 rows (including undecidable ones) could starve later work;
- `expireInputs` took its first 200 references before filtering;
- failed oldest result deletions could fill a batch.

**Sticky states** stay sticky and aren't selected: a request or settlement conflict, and
`unresolved`. Unknown charges and returns stay unknown until an exact readback decides them.
Retries are only the existing idempotent ones (an identical stored payload, within
`maxSubmissions`). There is no provider redispatch.

## Resource bounds with uncooperative adapters

**Guards.** `guardAdapters(options, cap)` wraps the injected chain reader and writer, and the
protection storage, with counters of **underlying calls still outstanding**. That includes calls
that outlived their timeout because the adapter ignored the abort signal. Before a phase, the
supervisor checks the guard it needs. If it's saturated (at `cap`, default 4), the phase is
skipped and reported. No call is made and no state changes.

**Effect.** A hanging adapter therefore costs at most `cap` stuck calls, not one per pass. The
guards only count; they never answer for an adapter, so customer-initiated actions aren't
affected.

## Restart and two processes

**On restart:**
- the supervisor lease expires, and the next instance claims it;
- per-request leases expire, so their work is selected again;
- a reply from the old instance arriving later is fenced by the lease generation and records
  nothing.

**Two instances on one database:** only the lease holder works, and per-item leases keep even a
racing pair to one decision.

A running invocation left behind by a crashed process stays `running` until a single-instance
recovery handles it. Its settlement waits, backed off. This gate is recorded, not automated.

## Sale and authority

Maintenance is platform-level. A sale doesn't stop it, but each metering action needs the
platform's METERING from the same read:
- **revoked:** the item records `operator_not_authorized`, backs off and is counted as paused;
- **cleanup:** continues, because it needs no metering;
- **re-appointed:** the existing recovery continues, with no new consent and no duplicate charge
  (the existing hold, attempts and readback);
- **acquisition reconciliation:** never run from a timer.

## Health: owner-safe, counts only

**What the projection is.** `maintenanceHealth(businessId)` is bounded and per-business. It is
read through the owner-fenced readiness (`controlEpoch`), so a former owner gets 404.

**Its fields.**
- **The worker:** not started, running (heartbeat within 3 intervals), overdue, or stopped. The
  heartbeat is the platform's, not per business. A heartbeat alone isn't presented as
  everything being healthy.
- **This business's counts:**
  - reservations pending;
  - units waiting;
  - units unknown;
  - units paused by authority;
  - needing attention: conflicts, unresolved, attempts exhausted, or a row backed off 3 or more
    times;
  - results past retention not yet deleted;
  - deletions currently failing.

**What it never contains:** customer content, ids, references or raw errors.

**Readiness.** Customer readiness gains a **Background maintenance** item. **Result cleanup**
separates three facts:
- the deletion capability;
- scheduled work actually observed (a recent heartbeat);
- recorded deletions and failures.

## Corrections in 002d1

**Health is written only by the active holder.** Every write goes through `publish()`, which in
one `BEGIN IMMEDIATE` transaction checks that this instance holds the durable lease (its holder,
**this generation** and an unexpired `until_ms`). The writes it covers:
- the heartbeat at pass start;
- the pass outcome at the end;
- the phase cursor;
- on `stop()`, "stopped" plus releasing the lease (`until_ms = now`), so another instance may
  take over at once.

**Consequences:**
- `start()` writes nothing, so starting proves nothing.
- A standby's start, pass or stop writes nothing, so it can't make an overdue holder look fresh
  or make an active one look stopped.
- After every item's await the pass rechecks the lease. If it was lost, it publishes neither the
  item's backoff nor the pass outcome (`lease_lost`).
- Per-item financial fencing (request and settlement lease generations) and the adapter guards
  are unchanged. Health reads have no side effects.

**Fair across phases, durably.** The five phases (prepared, reserve, settle, result, input) run
in a rotation that starts at `maintenance_cursor.next_phase`. The cursor is written only by the
holder, so it survives restarts and takeovers. After a pass, the next start is:
- the first phase that had eligible work but no budget left (it goes first next time);
- otherwise, the phase after this pass's start.

**Guarantee:** a phase that a busy phase pushed out of a pass's budget gets the first item of the
next pass, and every phase starts first at least once every five passes. Limits, the pass budget
and the batch are unchanged; no loop runs until empty. A slow or unavailable metering phase
therefore can't starve cleanup.

## Corrections in 002d2

**A completed pass is not a schedule.** `maintenance_status` gains two fields:
- `scheduled`: written by the active holder, 1 only while `start()` is in effect and the holder
  isn't stopping;
- `pass_started_ms`: set by the heartbeat at pass start, cleared by the pass's finish or by stop.

`maintenanceHealth` keeps four separate facts (no holder id is exposed):
- **scheduling:** `running` only for a scheduled holder with a fresh heartbeat; `overdue` for a
  scheduled holder with a stale one; `not_scheduled` when passes ran only when asked; `stopped`;
  `not_started`;
- **recent pass:** `last_pass_at` and `last_outcome`;
- **in flight:** `in_flight`, a pass started within three intervals and not yet finished.

**Consequences:**
- Only `running` supports "settles by itself" in the books, desk and readiness.
- A pass after `stop()` re-arms nothing and reads `not_scheduled`.
- A row from before 002d2 gets `scheduled = 0` from the migration, so it reads `not_scheduled`,
  never `running`.
- The 002d1 fencing is unchanged. Every field is written inside `publish()`'s holder check, so a
  standby, a late finish or a takeover race writes none of them.

## Built

**Files.**
- `server/src/maintenance.ts`: `MaintenanceSupervisor`, `guardAdapters`/`AdapterGuard`,
  `maintenanceHealth`.
- The tables `maintenance_lease`, `maintenance_status` and `maintenance_backoff` (`db.ts`).
- Single-item operations in `customerUse.ts`: `expirePrepared`, `settleOne`, `deleteResult`,
  `deleteInput` and `deletionScheme`. Each re-checks every rule. The existing batch methods are
  unchanged.
- Readiness gains **Background maintenance**, and **Result cleanup** now uses observed scheduled
  work.

**Development order.** A first version that drove the existing batch methods failed the three
fairness tests. The fair selection and backoff described above pass them.

**Defaults.**

| Setting | Default |
|---|---|
| Interval | 30 s |
| Lease | 3 × max(interval, budget) |
| Batch | 10 per phase |
| Pass budget | 20 s |
| Operation deadline | 15 s |
| Backoff | 10 s to 10 min |
| Guard cap | 4 outstanding calls |

**What remains to wire live (separate gates):**
- constructing the supervisor in `main.ts`, with real reader, writer and protection adapters and
  guards;
- choosing a holder identity per process;
- a single-instance (or process-fenced) `ManagedRuntime.recover()`;
- alerting on overdue or attention states;
- a scheduled cleanup of the coordination tables beyond the bounded pruning.
