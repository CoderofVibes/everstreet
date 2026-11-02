# M2a review corrections: complete usage, pinned providers and expired claims

**Why (Tony's words):** "a good foundation is a great start"

## Observed failures

Astra independently reproduced these against committed 002a (`c0e93ef`, `108bdb3`, report
`1dccc68`) using in-memory SQLite, the actual API/service/worker and scripted providers.
No live call or secret was involved. All four block acceptance before a real provider.

1. **Partial usage makes cancellation appear accounted for.** Provider emits usage of 100
   input/0 output tokens, then waits forever; cancel after that event is consumed. Result:
   `cancelled`, usage `reported`, reserved 0 cents, charged 1 cent. `finish` treats any usage
   event as a complete bill. Distinguish provisional/delta usage from an explicit complete
   usage receipt. Cancellation, error and timeout after partial usage must retain unresolved
   reservation and say usage is incomplete. A terminal stream alone is not proof all billed
   usage was reported. Handle duplicate and late final receipts without double-accounting
   or letting an old worker apply artifacts.
2. **Over-limit response succeeds.** Budget 10,000 input/2,000 output; provider reports
   10,001/2,001, then a valid extraction artifact. Result: succeeded, charged 7 cents,
   reserve 0. `recordUsage` only appends `limit_exceeded`. Record known spend, stop the
   attempt and refuse successful output when limits are exceeded. Abort does not reverse
   incurred usage. Reject malformed/unbounded numeric usage, unsafe integers and bad prices.
3. **Queued work runs under a different provider.** Queue with `original-test`, recreate
   Builds/BuildWorker over the same database using `different-test`, then run. Result:
   one different-provider call, success still labelled `original-test`. Bind dispatch to
   the recorded provider/configuration and pricing snapshot; reject changed or unavailable
   configuration before dispatch. A new request may choose another provider explicitly.
   Pin sufficient identity for 002b's model/pricing version; never include secrets in it.
4. **An expired claim dispatches.** Claim with 30,000ms lease, advance injected time 31,000ms
   without recovery, then run the claim. Result: one provider call and success. `guarded`
   checks id/attempt/state but not expiry, then renews the expired lease. Expiry must itself
   invalidate authority before dispatch/commit, even without a recovery call. A heartbeat
   must not revive an expired lease. Recover according to whether dispatch occurred.

## Additional source concerns in this boundary

`consume` caps progress but permits unlimited unknown/usage/output events and grows an artifact
array. Bound total events/bytes/output; reject a second artifact immediately. Preserve usage
when stopping a bad stream. A rapid synchronous stream must not grow memory/storage without
limit or starve cancellation indefinitely. Check ownership/cancellation in quiet heartbeats,
so a silent provider does not keep old-owner work alive until timeout after a DB transfer.

Whole-cent rounding is conservative for reservations, not the provider's actual cost. Label
computed amounts accurately and retain fractional precision for totals before live integration.

## What the person sees and does

Progress and outcomes match what happened. Cancellation can say "stopped; final cost not yet
known". A changed provider or exceeded limit gives a plain reason and a new-attempt path;
history remains intact. A failed/expired attempt never appears as a checked build.

## Done when

Regressions cover all four sequences, partial/final usage, configuration changes, quiet
cancel/ownership change, invalid numbers and stream flooding. Prove no provider call for an
expired/mismatched claim and no artifact success after a limit violation. Existing 89 tests
stay green; run check and web build. Update runtime design/report and commit locally. Astra
reruns independent cases and browser review. No live API calls. Parent M2 remains open.

## Priority and size

P0 / M. Before 002b and any live API integration. Keyless only.
