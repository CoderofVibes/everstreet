# Configured lifecycle review: own all work before closing storage

While Claude86864 designs003wf1, Astra reviewed current compose.ts, entry.ts, app.ts,
maintenance.ts and invocations.ts atb537e06. These are concrete implementation seams to cover
inside the already dispatched lifecycle scope, not new product features or reproduced new-code
failures. No implementation edits by Astra in this pass.

## Work can outlive a request or a supervisor pass

ManagedRuntime.invoke/customer invocation starts run() and returns a done promise. run awaits
the provider and later updates the DB, including in catch and final return; abort alone does not
fence a provider which ignores cancellation. A count of active HTTP handlers cannot therefore
prove all runtime work ended. Test a request that already returned, stop, then release a delayed
provider: no post-close DB access, unhandled rejection, result delivery or invented charge.
Persist unknown/cost uncertainty honestly and prove restart doesn't send that request again.

MaintenanceSupervisor uses deadlines that can return before an underlying adapter answers.
AdapterGuard counts outstanding calls but does not cancel or fence their eventual continuation.
Awaiting supervisor.stop alone is not proof every CustomerUses continuation has ended. Cover late
reader, writer and protection answers, including the actual callback after a database close.
Keep signed/external outcomes recoverable by exact identity; do not relabel uncertainty as failure.

everstreetApi currently creates CustomerUses internally, while composition owns runtime/builds.
Choose an explicit ownership arrangement so route and background work share the right guarded
services/lifecycle. Starting a separate maintenance instance must not leave route-created or
detached work outside the shutdown boundary. Tests should exercise actual composition services.

## Admission and exit ordering

entry currently invokes composed.stop only after listener close (or a10-second fallback).
Ensure stopping admission/scheduling is immediate, independent of an existing HTTP request
finishing or keep-alive connection draining. Exercise a live listener with an in-flight request,
new admission during stop, double stop, startup/listen failure and delayed callback. The storage
must close after a real drain/fence, not after an arbitrary wait claimed as proof. Keep deadlines
finite and report a forced stop honestly; no unbounded waits or process-wide unrelated kills.

## Capability inventory

compose still hardcodes customer_authorization unavailable with the sentence "No wallet or device
use-key connection is built yet (sub-job 003w-e)." That is stale after003we: the page has wallet
sign-in and device-key code, while availability depends on configured sign-in/callback/network
and contract capability. Update this existing inventory from actual prerequisites as part of
003wf1's truthful status work. Distinguish available, unsupported/absent and observed readiness;
neither mark everything healthy merely because configured nor claim the implementation is absent.

All003wf1 and parent gates remain. No browser enrollment/revocation action, no external/provider
call, no worker enablement. Claude owns changes/commits; please review and record this pass in
INDEX at handoff. All six milestones and approved extensions retained.

## Review of committed design8edf410 section12

Explicit config, provenance, listen-before-start and truthful health fit the brief. The proposed
network/protected-storage fence alone does not cover all continuations: readCustomerViews has
its own Promise.race timeout that can reject after that fence closes; a request body or another
non-adapter await can also finish later. Maintenance and route-owned CustomerUses must both be
inside the effective boundary even if they are separate instances. Test the actual service
continuation, not merely that the raw transport promise has been made permanently pending.

The design says late adapter answers "stay pending." Do not use permanently unresolved HTTP
handlers/tasks as the whole shutdown solution: externally returned work must finish or abort
within the bounded lifecycle, and timers/references must be cleaned up. Internal fencing can
discard a late result, but must not turn a stopped in-process composition into retained
unbounded work. Preserve unknown external outcomes; this does not authorize a fresh retry.

At20:25 Astra added server/test/astra-composition-stop-review.test.ts against actual composition
and normal HTTP routes, in-memory synthetic preview only. Both regressions fail at baseline:
new /api/env after stop returns200; a previously admitted /api/session request held in body-read
returns500 after stop closes storage and the body is released. Expected bounded503 stopping
without a closed-storage error. No network, credentials or browser action; deterministic stream
barrier, no timing sleep. The latter demonstrates a path outside the proposed network fence.
These are failures of existing lifecycle behavior, not claims that the unfinished new code fails.
Claude owns corrections; Astra leaves the separate tests/pass for review and local commit.

Required npm run check after the test addition stops at the in-progress appConfig.ts formatting
error before types/tests. Astra did not edit that Claude-owned file. Focused regressions above
ran independently and failed2/2; no current full-check acceptance is claimed.

At20:27, after the first compose/fence/serve implementation landed, Astra reran the same file:
new-admission test passes; the already-admitted body test still fails500 versus503. Thus the
transport-only boundary gap is reproduced in the new in-progress code too. No repeat full suite.

Also inspect stop ordering in the initial implementation: stoppers are awaited sequentially,
so build scheduling may continue while the supervisor is draining. End admission/scheduling
for ALL owners first, then drain collectively under a shared finite budget. Preserve cleanup
even if a stopper fails; do not silently swallow an error and claim an orderly drain. Fence.object
currently calls its target before checking shut, so it is not an admission barrier for storage
operations started after close. The new tests should distinguish actual stopped work from a
late promise deliberately left unresolved. These points follow the existing lifecycle brief.

The initial lifecycle.test.ts late-network case at63ad82b explicitly asserts settled=false
after150ms, checks fence.held, and drops the verifying promise. That proves the promise is
held, not that request shutdown completes or a later independent timeout cannot resume it.
Revise that evidence with the corrected lifecycle: bounded request completion/abort, no session
or late DB write, explicit cleanup of the held transport and applicable timers. Do not retain
permanent pending as a desired assertion merely to keep the new test passing.

At20:32 Astra strengthened the existing body-read regression to check bounded completion BEFORE
releasing the body. It allows250ms after stop resolves, then cleans up the held stream in finally.
The revised implementation now avoids the old closed-DB error when the body is released, but
still fails this assertion: response is absent after stop. A client may never finish uploading;
the stopped composition must finish/abort the admitted HTTP operation independently. This is
the bounded external completion requirement above, not a new feature. Focused result1pass/1fail.

Current stop also waits owners up to stopTimeout and THEN requests up to requestGrace. Despite
the shared-budget comment, those durations add. Use an actual common deadline/collective drain,
then cancel/fence unresolved work and report forced stop truthfully. Fence.close should release
its own outstanding waiters with StoppedError/cancellation even if raw transport never answers;
late raw results must remain discarded. Check detached runtime completion handlers and timers,
not only requests with network replies subsequently released by the test.

Required full check31155 after the stronger regression: types pass, two lint warnings
(compose optional chain; composeChild unused portText),1427pass/3fail/1skip. Failures are the
body-response regression, lifecycle late-network code sign_in_unavailable versus stopping, and
the existing protected-store200-write timeout. This is an in-progress snapshot, not acceptance.

At20:34 after committedcc151d4 added an admitted-request cutoff, Astra independently reran
the strengthened stop file:2/2pass. A stalled upload receives503 before its body is released;
late continuation is stopped by the DB gate. This narrowly verifies HTTP admission/completion.
Shared total stop budget, detached work/timers and actual process/settlement/provider evidence
remain for the final handoff; no full lifecycle acceptance from these two tests alone.

## Starting a standby process while another still serves customers

The new two-process test starts B while A is idle and checks the maintenance lease. Also test
startup with A holding an actual provider request/build. Current compose.start calls
runtime.recover unconditionally; ManagedRuntime.recover selects EVERY running invocation and
marks it unknown, with no process/lease ownership check. startBuildWorker similarly calls
recover({orphanAll:true}). Thus a new standby could invalidate another healthy process's live
work even though its maintenance lease behaves correctly. This is source evidence, not yet an
executed independent reproduction. Gate recovery on actual abandoned ownership or otherwise
enforce a supported topology; don't call live A's work an orphan merely because B starts.
The declared support for multiple configured processes and two-holder evidence needs this case.
Retain wider nonce/migration/close races for later003wf children as already specified.

## Concurrent recovery snapshot reproduced — 20:54 Pacific

Astra added server/test/astra-runtime-recovery-review.test.ts after reviewing the process-presence
change. It uses actual ManagedRuntime records and transactions with a fictional held provider.
At the supported isLive callback, A has selected the running row; B recovers it before A enters
its transaction. This deterministic interleaving models two recovery readers, not an actual
child-process race. The independent focused test FAILS: two unknown ledger entries instead of
one. finish checks the stale row and writes ledger/settlement before its conditional UPDATE.
Re-read eligibility inside the same transaction as all completion effects; an UPDATE CAS alone
at the end does not protect earlier ledger inserts or the admission callback. Assert exactly
one ledger transition and one settlement callback, and retain the active-peer process case.

The prior full check (builder1435+1skip plus8 process tests) predates this new regression.
Required full check for this Astra test remains to run after the correction, without overlapping
Claude's suite. All earlier incomplete shutdown/cancellation and requirement-matrix items remain.

At20:56 Astra repeated the corrected runtime recovery probe:1/1pass. The conditional UPDATE
now claims completion before any ledger/admission side effect in the same transaction. This
satisfies the reproduced double-settlement interleaving; broader process evidence remains separate.

Astra also added astra-fence-close-review.test.ts for the already-requested outstanding-waiter
requirement. It independently FAILS: Fence.close leaves its wrapper pending while the raw adapter
never answers. The test waits100ms, then releases the raw promise in finally (no hanging fixture).
Fix the fence's own pending promises, not just HTTP cutoffs or child process.exit. Preserve durable
unknown state and ensure detached completion handlers/timers clean up without unhandled errors.
The actual total stop deadline still adds owner and request waits in compose.ts at this snapshot.

At20:58 the independent stop/fence/recovery probes pass4/4 across3files. Fence now rejects
outstanding wrapper promises at close; compose uses a shared absolute stop deadline. Source
review confirms completion CAS precedes ledger/admission effects. These are narrow corrections.

Final handoff must still map the original brief's reservation-stop, retention-cleanup-stop and
real configured build-adapter/model timeout/budget cases to executed evidence (current process
file covers runtime success/error/held-before-response, settlement, holders and listen failure).
Also inspect the full response lifetime: compose currently fences fetch's Promise<Response>,
whereas httpsTransport reads the body afterwards with readCapped. A received header followed by
a held/non-cooperating body is outside that fetch-promise fence. Prove this path terminates its
owned runtime/build work/timers at stop, with no late writes/unhandled rejection; don't infer it
from holding the initial fetch. This is source-grounded remaining verification, not a claimed
independent failed body test. Keep the original cancellation/cleanup requirement intact.
