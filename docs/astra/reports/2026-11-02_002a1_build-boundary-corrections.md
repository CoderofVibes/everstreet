# Job 002a1 report: build boundary corrections

Builder: Claude. Date: 2026-11-02. Job: `docs/astra/jobs/2026-11-02_002a1_build-boundary-corrections.md`.
Code commit: `03e29cb`. Parent job 002 and M2 stay open. All providers are scripted keyless
doubles; no live call. Builds UI not checked in a browser by me.

## The four reproduced failures

| # | Cause in 002a | Fix | Regression (`server/test/builds-boundary.test.ts`) |
|---|---|---|---|
| 1 | `finish` released the reservation after *any* usage event | Provider contract split: `usage` = provisional delta, `usage_final` = complete receipt. Only a final receipt releases; partial/none after dispatch stays held on cancel, error, timeout and even success. Duplicate receipts count once; lower receipts never reduce known spend; deltas after the receipt ignored | Astra's exact sequence (100/0 then silence, cancel); error and timeout after partial usage; success without receipt; duplicate/mismatch/late-delta receipts (ledger sum = charge); late receipt + artifact from a superseded worker change nothing |
| 2 | `recordUsage` only logged `limit_exceeded` | Over-limit usage records the spend, stops the attempt, output never applied (also when received before the receipt). Invalid counts (negative, fractional, NaN, unsafe, non-number) stop with `invalid_usage`. Prices must be whole, safe, non-negative cents per million | Astra's 10,001/2,001 then valid artifact: failed, 7 cents recorded, no artifact, provider aborted; output-then-over-limit receipt; 6 invalid usage values; 4 invalid prices refused before any job |
| 3 | Dispatch used whatever provider the worker had | Job pins provider id + non-secret identity (model, version) + price snapshot (`provider_config`); worker refuses `provider_changed` or `provider_unavailable` before dispatch, releasing the reservation | Astra's original/different provider over the same DB: zero calls; same id with changed model or price; unavailable provider; same key still returns the same job |
| 4 | `guarded` didn't check expiry and renewed expired leases | Fenced writes require an unexpired lease and never renew an expired one; the attempt then settles by dispatch state without waiting for another worker | Astra's claim + 31 s + run: zero calls, requeued, later runs once (attempt 2); lapse after dispatch with no other worker: held for reconciliation, no artifact |

Additional concerns from the job, also covered: quiet heartbeats notice an ownership change
(fenced) and a cancel written by another process; a flooding stream is stopped at
`maxStreamEvents` with stored events bounded (≤5 progress here, ≤5 ignored) and its usage kept;
a cancel gets through a stream that never pauses (worker yields to the event loop every 25
events); a second artifact stops the attempt immediately (nothing after it is read); an
oversized artifact is refused without being kept. Exact cost is kept in millionths of a
cent (`charged_microcents`); the UI labels it as computed from reported tokens at declared
prices, not an invoice, and says "final cost not yet known" for partial usage.

**Mutation check.** Each original defect was reintroduced on its own and the suite rerun:
no expiry check → 2 tests fail; no limit stop → 2 fail; no provider pin → 2 fail; any usage
report treated as complete → 6 fail. Each was reverted.

## Other changes

- Schema: `usage_final`, `charged_microcents`, `provider_config` added to `build_jobs` by
  additive `ALTER TABLE` in `openDb` (existing local databases keep working; CHECK
  constraints unchanged).
- The idempotency fingerprint no longer includes the provider: the server, not the request,
  picks the provider, so a duplicate after a provider change returns the same (now refused)
  job and a different provider needs a new key.
- Two expectations in `builds.test.ts` that encoded defect #1 were corrected; the success
  path now ends with a final receipt.
- `BUILD_RUNTIME.md` sections 4–5 updated.

## Commands and results

| Command | Result |
|---|---|
| `npm run check` | lint and types clean; 109 tests passed (11 files; 20 new) |
| `npm run web:build` | built (JS 488.2 kB) |

## Limitations

- A receipt that arrives after an attempt lost authority is not recorded; that job stays
  unresolved until reconciliation tooling exists.
- Bounds hold only within what a provider adapter reports; a real adapter (002b) must map the
  API's final usage to `usage_final`.
- Single-process tests; multi-process behaviour relies on the same SQLite fencing.
