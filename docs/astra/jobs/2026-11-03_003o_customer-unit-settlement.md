# Settle one successful customer use and release unused units

**Why (Tony's words):** a "seamless purchase and transfer of business/product ... on NEAR" is
central. The flagship customer buys100 uses, consumes20, and keeps80 across the sale.

## What the person sees and does

A successful protected extraction moves from unit reserved to unit charged only after exact
chain evidence. A failed/cancelled/unknown or undeliverable execution never creates a new charge.
Unused units return only when observed released. Lost replies keep explicit uncertainty and
recover the same request; they do not run the model again or charge another unit. After a hold
is conclusively closed the customer can prepare their next use. Ownership transfer preserves
the same customer identity, requests, units and private results.

## Underneath

After003n1, specify the concrete settlement/release transitions and evidence in
CUSTOMER_USE_RUNTIME, then implement. This is an injected backend slice; no wallet, signing,
live transport or main worker wiring. Read actual contract settle_hold/release_hold/check_use,
closed root, registration and authority logic before implementing the adapters.

1. Durable settlement intent keyed to the exact request/registration/hold/slot/fingerprint and
   stored customer UseAuth; no new signatures or holds. One immutable payload, bounded retry,
   lease generation/CAS, intent before side effects, no network await inside SQLite. Writer
   responses are recorded, never the proof of charge. Persist separate settlement state from
   invocation/provider-cost state; cost is already accounted and must not be counted twice.
2. Eligibility requires the durable evidence of a valid, protected, deliverable extraction
   under003n1. Refusal/failure/cancel/unknown/protection failure is ineligible. Never infer
   successful service from tokens, charged provider cost or a completed row alone. Freeze the
   exact eligibility facts with the settlement intent. Existing customer result access remains.
3. Extend only the injected writer with exact settle/release operations and strict bounded
   readback with final-block timestamps. Matching network/account/signer/registration/hold and
   fresh authority required. Respect owner-or-operator contract semantics and narrower platform
   policy. Lost authority at sale is unavailable/unknown, not proof nothing charged. New owner
   cannot inspect private results and does not inherit customer keys.
4. Implement actual check_use outcomes: active charged with exact fingerprint, active unused,
   conflict, closed and unknown history. A closed slot-used bit alone cannot identify fingerprint:
   recompute the actual contract root from COMPLETE ordered used-slot data and bitmap. This slice
   is one-unit/one-slot but validate that scope instead of assuming any observed hold fits it.
   Missing history/root mismatch/registration change stays unknown. Expiry alone never proves
   no prior charge. Preserve evidence baseline/hash/digest/time/regression fences from003m1.
5. Release only this exact hold's unused unit after an ineligible outcome or an explicit
   cancellation/abandonment policy, while respecting any possibly in-flight settlement. Do not
   release another device's hold or one whose identity/settlement is ambiguous. After deadlines,
   anyone may release on-chain, but this worker still uses only its configured injected actor.
   Confirm closure and charged/unused identity before reporting returned or freeing allocation.
6. Bounded reconciliation and cleanup for reserved-but-never-executed, failed, cancelled,
   fulfilled, settlement-unknown and release-unknown states. Do not create an automatic new use
   from unresolved history. Support explicit next request only when safe; unknown exposure stays
   visible. No unbounded retry/sleep/workers or default background launch.
7. APIs/status show exact source block, unit state and retryability without exposing signatures,
   salt, customer text, protected refs or others' data. Existing owner detail/list/export routes
   remain private. Unit balance changes must come from observed contract views, never local
   subtraction masquerading as chain balance. Do not call synthetic fixtures live proof.

## Done when

- A real-app fixture-backed path prepares/reserves, executes exactly once, settles exactly once,
  confirms the charge, closes/releases the hold and admits the next explicit request.
- Twenty successful uses preserve exact provider ledgers and100/20/80 unit semantics, then
  acquisition through existing exact v3 reconciliation preserves customer access and80 units.
  Prove stale-owner denial and successor operation. Label the TypeScript double accurately.
- Generate/reuse actual Rust method fixtures for one-unit successful charge/replay/close,
  unused release, conflicting fingerprint, expired settle, and successor authority across sale.
  Keyless contract test verifies actual100/20/80 behavior; API/double trace is separate evidence,
  not claimed to execute the contract VM. No silent contract behavior changes to match tests.
- Lost settle/release replies after application, dropped requests, delayed/duplicate callbacks,
  restart/file DB, concurrent workers, stale lease, same/different fingerprints, closed root
  mismatch, old history, revoked key, wrong network/account/registration, deadlines, authority
  loss/regrant, cancelled/failed/unknown/undeliverable execution all have concrete assertions.
- Finite fixture ceilings; call counts, state invariants and ledger sums checked. Existing app
  checks/web build and relevant keyless Rust tests/clippy pass. Report exact limits/commits.

## Boundaries and priority

P0/L after003n1, then stop for Astra review before customer UI/live wiring. No real provider or
RPC calls, keys, signing/deployments, packages/billing/spending, push/release/submission, Day One
or research assessment. All six milestones stay open; full walkthrough after buildout.
