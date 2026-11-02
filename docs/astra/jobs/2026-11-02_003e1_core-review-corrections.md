# Correct entitlement bounds, observations and payout categories

**Why (Tony's words):** “seamless purchase and transfer of business/product to the investor/acquirer,
on NEAR.” Customer rights and honest operating records must survive that transfer.

## What the person sees and does

Future customer access has a bounded hold deadline and an exact receipt/readback. Refund units
and actual returned funds are distinguished; a failed refund's later success is still a customer
return. An owner cannot occupy every customer payout slot with profit withdrawals. This job
changes the new undeployed core only; it does not add a live purchase or sale UI.

## Underneath

Read003e-astra-review and003e-source-review. Reproduce before adopting the latter's hypotheses.
Allowed: business-v3, its design note/tests, necessary pinned Cargo features/lockfile, job/report.
No v1/v2 behavioral changes, scripts/config/server/UI integration or deployment builds.

1. **Pinned verification experiment first.** Run synthetic identity and zero use-key forgery
   probes through near-sdk5.29.1's actual unit host. Check pinned near-vm-runner0.37.4 source.
   State whether the reviewer hypothesis reproduces. Reject malformed/weak use-keys on both
   install paths using a vetted mechanism if necessary; do not hand-roll cryptography or assert
   an incomplete encoding blacklist is complete. If host strict verification already prevents
   forged charges, document the counterexample and keep meaningful regressions. Distinguish
   invalid-key usability from a proved authorization bypass. No real keys or transactions.
2. **Bound deadlines.** For this invoice-product core, fixed protocol ceilings of one hour hold
   TTL and one hour settlement grace; minimum TTL60 seconds. Reject inconsistent rules at new
   and out-of-bounds plans. All absolute deadline additions checked before mutation. Test floor,
   ceilings, huge values and boundary time. These are engineering bounds for this family, not
   a new promise of arbitrary long-running agents.
3. **Readback.** Expose active hold identity, key slot/epoch, bounded slot fingerprints, times
   and relevant key policy/cap state so a client can verify exactly which request consumed a
   slot. No secrets; these are public contract records. Tests distinguish matching use,
   conflicting use, unused slot, closed summary and re-registration. Resolve the unsigned
   `already` result so callers cannot treat it as proof of submitted signature validity.
4. **Books.** Preserve customer-return versus owner-withdrawal categories through failed payout
   claims/retries and stranded retries. Name/document refunded-unit liability accurately.
   Fixed-size per-counter overflow flags must make saturation explicit in PeriodView; no
   fabricated exact total after overflow. Test failed→claim→success, repeated failure, duplicate
   callback, month rollover, large gross flows and unchanged bucket invariants.
5. **Capacity.** Reserve capacity for customer payouts and cap outstanding owner/party payouts
   (including retries); bounded exhaustion has a clear reason. Test that repeated tiny owner
   withdrawals cannot consume reserved customer slots and cannot evade the cap through claims.
   Explain remaining global/Sybil/missing-callback liveness limits. Keep old-beneficiary claims
   separate after injected ownership change.
6. **Other bounded fixes.** Re-grants require an intentional attached deposit; invalid month
   inputs return a defined non-panicking view result. Check payout/registration identity-counter
   overflow before mutation. Harden stranded retries against accidentally unref'ing a recreated
   party record; report reachability correctly. Preserve actual authority checks and deposit
   accounting. Do not silently refund someone else's storage stake.

## Done when

Keyless regressions demonstrate each corrected issue and distinguish any disproved hypothesis.
Keep storage allocation invariants, full-batch validation and all prior26 scenarios. Extend the
bounded random sequence across different-price plans and key rotation/owner generations where
useful. Run v3/v2 unit tests, clippy and rootcheck; exact commands/results in report. Identify any
gas/receipt behavior left for integration. No unit-only claim of live100/20/80 or callback gas.
Commit bounded substeps locally. Then proceed to004a; stop before any contract integration.

## Not in this job

Deals/close/manifest/gateway, actual signing, deployment/sandbox/testnet, v2 migration, credentials,
live model calls, Git push or publication. Keep full003d proposal and M3 unaccepted.

## Priority and size

P0 / M. After the small002c3/003f2 corrections, before004a.
