# 003n1 report: execution freshness and privacy

Claude, 2026-11-03. Job: [003n1](../jobs/2026-11-03_003n1_execution-freshness-and-privacy.md).
Commit `ed43afa`. Astra docs committed first as `a3d90cf` (`npm run check`: 621 tests).

## Reproduced first

The three setups from the job are permanent tests in `server/test/customer-freshness.test.ts`.
All three failed before any change:

| # | Before | After |
|---|---|---|
| 1 | The same block a day later: `200`, one provider call | `503 evidence_too_old`, zero calls, no invocation |
| 2 | Retention crossed during `load`: `200` with the result | `409 result_expired`; no content |
| 3 | `PROBE_PRIVATE_CUSTOMER_DOCUMENT_412` stored in `failure_detail` | Only the allowlisted sentence for `provider_error`; class and usage exact |

## Corrections

All in `customerUse.ts` and `invocations.ts`, plus `delivered_at` and `input_deleted_at`,
migrated. Design: `CUSTOMER_USE_RUNTIME.md` §13.7.

- **Freshness at admission.** Prepare and execute require the newest final block to be at most
  120 s old by the local clock and at most 30 s ahead of it. These are configurable policy, not a
  chain proof.
- **Time left.** It counts from `max(now, T_B)`, and is rechecked inside the dispatch transaction
  together with `releaseFor` and the same artifact job.
- **Retention.** It is exact (`now < until`). `result()` rechecks the caller, state, reference,
  scheme and deadline after the `load`.
- **Diagnostics.** The customer-use `failure_detail` comes from `CUSTOMER_DIAGNOSTICS`, keyed by
  class. Owner trials keep the provider's explanation (tested).
- **What the view separates:** `validated`, `delivered` and `fulfilled`/`settlement_eligible`.
  Eligibility requires a durable delivery of a validated `extracted` answer.
- **Cleanup.** `expireInputs` and `expireResults` are bounded and run through the seam. A failed
  deletion keeps its reference and counts as failed, and another scheme's references are skipped.
  Loading under a changed scheme is refused (`protection_scheme_changed`).

## Tests and checks

**13 tests:**
- the three reproductions;
- future skew;
- an old block refused at prepare;
- time left by the later clock, and time passing during the read;
- a model change during the read, and an artifact swap (`artifact_changed`, the path 003n left
  untested), each with zero calls;
- the exact retention deadline, and a deletion during the load;
- a failed result protection: validated, not delivered, ineligible, not re-run;
- a crash between finishing and protecting, across a file-backed restart: ineligible, not re-run;
- a model refusal: delivered but ineligible;
- input cleanup (cancelled, may-still-run, serving passed with a failed then a successful
  deletion, executed);
- result cleanup (a failure, another scheme);
- an owner trial's failure detail kept.

**Mutants**, one at a time, each restored with an empty diff:

| Mutant | Caught by |
|---|---|
| Block age | Reproduction 1, the prepare test |
| Post-load reread | The deletion-during-load test |
| Diagnostics | Reproduction 3 |
| Eligibility ignores delivery | Both delivery tests |
| In-transaction release recheck | The model-change test |

```
npm run check        Test Files 48 passed (48); Tests 634 passed (634)
npm run web:build    built
```

No contract change, so no Rust run.

**Limit.** A crash after `protect` returns but before the record leaves an unreferenced copy in
the seam's store. The record never claims it, and the seam's own expiry must remove it.
