# 003wf1 Configured maintenance and provider transport lifecycle: report

Job: `docs/astra/jobs/2026-11-04_003wf1_configured-maintenance-lifecycle.md`, the first child of
003wf. Design: APPLICATION_COMPOSITION §12, written and committed before the code (`8edf410`),
with §12.7 recording what was built.

**Status: in review**, for Astra. 003wf stays partial. The 003web and 003wec browser gates stay
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
| Final | Design §12.7, this report, JOBS, INDEX |

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
| Astra: startup with a peer holding live work | `process_presence` and `runtime_invocations.runner`; `recover({ isLive })`; evaluation runs stopped only with no live peer; build worker recovers only lapsed leases | process test: B starts while A's provider request is held; it stays `running`, then completes |
| Astra: two recoverers settle once | `finish`: the conditional update is the claim; ledger and admission follow only if it moved the row | Astra's runtime-recovery probe 1/1 |
| Astra: synthetic RPC evidence quality | Only the modelled business; bounded per-block snapshots; envelope validation (tags, one FunctionCall, receiver, known block, gas, no deposit, nothing trailing), signature and nonce; one transaction per signed bytes | Astra's RPC probe 2/2; `lifecycle-rpc.test.ts` 3 (negative cases, pinned views, eviction) |
| Astra: stale `customer_authorization` | Derived from sign-in, its browser callback and customer use | composition inventory |

## Checks (final code, `1eaf7bc`)

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
- **Not covered here:**
  - a stop during a **reservation** (open_hold) or during **retention cleanup**, in a child: only
    settlement and provider dispatch were barriered;
  - a provider **timeout** (the error path was tested);
  - the build worker's live-peer case in a child (it rests on the existing lease rules and
    `recoverAtStart: "expired"`).
- **Stated limits:**
  - restart recovery of a settlement waits out its 30 s per-item lease;
  - an evaluation run left by a dead peer stays `running` until a process starts with no live
    peer;
  - admitted requests get at most 2 s within the shared stop deadline before being answered 503.
- **For later 003wf children:**
  - Direct/Gated commerce;
  - unresolved writer history;
  - the coherent 100/20/80/79 journey through normal APIs;
  - the wider purchase/provider/close restart and nonce/migration matrix;
  - browser review;
  - the prepared-only rehearsal packet.
- **Owner status surface:** only `/api/system/capabilities` changed (`maintenance`,
  `maintenance_observed`, `customer_authorization`); no UI changed in this child.
