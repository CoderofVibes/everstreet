# Customer chain writer with durable submission identity

**Why (Tony's words):** "One key function of Everstreet is the seamless purchase and transfer of
business/product to the investor/acquirer, on NEAR. So, that has to stay central to this as well."

## What the person sees and does

With explicit testnet configuration, customer reservations and settlement have a real adapter.
An unanswered transaction stays pending/unknown and is resolved from exact chain evidence;
refresh or restart never silently buys, reserves or charges again. Missing writer setup remains
actionably unavailable while unrelated reads and studio work continue.

## Underneath

Continue003w-d in APPLICATION_COMPOSITION afterd350489. First correct the reproduced modal
keyboard issue in CompositionFirstSliceReview as the small remaining a/b/c correction.

Design the transaction lifecycle before implementation. Actual interfaces are CustomerChainWriter
in server/src/customerUse.ts and the v3 methods in contracts/business-v3/src/lib.rs:
open_hold,settle_hold,release_hold_for. Preserve exact arguments and release registration guard.

- Explicit testnet operator/signing configuration only; no ambient discovery, preview signing,
  customer secret, fixture fallback or real credential reads during this job. Claude owns signing
  implementation/config/scripts; tests use newly generated ephemeral keys and synthetic RPC.
- Durable operation identity and exact payload binding. Persist signed transaction identity,
  nonce and hash before broadcast; handle crashes before/after that boundary explicitly.
  Guard concurrent submissions and nonce allocation for the same signer across DB connections
  and restart. Do not create a fresh transaction after an unknown broadcast outcome.
- Bounded allowlisted RPC, chain/account/operator checks, deadline/abort/body limits and shutdown.
  Validate configured identities before effects. Do not infer successful customer charging from
  a hash, endpoint acknowledgment or final transaction outcome alone: existing exact contract
  readback remains authoritative.
- Inspect real caller retries, leases and current write interface. Amend the interface if a
  durable request identity is required; avoid an implementation that is safe only when called
  once. State dependencies/assumptions and pin actual installed library APIs using primary docs
  where needed. No automatic retry loop or new dependency merely for convenience.
- Integrate explicit writer configuration and truthful capability status through compose;
  maintenance/lifecycle wiring needed for this slice should use existing bounded services.
  Wallet/device authorization remains003w-e and full journey003w-f; neither may be marked done.

## Done when

Real adapter tests against a synthetic transport cover exact serialization/signing, allowlisted
methods, duplicate/concurrent calls, mismatched identity/payload, failed reads, aborted/unknown
broadcast, restart at submission boundaries and guarded release. Use disposable durable storage
and separate connections/processes where the claimed invariant requires them. No live endpoint,
wallet, signing key file, model, deployment or worker host is exercised.

Meaningful negative cases must demonstrate that wrong success/duplicate dispatch would fail.
All processes/listeners/timeouts are finite and cleaned up. npm run check and web:build pass;
report exact commits, evidence and remaining gaps. Keep003w parent partial. Stop at this bounded
handoff for Astra review;003w-e is next unless a concrete correction is required.

## Not in this job

No real transactions/signatures with existing keys, external rehearsals, worker-host runs,
wallet installation/account setup, production release, push, spending or research assessment.
Do not invoke legacy main. Do not silently substitute a stub for the missing writer. Preserve
all six milestones and100/20/80 customer-continuity acceptance.

## Priority and size

P0/M-L; next after003w-a/b/c review, before003w-e/f; sole actual Claude Opus5.5/high builder.
