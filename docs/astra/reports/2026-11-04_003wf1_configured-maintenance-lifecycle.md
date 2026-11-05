# 003wf1 Configured maintenance and provider transport lifecycle: report

Job: `docs/astra/jobs/2026-11-04_003wf1_configured-maintenance-lifecycle.md`, the first child of
003wf. Design: APPLICATION_COMPOSITION §12, written and committed before the code (`8edf410`),
with §12.7 recording what was built.

**Status: in review again**, after the continuation that Astra's ConfiguredLifecycleHandoffReview dispatched (its four items, below). 003wf stays partial. The 003web and 003wec browser gates stay
open, and no browser, wallet, provider or network action was taken.

## Commits

| Commit | What it holds |
|---|---|
| `b537e06` | Astra's GuardedRevokeSourceVerified, the 003wf/003wf1 sequencing, INDEX; JOBS: 003wf1 taken |
| `8edf410` | Design §12, before any code |
| `63ad82b` | Maintenance config and composition, admission/drain/fence/close, the model seam, listen-then-start entry, in-process tests |
| `6ad77a5` | Astra's ConfiguredLifecycleDesignReview and composition-stop probe |
| `cc151d4` | One shutdown boundary: database gate, settling fence, collective stop, requests answered 503 at cutoff, truthful `customer_authorization` |
| `081f017` | Astra's LifecycleRpcEvidenceReview and RPC probe |
| `e83a79b` | Actual child-process tests; the hardened synthetic RPC and its negative cases; listener close order |
| `f711bd8` | Astra's runtime-recovery and fence-close probes |
| `1eaf7bc` | Recovery never takes a live peer's work, one claim per completion, the fence finishes its waiters, one shared stop deadline, `npm test` in two phases |
| `662445a` | Design §12.7, this report, JOBS, INDEX (first handoff) |
| `127e612` | Astra's handoff review; JOBS: the continuation taken |
| `a9635e0` | Item 3 (the whole response body) and item 4 (evaluations recovered by owner) |
| `7a2ef60` | Design §12.8 (after `a9635e0`, before items 1 and 2) |
| `a40eab1` | Item 2: the configured build adapter, its limits and peers |
| `001dd11` | Astra's probes and docs, including the queued 003wf2 brief (not dispatched) |
| `52f22ea` | Item 1: process barriers for reservation and retention; evaluation continuations fenced; owned work awaited |
| `8ae81fc` | Astra's evaluation-admission probe |
| `db68fdb` | Evaluation case admission checked in the reservation's transaction |
| `9b8fbbe` | Design §12.9, this report, JOBS (second handoff) |
| `008a23a` | Design §12.10, before the cleanup correction's code |
| `3a0ca46` | Astra's 12.10 review |
| `cdc51c0` | Owned cleanup exactly bounded; owner stoppers awaited and reported; build-worker wait timers cleared |
| Final | Design §12.10 evidence line, this report, JOBS |

## Evidence matrix (each requirement of the brief)

| Requirement | What was built | Evidence |
|---|---|---|
| 1. Design first | §12 | `8edf410`, before `63ad82b` |
| 1. Explicit validated settings, finite limits, off by default | `maintenance` section: every field required and bounded; needs customer use; `enabled: false` is absent | `lifecycle.test.ts`: complete, partial, unknown, out of range, op deadline over budget, no customer use |
| 1. Existing supervisor, leases, guards, CustomerUses | One `MaintenanceSupervisor` per process over its own `guardAdapters` CustomerUses | the settle test below, through the real composition |
| 1. At most one local supervisor; processes coordinate through durable leases | A fresh opaque holder per process; the existing lease | process test: A works, B is standby (lease and status still A's), A stops, B takes over at the next generation |
| 1. Legacy worker not started | unchanged | composition inventory |
| 2. Configured capability separate from observed health | `maintenance` capability (configuration only); `maintenance_observed` from `maintenance_status` (no holder, business or counts) | `lifecycle.test.ts`: `not_started` before start, `running` only after a holder's pass, `stopped` after stop |
| 2. Which tasks run without a writer/provider | The capability text says so (expiry and cleanup; reservations and settlements wait) | `lifecycle.test.ts` |
| 2. Owner-scoped health, no private material | unchanged `maintenanceHealth`; the new worker projection has no business data | `lifecycle.test.ts` asserts no holder or business in it |
| 3. Admission stop, scheduling stop, drain or fence, cancellation, DB-close order; idempotent | Admission 503 at once; every owner's stop starts together, then they and admitted requests drain under one shared deadline; the network fence and the **database gate** close; still-running requests are answered 503; resources close; `lastStop()` records a forced drain or failures | `lifecycle.test.ts` (stop before start, twice, start after stop, admission); Astra's composition-stop probe 2/2 (a stalled upload gets 503 before its body is released; no closed-storage error) |
| 3. A hung adapter can't cause an unbounded stop or late DB access | `Fence.close` rejects every outstanding call at once (Astra's fence probe); the gate refuses any later DB access with `StoppedError` | Astra's fence probe 1/1; `lifecycle.test.ts`: a held RPC answer after stop ends 503 with no session written; process test: graceful stop with a settlement held at the node exits within the stop budget |
| 3. Unknown dispatch preserved; nothing fabricated | Late continuations are refused, never completed; recovery marks a gone runner's request unknown, never resends | process test: a provider answer held across a stop ends 503; after restart the request is `unknown`, the provider is not called again, nothing is charged |
| 4. A labelled model network seam over the real Anthropic adapters | `modelFetch` and `modelFetchLabel` into `httpsTransport`'s own `fetchImpl` | process tests: inventory provenance; one customer use runs on `AnthropicRuntime` over synthetic HTTP: 900/120 tokens, `charged_microcents` 15000, `completed`/`extracted` |
| 4. Budgets, parsing, accounting, provider errors, cancellation preserved | Production code throughout | process test: a 529 through the real adapter is recorded `unknown`/`provider_error` with nothing charged (usage after dispatch is uncertain, as production says), not delivered, and the unit returned by maintenance |
| 4. Test transport refuses unexpected destinations; never a real fetch | `entryChild.ts` forwards only the configured RPC endpoint and the two Anthropic paths; anything else throws | by construction in the child; `lifecycle.test.ts`'s RPC refuses other URLs |
| 5. Actual child processes, disposable storage, synthetic transport at supported boundaries | `entryChild.ts` runs `serve.ts` (the entry's own logic) with only the two transports injected; the test process answers them over IPC (`lifecycleWorld.ts`) | `lifecycle-process.test.ts`, 8 tests, 256 MiB heap, 90 s per-child deadline, exact cleanup |
| 5. Stop during a settlement; restart without duplicates | barriers at `send_tx` | graceful stop and forced kill, each with the settlement held at the node: after restart (once the 30 s per-item lease lapses) it is recovered by its exact transaction, with **one** settle_hold and **one** unit charged |
| 5. Two holders, lease takeover | presence plus the existing lease | process test (above) |
| 5. Late adapter completion after stop | gate and fence | `lifecycle.test.ts` (in process); process tests (held provider; held settlement) |
| 5. Process shutdown and listen failure through the entry | `serve.ts`: listen, then start; listen failure stops and exits 1 | process test: EADDRINUSE exits 1 with no lease or status row (nothing started) |
| Astra: startup with a peer holding live work | `process_presence` and `runtime_invocations.runner`; `recover({ isLive })`; evaluation runs recovered by their runner (§12.8/12.9); build worker recovers only lapsed leases | process test: B starts while A's provider request is held; it stays `running`, then completes |
| Astra: two recoverers settle once | `finish`: the conditional update is the claim; ledger and admission follow only if it moved the row | Astra's runtime-recovery probe 1/1 |
| Astra: synthetic RPC evidence quality | Only the modelled business; bounded per-block snapshots; envelope validation (tags, one FunctionCall, receiver, known block, gas, no deposit, nothing trailing), signature and nonce; one transaction per signed bytes | Astra's RPC probe 2/2; `lifecycle-rpc.test.ts` 3 (negative cases, pinned views, eviction) |
| Astra: stale `customer_authorization` | Derived from sign-in, its browser callback and customer use | composition inventory |

## The continuation (ConfiguredLifecycleHandoffReview)

**Order.** Items 3 and 4 were reproduced and fixed before design §12.8 was written. §12.8 states
that, and preceded the code for items 1 and 2. The follow-ups in §12.9 were written after their
code.

| Item | Built | Executed evidence | Limits |
|---|---|---|---|
| **3. The whole response lifetime** | Every body read passes the fence; at close a pending read is rejected and the underlying reader cancelled; url/redirect kept; owned runs and evaluation loops awaited under the shared deadline; `lastStop().work_running` | **Reproduced first:** after stop the runtime still had 1 request reading a held body. `lifecycle-body.test.ts`: headers then a held body from a non-cooperating transport; stop ends the request (503) and the run and its timer (`work_running` 0); no unhandled error; nothing written after close or fabricated; the next composition records it unknown, never resent | In this process (the composition's own state is observed); the RPC body path rests on the same wrapper and isn't tested separately |
| **4. A dead peer's evaluation while another lives** | `eval_runs.runner`; recovery by owner at start and every 10 s; a recovered run's loop never continues (checked before each case, at admission in the reservation's transaction, and on every result write) | **Reproduced first:** stayed running indefinitely; Astra's two probes failed. `lifecycle-peers.test.ts`: a peer starting leaves a live evaluation running and it completes; when its process stops, the survivor stops it within a tick, the in-doubt case is unknown, nothing resent. Astra's recovery and admission probes pass | Two compositions in one process, not two OS processes |
| **2. The configured build adapter** | Production `AnthropicProvider` through the composition's worker; the worker recovers lapsed leases each poll with peers | `lifecycle-builds.test.ts`: accounting (1500/800 tokens, 55,000 microcents); budget refusal (409, no provider call); cancellation (cancelled, never resent); its configured 10 s limit (failed/timeout); a peer starting leaves a live build running with its lease and it completes; when its process stops, the survivor recovers it after the 30 s lease as `needs_reconciliation`/`outcome_unknown`, never resent. **Reproduced first:** the survivor never recovered it. `lifecycle.test.ts`: the runtime's timeout through `httpsTransport`'s own limit | Peers are two compositions in one process. The runtime timeout is adapter-level evidence, because the composition's provider timeout is a fixed 120 s |
| **1. Reservation and retention barriers** | A labelled test clock in the child (`LIFECYCLE_CLOCK_OFFSET_MS` via the composition's own `now`) | `lifecycle-process.test.ts`: a graceful stop while the confirm's `open_hold` is held at the node (the confirm gets 503); after restart it is reserved once, with one `open_hold`. Retention: with batch 1, the kill lands with some results deleted and some still due (asserted); at most the one item in flight lacks its object; a restart deletes every result and input and nothing is left on disk | The reservation case is a graceful stop only (kill is covered for settlement). Retention can't hold a barrier inside a synchronous SQLite delete; its interruption is between items, made deterministic by batch 1 |

## The final cleanup correction (Astra's final handoff review, 21:40)

| Finding | Built | Executed evidence |
|---|---|---|
| Stop awaited only the runtime's work after the gates, not owner stoppers still pending | Owner stoppers (build worker, maintenance) and the runtime's owned work are awaited together after the gates close; `lastStop().owners_running` and `work_running`; `forced` if either is above 0 | `lifecycle-cleanup.test.ts` (in process, real composition), a build held by a transport that never answers or honours abort: `owners_running` 0, `work_running` 0, nothing fabricated. **Reproduced first:** the stop record had no owner count |
| The cleanup wait could run past the stated deadline | One exact deadline D with a cleanup reserve R = min(250, stop timeout / 4) inside it: drains until D − R, cleanup until D | The same held-build stop takes at most `stop_timeout_ms` + 100 ms (scheduling tolerance) |
| `startBuildWorker`'s losing wait timers were never cleared | Its drain and fence waits clear their timer whichever side wins | A build finishing during the drain: not forced, succeeded, and every timer the stop created has fired or been cleared. This is observed by scoped instrumentation, because Node's active-resource count doesn't show unref'd timers. **Reproduced first:** with the old wait, one timer stayed open |

## Checks (final code, `cdc51c0`)

- **`npm run check`:** exit 0, lint (425 files) with no warnings, types clean.
  - **Main phase:** 1440 passed and 1 skipped.
  - **Lifecycle phase:** 21 passed across 5 files (10 child-process, 2 peer, 6 build, 1 body,
    2 cleanup).
- **`npm run web:build`:** exit 0 (943.06 kB; `web/` unchanged).

## Checks at the second handoff (`db68fdb`)

- **`npm run check`:** exit 0, lint (424 files) with no warnings, types clean.
  - **Main phase:** 1440 passed and 1 skipped (166 files plus 1 skipped).
  - **Lifecycle phase:** 19 passed across 4 files (10 child-process, 2 peer, 6 build, 1 body),
    137 s, mostly deliberate lease waits.
- **The heavy lifecycle files moved.** The four long files now run in the second phase, after the
  disk-bound protected-store test timed out at 5.01 s alongside them in the main phase. That test,
  its sample and its timeout are unchanged, and nothing retries.
- **Astra's probes during the continuation** (evaluation recovery, evaluation admission) failed
  when added and pass now.
- **`npm run web:build`:** exit 0 (943.06 kB; `web/` unchanged).

## Checks at the first handoff (`1eaf7bc`)

- **`npm run check`:** exit 0, lint (419 files) with no warnings, types clean.
  - **Main phase:** 1437 passed and 1 skipped (164 files plus 1 skipped).
  - **Child-process phase:** 8 passed (83 s, most of it the deliberate 30 s lease waits).
- **`npm test` now runs in two required phases**, the child-process file after the main suite.
  - **Why:** the first full run with it in parallel failed the 200-write protected-store test at
    its 5 s timeout, under the extra load.
  - **What wasn't changed:** that test, its sample, its timeout, and nothing retries.
- **Earlier in this job,** Astra's new probes failed when added (composition-stop 2, RPC 2,
  runtime-recovery 1, fence 1). Each was fixed in code, not skipped.
- **`npm run web:build`:** exit 0; `web/` is unchanged by this job (943.06 kB, CSS 73.40 kB).
- **Nothing live:** no real wallet, transaction, provider call, credential read, signing, deploy,
  spending, push or publication. The model key value in tests is a fictional placeholder in a
  test-set variable; all keys are ephemeral.

## What this establishes, and what it leaves

- **Established, synthetic:** the configured composition schedules maintenance by itself; it
  settles a use reserved by the real writer and run by the real runtime; it stops within a bound
  with no access after close; restart never repeats a provider request or a settlement; two
  processes share one database without taking each other's live work.
- **The first handoff's gaps** (reservation and retention barriers, the build adapter, provider
  timeout, the build's live peer) are covered by the continuation above, with the limits stated
  there.
- **Stated limits:**
  - restart recovery of a settlement waits out its 30 s per-item lease;
  - admitted requests get at most 2 s within the shared stop deadline before being answered 503;
  - the stop's cleanup reserve is min(250 ms, a quarter of `stop_timeout_ms`), inside the deadline;
  - a dead peer's evaluation is stopped by a live survivor within one presence tick (10 s) after
    its presence ends; a crashed peer's presence first has to lapse (30 s).
- **For later 003wf children:**
  - Direct/Gated commerce;
  - unresolved writer history;
  - the coherent 100/20/80/79 journey through normal APIs;
  - the wider purchase/provider/close restart and nonce/migration matrix;
  - browser review;
  - the prepared-only rehearsal packet.
- **Owner status surface:** only `/api/system/capabilities` changed (`maintenance`,
  `maintenance_observed`, `customer_authorization`); no UI changed in this child.
