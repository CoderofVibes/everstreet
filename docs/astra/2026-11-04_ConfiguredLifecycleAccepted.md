# Configured maintenance lifecycle accepted; Direct acquisition dispatched

Tony asked to continue in this thread. The six-milestone vision and approved UI direction remain
the governing scope. This pass accepts only job003wf1, not its parent003wf or any milestone.

## Evidence reviewed

Final implementation `cdc51c0`, final report/design/JOBS `222e49f`. Claude exec71521 exited0;
the exact recorded session was absent from the read-only process check before the next dispatch.
The worktree was clean before this pass. No duplicate writer, preview or Astra test remains.

- Astra's full check64904 at the preceding implementation completed0: lint/types clean,
  1440 main tests passed,1 existing skip,19 lifecycle tests passed. It covers the actual configured
  reservation/settlement/restart/retention cases and the two evaluation regressions.
- Astra independently verified the final cleanup changes with check78063:5/5 across
  lifecycle-cleanup, lifecycle-body and astra-composition-stop-review (9.67s). This directly checks
  held builds, actual owner completion, the shutdown deadline, cleared losing timers, held response
  bodies, request cutoff and refusal after close.
- Claude's final full check at `cdc51c0`:1440 main passed,1 skipped,21 lifecycle passed,
  lint/types clean; web build passed. The final two tests were inspected, including scoped timer
  instrumentation with restoration. The old implementation left one timer open; the fix leaves0.
- Astra separately demonstrated why Node's active-resource count was inadequate: a referenced
  timer counted1, the same timer after unref counted0. That false-positive test approach was replaced.

## Narrow acceptance

The job's explicit configuration and off-default behavior, configured versus observed health,
normal maintenance scheduling, admission/drain/fence/database ordering, bounded shutdown,
production model adapters over synthetic transport, and finite process/restart evidence have
implementation and meaningful test coverage. Recovery preserves uncertain operations rather
than resending them; evaluations cannot continue after recovery or admit a new case under a
stopped run. Owner stoppers and runtime work are both awaited/reported. Cleanup reserves time
inside the single deadline, and build-worker waits clear their losing timers.

The report's limits are retained: build/evaluation peer cases use two compositions in one OS
process; runtime provider timeout is adapter-level; reservation covers graceful stop and
settlement also covers kill; retention interruption is between deletions, not inside SQLite.
These satisfy this child at their stated scope and do not prove the parent's wider matrix.
No UI changed in this infrastructure child, so another unchanged browser tour is not required.

## Next sole-writer dispatch

Dispatch `jobs/2026-11-04_003wf2_direct-sale-wallet-journey.md` now. Use a fresh Claude CLI session
for this distinct bounded job, exact `claude-opus-5-5` with high effort and subscription auth;
verify its resolved model. Read and implement the entire brief, write the design before code,
use the supplied pinned NEAR references with version checks, and stop for Astra review after
meaningful tests, report, finite browser harness and local commits. Do not silently reduce the
wallet journey to read-only handover or a fixture state toggle.

Keep Direct sale central: proposal, review, funding, matching acceptance, proven close,
reconciliation, customer continuity and truthful claims. Preserve Gated acquisition, all other
parent003wf evidence groups, worker readiness, imports/network/additional products and the
approved003x/005e/006b/006c additions. All six milestones remain open.

Pending customer enrollment/revocation browser permissions remain pending; no retry or bypass.
No external transactions/providers, deployment, spending, publication/push/submission, real data,
research-library access, worker-host work or Day One access is authorized by this dispatch.

## Astra changes

Added this pass; updated INDEX, JOBS, the003wf2 dispatch header and local BUILD_STATE. No product
code, contract/config/script or Git write by Astra. The code verification above is complete;
these documentation changes do not require another unchanged suite solely for their prose.
Claude reviews and locally commits the handoff before building on it.
