# Configured lifecycle handoff review and bounded correction dispatch

Tony's approved scope remains: "I like your assessment - make it so". Keep all six milestones,
the core customer/acquisition journey and the four added capability briefs. No new external rights.

## Verified at 662445a / implementation 1eaf7bc

Astra required check92586 completed exit0: lint/types clean,1437 tests pass with1 skipped,
then8 actual-child-process tests pass. The process phase ran84seconds. Independent focused
stop/fence/recovery probes also pass4/4; the earlier two RPC probes passed after correction.
Claude's unchanged-web build passed. No browser or live-chain acceptance is inferred.

Astra reproduced duplicate recovery ledger effects and an outstanding fence waiter that never
finished. The committed corrections claim completion before ledger/admission effects, reject
owned fence waiters at close, and use a shared stop deadline. The source and narrow regressions
support those corrections. The synthetic RPC now rejects wrong accounts and preserves historical
block state. Starting B while A runs a customer request has actual process evidence.

The report honestly lists missing requirements. Therefore003wf1 remains review/unfinished, and
003wf remains partial. Passing the implemented tests does not waive the original brief.

## Dispatch now: finish003wf1's existing requirements

Prior sole exec86864 terminated0; exact-session CIM check returned no process; git status clean
before this pass. Resume that same Claude session, exact Opus5.5/high subscription only, as sole
writer. Read the original brief and the latest ConfiguredLifecycleDesignReview additions.

1. Complete the promised finite process barriers for stop during reservation/open_hold and
   retention cleanup. Restart must preserve exact operation identity and eventual appropriate
   state without duplicate effects or unreadable retained records. Use real configured services
   and supported network boundaries, deterministic barriers, bounded heaps/time and exact cleanup.
   If cleanup is synchronous locally, exercise the relevant actual interruptible boundary and
   state honestly what the test can prove; do not introduce a production shortcut solely for a test.
2. Exercise the configured build adapter as well as runtime, with real production parsing,
   accounting and limits over synthetic model HTTP. Include provider timeout/cancellation and
   budget refusal/accounting evidence. Cover peer startup with a live build or enforce/prove a
   narrower supported topology; do not infer all live-work safety from the idle lease test.
3. Finish shutdown across the entire transport response lifetime. compose currently fences
   fetch's Promise<Response>, while httpsTransport reads its body afterwards. Test headers
   received followed by a held body, including a non-cooperating transport. Owned application
   continuations/timers must finish or cancel at stop without a raw reply, with no late DB writes,
   unhandled errors or fabricated result. Merely forcing process.exit is not cleanup evidence.
   Preserve actual provider parsing and unknown dispatch. Review cancellation propagation and
   body-reader release; use the existing transport seam rather than replacing application services.
4. Resolve recovery of an evaluation left by a dead process while another remains alive. The
   current no-peers-at-start condition can leave it running indefinitely. Add bounded ownership-
   aware recovery without invalidating a live peer's evaluation, and test both cases. This follows
   the normal composition restart requirement, not a new platform feature.

Write necessary design corrections first. Reproduce concrete defects before fixing them.
Update the requirement matrix with executed evidence and remaining honest limits. Run meaningful
focused checks, then one full check and required web build on the final change. Do not repeat a
passing full suite for docs-only changes. Review/commit this Astra pass and checkpoint; update
INDEX/JOBS/report. Stop for Astra review before starting later003wf children.

No preview/browser enrollment submission, external execution, real provider/wallet/transaction,
secrets, worker host, signing/deploying, Git push, spending, publication, research or Day One.
003web/003wec pending UI gates remain. All original parent requirements and queued additions remain.

## Astra changes

This handoff review records executed verification and the bounded continuation. BUILD_STATE is
updated with prior-session termination and next dispatch. JOBS remains the existing003wf1 row;
Claude marks it taken on resumption. No implementation or Git mutation by Astra in this pass.

## Active evaluation continuation after recovery — 21:09 Pacific

Astra added server/test/astra-evaluation-recovery-review.test.ts using actual Evaluations and
ManagedRuntime, in-memory records and a deterministic held fictional provider. Peer recovery
marks both runtime invocation and evaluation stopped/unknown while the old call is delayed.
When that answer arrives, the old evaluation loop currently dispatches later cases and rewrites
its stopped row to complete. Independent focused1/1FAIL; the diff shows additional completed
case invocations after the first recovered unknown. No actual process, wallet or network used.

Recovery must fence continuation, not just classify the row. Before each new paid dispatch and
each result save/finalization, atomically honor the evaluation's current runner/state. A delayed
expired process cannot resurrect a stopped evaluation after another process recovers it; a live
peer's evaluation must still continue normally. Preserve completed cases already recorded. The
new test requires stopped row/results unchanged and exactly one original provider call. This
is part of item4 above, not a new feature. Claude owns correction and local commit.

Also keep final cleanup evidence tied to actual owned tasks. compose currently sleeps20ms after
closing gates and samples runtime.activeCount; that is not a proof that all build/evaluation
continuations, abort handlers and timers finished. Prefer awaited tracked completion under the
shared deadline, with truthful reporting if an owner cannot finish. Preserve bounded handling
of a raw non-cooperating adapter and no unhandled errors. Report design corrections accurately:
this continuation's implementation is already in progress without a newly committed design;
do not describe a later design write as having preceded these code changes.

Required full check60162 after the Astra regression terminated1: lint/types clean,1440pass,
1fail (only the new evaluation-continuation probe),1skipped. The required process phase did not
run because the main phase failed. This is in-progress evidence, not handoff acceptance.
No duplicate unchanged rerun; wait for correction and independently repeat the affected case.

Review of new design section12.8: the retention test plan says kill a child as soon as the first
local deletion is observed. A parent polling SQLite may observe only after the whole small batch
finished, so that alone cannot prove an interrupted cleanup. Require observed partial progress
(with eligible work genuinely still pending) at the interruption, then completion after restart.
Use a deterministic supported boundary or a clearly labelled fault that establishes the actual
intermediate state; don't silently accept a test that also passes when every deletion precedes
the kill. Preserve the stated limitation about the interior of a synchronous SQLite deletion.

At21:24 the actual new retention process test confirms that evidence gap: it waits only for
stored().length < N, then kills B. It never asserts after.length > 0. Its later assertions all
pass with after=[] and all objects already deleted, so the test can pass without a mid-cleanup
interruption. Strengthen before acceptance as requested above; report this observed source gap
rather than claiming the current test demonstrates interruption. Reservation barrier/source looks
appropriate: hold open_hold before node application, stop, apply late, recover exact one attempt.

## Independent correction review — 21:31 Pacific

Astra focused check9225 passed8/8 across evaluation-continuation, held response body and
configured builds (61.89s). The retention source now uses normal maintenance batch1 and asserts
0 < remaining < N after kill, so the previously reported empty-after gap is addressed; actual
process verification remains for the final check.

A new deterministic admission-boundary probe reproduces the other half of item4's atomicity:
server/test/astra-evaluation-admission-review.test.ts FAILED1/1. A peer recovers the eval after
execute's owns() read but immediately before ManagedRuntime.start reserves/dispatches the case.
The stopped evaluation still sends one provider request. The test wraps only the call boundary
and uses the real runtime/evaluations and in-memory records; this is a controlled interleaving,
not actual multiprocess evidence. Guard the eval run's running state and runner inside the same
admission transaction as the invocation/budget reservation. Preserve ordinary trial calls and
idempotent retries; test both the refusal and continued live-owner evaluation behavior.

The existing late-answer probe now passes, and conditional result saves are appropriate. Do not
remove that correction. The additional check closes the original explicit atomic-dispatch
requirement; no new product scope. Claude must review/commit this Astra test and docs.

Source review of owned cleanup: runtime/evaluation promises are tracked now, but compose's
runtime.settledAll excludes the build-worker/maintenance owner promises still pending after
ownersDone times out. Include their completion in post-fence observation/awaiting and report
unfinished owners truthfully. Math.max(250, deadline - Date.now()) grants a further250ms after
the documented single deadline; either keep the original bound or explicitly document/test a
small cleanup allowance. This is source review, not a reproduced late-write defect. Avoid
claiming zero total owned work solely from the runtime count. New full check is pending final
correction; do not repeat unchanged suites solely for documentation.

At21:34 Astra independently reran both evaluation regressions against the new admission guard:
2/2pass. The running/runner check is now inside the same Store transaction as reservation and
invocation insertion. Original8/8 focused lifecycle evidence remains valid for the unchanged
body/build paths. Final full-check/process evidence and owned-stop follow-up remain pending.

## Final handoff review at9b8fbbe — 21:40 Pacific

Sole correction exec65377 exited0 and exact-session CIM is absent. Independent focused checks
passed8/8 and the two evaluation probes2/2. Required independent full check64904 is running:
lint/types clean, main1440pass/1skip; lifecycle phase pending. Builder reports19 lifecycle pass
and web build success. Code/tree inspected; no second writer started.

Reservation/retention and evaluation/admission corrections satisfy their reviewed narrow
requirements. One existing item3 follow-up remains before003wf1 acceptance (it was already
recorded above at21:31 and is not a new milestone):

- compose.stop awaits runtime.settledAll after fence close, but not still-pending build-worker
  and maintenance stopper promises. last.work_running therefore excludes these owner tasks.
  Await/observe those owner promises too, and report unfinished owned work truthfully. Do not
  imply total cleanup from a zero runtime-only count.
- The stated shared deadline is not exact: Math.max(250, deadline - Date.now()) adds up to250ms
  once it has elapsed. Either reserve cleanup inside the shared deadline or explicitly define
  a small bounded cleanup allowance in the design/report/tests. Do not just claim the current
  code obeys a deadline it extends. Preserve prompt cancellation and the DB gate.
- startBuildWorker's wait() creates an unref'ed timeout whose losing Promise.race timer is never
  cleared. Its5s drain/2s cleanup timers can remain after early work completion. Clear those
  owned deadline timers when the wait settles; bounded stop tests should observe actual owner
  completion/timer cleanup, including a held build whose transport never cooperates.

These are grounded source findings, not a newly reproduced data-loss or late-write claim.
Keep the correction small, write the design amendment first, add meaningful targeted evidence,
run required checks after code changes and update the report. Remove the report's now-stale
limit saying a dead evaluation requires startup with no live peer; that was fixed. Keep precise
in-process versus actual-child and synthetic versus live labels. Stop for Astra review;003wf2
remains queued until this narrow cleanup follow-up is accepted. Same model/auth/boundaries.

Independent full check64904 completed0 at21:41: lint/types clean, main1440pass/1skip and all19
lifecycle tests pass (136.69s lifecycle phase). This verifies the implemented reservation,
retention, model/build and peer recovery cases. The narrow owned-cleanup/source-reporting
follow-up above remains; no milestone or003wf parent acceptance is implied.

## Design12.10 review — 21:44 Pacific

The reserved cleanup window inside one deadline and separate owners_running/work_running counts
address the source findings without broadening the job. One test-design correction: Node's
process.getActiveResourcesInfo() does not expose an unref'ed Timeout. Astra independently ran a
finite Node probe: Timeout counts before0, after referenced setTimeout1, after timer.unref()0,
after clearTimeout0. Therefore the proposed resource-count test alone would already pass with
the old leaked unref'ed wait timers. Observe actual timer creation and clear/settlement for the
worker's waits (e.g. scoped test instrumentation, with full restoration), and show the relevant
regression fails on the old implementation. No production seam solely for this assertion is
required. Preserve real configured held-build coverage for owner completion and deadline.

