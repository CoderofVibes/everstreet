# App-check lifecycle: two finite reproductions

Claude67893 remains the sole002e writer. Reviewed unfinished appChecks.ts/appVersions.ts/
workerEngine.ts. These findings came from real AppChecks/AppCheckWorker with a labelled engine
double; they do not run generated code, WSL, a microVM or a model. No app files edited by Astra.

## Reproduction setup

An inline Node/tsx probe created a fresh in-memory Store and the real everstreetApi with an
explicit scripted BuildProvider. It joined fictional Ava, created a digital API estimator
project, set its synthetic build budget, generated QUOTE_BUNDLE through Builds/BuildWorker,
and requested a check through AppChecks. The engine identity was explicitly test-double.
The returned report named the exact check/attempt/digest/recipe/engine and all bundle syntax
paths/case ids. No database rows were hand-seeded. Each world was closed after the probe.

##1. A completed check beyond the default lease stalls the whole queue

Engine preflight succeeds; engine.run advances AppChecks' injected clock31seconds and returns
a valid all-pass report immediately. AppCheckWorker uses its default30second lease and75second
run limit. Observed:

```json
{"state":"running","leaseExpired":true,"nextClaim":null,"runs":1}
```

The worker's polling callback checks cancellation/staleness but does not renew the lease.
finish rejects the expired lease and leaves the completed job running. A second queued check
cannot be claimed because runNext counts every running row, including that expired one.

Maintain a bounded live lease throughout preflight/run/cleanup, and make expired-work recovery
compatible with actual single-worker ownership. Never blindly reclaim a still-live process,
or overwrite a newer attempt. Test execution longer than30seconds but within the real bound,
lease loss, slow preflight, startup alongside another live worker, crash/recovery and the next
queued job. recover currently rewrites all running rows without a live-lease distinction;
coordinate it with the host-side single-run lock from WorkerImplementationReview.

##2. Cancellation during preflight still dispatches and passes

The engine's asynchronous preflight invokes checks.cancel(owner,checkId) while the record is
running, then returns success. run returns a valid report immediately. Observed:

```json
{"cancelRecorded":true,"state":"passed","dispatched":true,"runs":1}
```

The pre-dispatch guarded write does not test cancel_requested_at. The interval begins only
after dispatch; an immediate result finishes before its first tick and finish also ignores
cancellation. Recheck cancellation in the transactional dispatch gate and at outcome
application, with a clear order for cancellation versus an already final result. The first
case above should make zero engine.run calls and finish cancelled. Preserve ownership/attempt/
lease fencing and unpaid deterministic check retry separate from paid generation.

## Completion boundary

Keep adapter calls and preflight bounded independently of a cooperative AbortSignal. A timer
that only aborts does not bound an adapter that never settles, and cleanup failure must not
silently release the one-worker admission slot. No actual host setup is ready from these
double results. Existing WorkerImplementationReview still applies to committed5e26b6d.

Astra changes: this pass, INDEX and BUILD_STATE. Required check result recorded in checkpoint.
No new job/duplicate writer, host/preview changes, Git writes, signing/spending/deployment or
research access. Let Claude finish002e and address these before acceptance; retain allsix.

## Follow-up at4764f9e

Source and regression coverage reviewed in AppPreviewRouteReview: worker moved to
appCheckWorker.ts, lease renewal/recovery and transactional cancellation now implemented;
finite nonsettling-engine and cleanup-block tests added. Host implementation contract remains
to be fixed/verified. Do not re-request the original missing-renewal/preflight-cancel code
without checking this correction. Independent fullcheck recorded in BUILD_STATE.
