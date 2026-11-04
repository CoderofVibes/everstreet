# 003n report: customer execution foundation

Claude, 2026-11-03. Job: [003n](../jobs/2026-11-03_003n_customer-execution-foundation.md).
Commit `414015a`. Design: `docs/design/CUSTOMER_USE_RUNTIME.md` §13 (in the same commit).
Builds on 003m1 (`208c64b`).

## The approach, and why

A customer execution is a `runtime_invocations` row with the new purpose **`customer_use`**.

- **One set of runtime rules.** It shares the business's runtime budget, the operator ceiling,
  the concurrency limit, the exact ledger (`runtime_usage`) and `recover()`. There is no second
  ledger to keep consistent, and no duplicated spend.
- **The migration.** SQLite can't alter a CHECK, so `openDb` rebuilds the table once, keeping
  every row and column (tested on a pre-003n schema).
- **Audit of every shared-table reader:**

  | Reader | Change |
  |---|---|
  | `ManagedRuntime.list` | Excludes `customer_use` |
  | `owned`, and through it `GET /api/runtime/invocations/:id` and `cancel` | Answers 404 for it |
  | `finish` | Never writes its output |
  | `books.spend` | Counts its cost only (note updated) |
  | `evaluations`, by `eval_run` | Unaffected |

  `answerFor` and the `ownerOnly` admission are unchanged, and the customer path never uses
  them.
- **The customer side.** `customer_executions` (one per request, one-to-one with its invocation)
  holds the admission evidence, the input source and the protected result's reference, scheme,
  outcome and retention deadline.

## What exists

- **Routes:**
  - `POST /api/customer/uses/:id/execute`;
  - `POST /api/customer/uses/:id/execution/cancel`;
  - `GET /api/customer/uses/:id/result`, the requesting customer only;
  - the request's status now carries an `execution` view.
- **Before dispatch** (free, nothing reserved or sent):
  - the request is `reserved`, with no conflict;
  - the runtime is available, and protection with `load`/`delete` is configured;
  - the adapters, binding and offer are valid;
  - `releaseFor` passes: the release is active, under the same model, validator and policy, with
    the same artifact digest;
  - the input is the protected copy or a resubmission matching the prepared sha256 and length;
  - the fresh pinned evidence, fenced against the request's mark (003m1), shows platform
    metering, the plan unchanged, row 2 serving at that block, slot 0 unused, and
    `serve_until − T_B ≥ runtime limit + margin`.
- **The dispatch transaction.** It rechecks the request, offer, release, binding and the local
  control epoch read before the await (`control_changed`). It runs the runtime's own
  budget/ceiling/concurrency checks (now coded on this path only), then inserts the running
  invocation, the worst-case reservation and the execution, and advances the evidence mark.
- **At most one provider call.** The invocation key is derived from the request, and only its
  creator calls the provider.
- **The result.** It is validated by the existing validator, protected through the seam after the
  record is finished, and never stored on the business's record. A late answer after a
  cancellation is neither kept nor delivered; its usage is still accounted. A protection failure
  is `result_unavailable`, with no re-run.
- **Retention.** Results past their deadline are refused (`result_expired`), and
  `expireResults(limit ≤ 25)` deletes them through the seam.
- **Input protection is durable.** A failed or unfinished protection is retried once by a
  same-key prepare. Racing attempts keep the first reference and delete the other.
- **Units.** Every execution view says `reserved_awaiting_settlement`. The request stays
  `reserved`, its allocation held, and the chain unchanged. No unit is claimed charged or
  refunded.

## Evidence

**Tests.** `server/test/customer-execution.test.ts` has 16 tests. Each runs through the real app
with the fixture chain (contract JSON), the scripted runtime and the synthetic protection, all
with finite ceilings.

| Area | Covered |
|---|---|
| The main path | Reserved, then exactly one provider call, then a protected result. The ledger is `reservation, actual, release`; actual microcents equal the invocation's; the budget rises by exactly its cost. No customer text appears in any customer-use row, usage, execution, event or request. The chain is unchanged. |
| Duplicates | A lost reply, and two competing executes: one call, one invocation |
| Not configured | No provider; no protection |
| Input | Changed input; input needed; failed protection retried once, not twice |
| Release | A model change (`release_needs_recheck`); a retired offer |
| Who sees it | Another customer and the owner get 404 on execute, result, status, the detail route, cancel and the list |
| Limits | A budget below the worst case; concurrency held by two gated owner trials, which keep their own behaviour |
| Usage | Partial and unknown usage keep their reservation and give no result |
| Stopping | A cancellation, then a late answer (not kept, usage counted); a timeout |
| Fresh evidence | Expiring, expired, revoked, stale, conflicting (sticky) and used-slot holds, each with zero provider calls |
| Sale | During admission (`control_changed`, then served afterwards); during execution (the customer reads it; neither owner can) |
| Retention | Expiry, deletion through the seam |
| Restart | A crash after dispatch across a file-backed restart: `unknown`, reservation held, never re-run, the late finish ignored |
| Migration | A pre-003n schema is upgraded with its rows kept; reopening is a no-op |

**Mutants**, one at a time, each restored with an empty diff against the staged copy:

| Mutant | Caught by |
|---|---|
| The result stored on the business record | The privacy test |
| The owner detail route not excluding `customer_use` | The owner-routes test |
| The late-answer check disabled | The cancellation test |
| The control-epoch fence removed | The sale-during-admission test |

```
npm run check        Test Files 47 passed (47); Tests 621 passed (621); lint and types clean
npm run web:build    built (existing chunk-size advisory only)
```

No contract or fixture change, so no Rust run.

## Limits and what remains

- **Unit settlement and release** (`settle_hold` with the stored UseAuth, releasing unused units,
  freeing the allocation) are the next slice. Until then, one request per customer per plan is
  outstanding.
- **Customer UI**, wallet sign-in, a live reader with block timestamps, operator signing, a real
  provider configuration, and a real protection implementation with deletion: each is a live act
  or a later slice. None is wired.
- **The residual race.** A sale or revocation can land after the fresh read; it is bounded by the
  one-unit hold.
- **Not tested here:** the `artifact_changed` path. It is implemented but has no dedicated test.

## Session outcome

003m1 and 003n are both in review, and all checks pass.

| Commit | What |
|---|---|
| `6583bbe` | Astra docs |
| `208c64b` | 003m1 |
| `07a9a7c` | 003m1 report |
| `414015a` | 003n |

No push, live call, signing, deployment or spending. No milestone is claimed. Stopping for
Astra's review.
