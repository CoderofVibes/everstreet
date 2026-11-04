# Persist exact v3 acquisition intent and reconcile a proven close once

**Why (Tony's words):** "The seamless purchase and transfer of business/product to the
investor/acquirer, on NEAR ... has to stay central."

## What the person can do

Implement the server-side bridge between an exact proposed v3 acquisition and the application
handover after matching contract evidence. This is a bounded keyless implementation slice,
not a new wallet/payment interface. Owners can record/read exact acquisition intent through
authenticated APIs. A deliberate reconciliation reports pending, unavailable, conflict,
applied or already applied. An ambiguous state changes no authority. Existing observations
and owner status stay read-only; opening or refreshing the status page never transfers access.

## Start from current code

Read BUSINESS_V3_CORE.md, BUSINESS_V3_SALE.md, V3_OBSERVATIONS.md and actual v3 methods/views;
the existing deals.ts reconciliation, Store controlEpoch, app ownership/grant boundaries and
2026-11-03_ContinuityIntegrationPrep.md. Do not cast v3 evidence into the v2 Chain/deal types.
Keep v2 behavior and historical evidence intact. Before code, write a concise concrete design
at docs/design/V3_RECONCILIATION.md: records, state transitions, identity mapping, transaction
writes, failure cases and what this slice does not prove. If current views cannot establish
a required fact, report the exact missing field and stop that dependency rather than invent it.

## Implementation requirements

1. A separate durable v3 intent records the business and trusted contract binding, exact deal
   seq/version/digest, seller/buyer chain accounts, expected generation and exact terms needed
   for comparison. Use canonical terms/digest rules from the actual contract, not a second
   approximate algorithm. Preserve immutable versions and reject conflicting idempotency keys.
   Bound inputs/record counts. No user-supplied endpoint, raw observation, app buyer id or
   arbitrary account claim can establish authority. Use trusted existing account mappings;
   require exact unambiguous mapping and state local-preview identity limitations honestly.
2. Do not make the caller assert that a sale closed. Use the v3 observation service/trusted
   injected transport to obtain coherent evidence at a pinned final block. Document how the
   explicit reconciliation gets fresh evidence and rechecks authority without allowing any
   caller to overwrite stored observation rows. No production main.ts wiring or live reads.
   Test uses synthetic read transport and actual Rust-produced outcomes.
3. Before applying, match intent and observed binding/schema/source, exact seq/version/digest,
   parties, close outcome, successor generation/control sequence and current chain control.
   Reject unknown app mapping, source change, stale/flagged/contradictory evidence, absent exact
   outcome and newer unmatched transfer. A history gap affecting the target cannot be filled
   with a guess. Only a coherent closed result may hand over app administration.
4. In one local database transaction, compare and set the intent, enforce monotonic local owner
   state, change owner, append exactly one ownership-history record and one sale event, and
   revoke seller/operator/evidence grants using reviewed shared mechanisms. Recheck every
   decision dependent on local state inside that transaction. Preserve project/release/import
   records and customer-owned records. Close sale visibility and reset personal sharing/work
   assumptions consistently with existing reconciliation. Do not mark external assets or
   customer runtime readiness complete. Separate v2/v3 deal identifiers and unique constraints.
5. Retries/concurrent calls/restarts converge once, including lost HTTP replies after commit.
   An already-applied response must not disclose private successor records to a former owner.
   Specify who may initiate/read each state and preserve the smallest useful receipt for a
   participant without granting new-owner access. Tests must exercise APIs, not just helpers.
6. A newer local owner must never be rolled back. Away-and-back increments the local epoch.
   Seller owner-trial/build/private evidence responses already in flight must be denied after
   reconciliation. Returning to seller later does not resurrect old grants or pending replies.

## Acceptance evidence

- Exact matching closed outcome applies once; proposed/accepting/closing, cancelled/expired/
  aborted, wrong version/digest/party/binding/generation and missing outcome change nothing.
- Unknown/ambiguous buyer mapping and malicious caller-supplied identity/source are refused.
- Stale, conflicting, source-changed, mixed-block or superseded evidence cannot grant access.
- Concurrent/duplicate calls, crash/reopen and retry-after-commit create one owner entry/event.
- After application seller is denied private projects/imports/observations, buyer can access
  owned product records, old grants are revoked, and customer records/immutable revisions are
  unchanged. Actual-method contract fixtures must be distinguished from app API evidence.
- Explain transaction effects and supported participant receipts; never imply SQLite and NEAR
  changed atomically. No production/live/100-20-80 end-to-end claim. Add focused tests and run
  full check/web build; Rust only if fixture generation truly changes (keyless unit tests only).

## Boundaries and sequencing

After003j1. No signing, contract behavior changes, deployments, actual payments, mainnet, live
RPC, real model calls, runtime DB reads, billing changes, new packages or research assessment.
No managed closer/customer admission implementation yet. Their durable async state machines
remain next work; the synchronous Admission hook must not issue remote transactions inside a
SQLite transaction. Preserve all six milestones. Resource tests finite even if guards fail.
Local commits/report, then stop for Astra review. Priority P0/L, bounded to this server bridge.
