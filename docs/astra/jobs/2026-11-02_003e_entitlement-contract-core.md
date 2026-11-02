# Digital entitlement and payout core, keyless only

**Why (Tony's words):** "one key function of Everstreet is the seamless purchase and transfer
of business/product to the investor/acquirer, on NEAR".

## What the person sees and does

This slice establishes the enforceable core under the future customer experience:100 purchased
uses,20 uniquely authorized consumptions,80 remaining; unused units and failed payouts remain
the customer's claim. Owner profit is separate from prepaid obligations. No new UI claim yet.

## Underneath

Read003d-core-review, consolidated-candidate §2 and recovery-addendum §8, plus referenced signed
HoldAuth/UseAuth and plan definitions in revision2/initial proposal. Implement the accepted
entitlement/storage/claims subset, not the entire design. Identify ambiguities explicitly in a
short design note before implementing; resolve routine engineering choices within these bounds.

Allowed files: new `contracts/business-v3/`, workspace membership in `contracts/Cargo.toml`,
necessary Cargo.lock updates without unsolicited dependency upgrades, this job status and report.
Leave business/business-v2, scripts, config, server and web untouched by this slice. Use the
existing pinned SDK when supported. No deployment/sandbox/testnet or signing real transactions.

- Fixed/bounded entitlement, key, hold, last-closed-hold, beneficiary and payout-slot records;
  prepaid/free/held/consumed/refunded units and money obey the proposal's U/P/I invariants.
  Dynamic growth is measured and funded; FT receipt and callbacks must not allocate new state.
- Plans' unit pricing is immutable once entitlements exist (or versioned as a new plan).
  Refund values are derived from the exact accepted price, never a later mutable price.
- Trusted-asset FT receiver validates sender, amount, purchase sequence and bounded input.
  Invalid/replayed purchases return the full unused amount without partial state mutation.
  Malformed/oversized inputs, overflow and underfunded shells are covered.
- Customer-bound domain-separated signed holds/uses; sponsor storage does not confer key
  authority. Registration ID and key epoch defeat old signatures. Bound holds, daily exposure,
  deadlines and batch sizes. Duplicate same use is idempotent; different fingerprint conflicts.
- Payouts debit into pending before scheduling. Include a monotonic payout identity in each
  slot/callback copy so reuse cannot accept an old callback. Private bounded callbacks handle
  external transfer success/failure without expected-outcome panics or allocation. Beneficiary
  pending references prevent deletion. Failures become the right beneficiary's claim, never
  another owner's available profit. Repeated/mismatched callbacks cannot pay or settle twice.
- If a callback itself fails/is missing, preserve pending liability and expose it; no blind
  transfer retry or guessed success. Full reconciliation is a later job and must be reported.
- Owner/operator administration enforces current generation. A test-only ownership injection
  clears old operating authority and creates the successor beneficiary; it is not a sale method.

## Done when

Implement/test the14 keyless scenarios in addendum§8 and the clarifications above. Include
adversarial wrong signer/asset/amount/sequence/slot/epoch, duplicate batch, registration reuse,
expiry/release, sponsor isolation, reserve/withdrawal race, failed/duplicate/missing callbacks,
beneficiary deletion while pending, payout-slot reuse and24-month ring reuse. Validate an entire
batch before mutation or explicitly model receipt rollback; a unit catch_unwind is not rollback.
Add bounded sequence/property tests for unit/money invariants and near-overflow limits.

Run existingv2 tests unchanged and newv3 unit tests in WSL with
`CARGO_TARGET_DIR=$HOME/everstreet-target`. Also run root check for the ready docs. Report pinned
API availability, exact commands/results and measured unit-VM/Borsh storage sizes, distinguishing
them from deployed measurements. Commit locally in reviewable substeps.

## Not in this job

No deals/close/freeze/closer/manifest/gateway/journal implementation, server or customer UI,
v2 migration, accounts, deployment build, testnet, spending, push or public release. No claim
that unit tests prove FT physical balances, receipt scheduling, gas or the live100/20/80 journey.
The full003d recovery/managed-close design remains a candidate.

## Priority and size

P0 / L, bounded foundation. After002c2 and003f1; stop for Astra review before any integration.
