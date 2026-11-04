# Bind release to registration and resolve delivery before settlement

**Why (Tony's words):** "seamless purchase and transfer of business/product ... on NEAR" must
preserve customer obligations. Delayed work must never close another registration's hold or
return a unit while a successful result is still being durably delivered.

## Independent reproductions at3b0e661

Astra's two finite real-app probes failed (112ms); temporary test removed. Common setup:
customerWorld with SyntheticProtection, prepare Fictional invoice 412 USD, key astra-unit-0001,
confirm w.signed(envelope), assert reserved.

1. gate=w.writer.holdNextUnit(); start POST /uses/:id/release; await gate.entered. Clone
   w.chain.ent(), set reg_id='2', replace chain.ents[CUSTOMER], tick1ms, open gate and await.
   New registration's hold_active becomes false. Expected true. This is a labelled synthetic
   replacement of closed/unregistered reg1 with a funded reg2 whose own hold_seq is1, not an
   actual VM unregister proof. Source confirms the risk: release_hold(customer,plan_id,hold_seq)
   checks no reg_id, unlike signed uses. A read before a transaction cannot fix this race.
2. Gate SyntheticProtection.protect only for kind=result. Start execute; await protection entry
   (runtime row is already completed, result still pending). Call units/reconcile. releaseCalls
   becomes1; expected0 while the delivery decision is pending. Open protection gate afterwards.
   ensureIntent presently freezes release before the result can become delivered/eligible.

## Required correction

### Registration-bound release (Claude owns this contract work)

First prove the registration ABA with actual Rust methods: close/refund/resolve any required
payouts/unregister/re-register/install key/open next registration's hold1, then deliver an old
release. Do not mutate state in the proof to bypass lifecycle restrictions. If impossible,
document exactly why and correct the assumption; the source/double evidence warrants review.

If reproduced, add a minimal guarded release entry point requiring expected reg_id plus exact
hold_seq, checked atomically before closing. Prefer additive compatibility if existing callers
must retain release_hold, but this worker must ONLY use the guarded method. Include expected
identity in the persisted/injected payload. Unsupported capability fails unavailable with no
fallback to unguarded release. Test old registration rejected without changing new hold/balances,
current registration succeeds, caller/deadline semantics unchanged, replay/lost reply safe.
This job explicitly authorizes that minimal undeployed contract change and keyless tests; no
deployment/signing/live call is authorized. Record compatibility and future deployment needs.

### Delivery decision and settlement intent

Persist a distinct pending/final delivery decision. While protection is in flight, no automatic
or explicit release can classify it as a finished ineligible outcome. Define bounded crash/
restart/timeout recovery that fences late protection completions before freezing release. A late
result must never turn a finalized release decision into delivered/chargeable success. Preserve
provider cost, do not rerun, and clean protected orphan copies through a defined seam/expiry.
Test gated protection success/failure, user release, worker reconcile, restart while protection
waits, and late completion after recovery. Frozen charge/release intent and delivery must agree.

## Additional acceptance gaps

- Actual API account/registration change during settlement and attempts_exhausted (003o report).
- Lost/dropped release reply, exact release deadline, wrong new-registration hold and restart.
- Stale unit worker must not set a sticky request conflict outside its lease after a newer
  worker succeeded; unitStep conflict branch currently writes outside underUnitLease. Prove the
  race if reachable, then fence every state mutation, including error/conflict paths.
- Check check_use bitmap/count/root agreement, not only status/root. Contradictory same-block
  views never manufacture returned/charged. Keep one-unit scope and unknown history explicit.

## Done when

Independent reproductions fail first then pass, actual contract ABA is resolved or disproved,
delivery/lease regressions and100/20/80 remain green. npm run check/web build, relevant Rust
tests/clippy. Update design/report/JOBS with exact facts, no live/M3 claim. P0/M-L before003q.
No push, real transactions, research, Day One or external commitments.
