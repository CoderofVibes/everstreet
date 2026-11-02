# M3b: a sale reconciles once, including a lost response

**Why (Tony's words):** "One key function of Everstreet is the seamless purchase and transfer
of business/product to the investor/acquirer, on NEAR. So, that has to stay central."

## What the person sees and does

When an acceptance response is lost, the buyer sees that confirmation is pending and can
check the outcome. A retry first checks whether that exact accepted deal already closed.
It never reports that the sale failed merely because the response was lost, and never asks
the customer to fund again on that basis. Concurrent tabs and process restarts converge on
one ownership history entry and one business-sold event.

## Underneath

003a's TypeScript tests reproduce a lost response followed by a refused retry, and duplicate
settlement from two concurrent views. `Deals.settle` checks local status before awaiting
control, then writes unconditionally. Move the idempotence decision inside the transaction;
all ownership, sharing, team, listing and event updates commit together or roll back together.
Use durable uniqueness as defense in depth. Preserve existing records: do not silently delete
duplicates from a user's database to make a new index install. Specify a safe migration and
report conflicting historical data without guessing a different owner.

Reconcile only the matching business/deal, accepted digest/version, buyer and expected
generation. Current owner equality alone is insufficient: an old closed deal must not regain
authority if the same buyer later owns the business again. Chain observations can arrive out
of order; store monotonic generation and refuse stale transitions. If several sales happened
outside the app, report reconciliation needed rather than applying an unverified historical
deal to current ownership. Do not overwrite a newer local owner with an older observation.

After ambiguous acceptance, read final deal/control state. If that read also fails, preserve
unknown status and permit safe reconciliation later. Never automatically repeat a transfer
of funds. Keep submitted/confirmed/reconciled events distinct. Any background reconciler
must have bounded work and retries, durable state and a keyless read-only path; no new signer.

This improves observed-finality recovery. It does not solve the offchain check/commit race
or implement the managed freeze protocol in `docs/design/TRANSFER_PROTOCOL_OPTIONS.md`.
Update affected authority claims so they distinguish these guarantees.

## Done when

Convert the two corresponding 003a gap tests into regression tests of the desired behavior.
Use controlled gates, in-memory stores and chain doubles to cover concurrent acceptance and
view, duplicate reconciliation after restart, loss before/after chain close, unknown readback,
wrong digest/version, stale generation, later sale to the same buyer, rollback on a mid-write
failure and repeat replay. Exactly one ownership/event transition; customer records unchanged.
Run `npm run check` and web build. Report unit evidence separately from testnet evidence.

## Not in this job

No v2 code change, deployment, transaction, signing or live reconciliation against Tony's
database. Do not edit immutable existing terms. No claim of instantaneous cross-system close.

## Priority and size

P0 / M. After 003a, one writer; coordinate before 003p changes deal evidence serialization.
