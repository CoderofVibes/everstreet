# Revoke the reviewed device key at transaction execution

P0/M; queued after 003web and before configured 003wf integration. Not dispatched.

**Why (Tony's words):** "One key function of Everstreet is the seamless purchase and transfer
of business/product to the investor/acquirer, on NEAR. So, that has to stay central to this as
well." Customer continuity requires dependable customer authority throughout that lifecycle.

## What the person sees and does

A customer reviews the exact device key to revoke. If another device replaces that slot before
the transaction executes, the old confirmation must leave the replacement untouched and ask for
a new review. Successful revocation stops new serving while already-signed uses retain their
settlement rights. Exact account, business, registration, slot and key identity remain visible
in the request disclosure. A lost wallet answer stays uncertain until appropriate evidence.

## Grounded issue and implementation scope

contracts/business-v3/src/lib.rs revoke_key currently accepts only plan_id and slot. Its own-account
and one-yocto checks are appropriate, but it revokes whichever active key occupies that slot at
execution. install_key increments the epoch; unregister/re-register supplies a new registration.
tests.rs s04b already proves revocation, replacement at epoch3 and signed-use settlement semantics.
The 003wea client fresh-read comparison cannot make the transaction atomic with that observation.

1. Design a guarded revocation entry point binding the customer's own entitlement registration
   and observed slot epoch, with public key if necessary for a clear exact identity guarantee.
   Validate all expected identity fields before mutation. Keep legacy API semantics explicit;
   the customer product must not silently downgrade to unguarded revocation.
2. Preserve one-yocto/account authority, bounded slot validation, checked epoch increments and
   existing hold serve/settle semantics. A stale or invalid guard must change no entitlement,
   serving window, accounting or unrelated key. No unnecessary state migration.
3. Wire browser preparation and immutable review confirmation through wallet request encoding
   and fresh readback. Update the real route harness/doubles from contract-produced evidence.
   Distinguish a successful revoke from a different later key: never mark the replacement as
   revoked or delete another tab's replacement local key. Reconcile lost answers honestly.
4. Establish explicit capability/version support for the guarded method in configured mode.
   Older contract deployments must report the limitation; a failed call must not trigger the
   legacy method. Prepare any deployment/version prerequisite as a later authorized rehearsal,
   without deploying or changing a deployed account now.

## Done when

- Actual Rust tests first characterize stale review revoking a replacement through the legacy
  API, then show guarded revocation refuses it. Cover same public key reinstalled at a later
  epoch, changed registration with a reused slot/epoch, wrong account/deposit/slot, replay,
  inactive key and overflow; assert no relevant state changes on refusal.
- A guarded successful revoke stops serving for the affected active hold, preserves already
  signed valid settlement and unrelated slots, and keeps exact accounting invariants.
- Controller/route tests prove immutable old reviews cannot revoke replacements after a newer
  prepare, a changed response, concurrent replacement or a delayed wallet response. Earlier
  Astra probe remains meaningful; no success inferred solely from popup closure.
- Actual browser review shows successful guarded revoke, stale refusal/new review and lost-answer
  recovery using fictional data through normal controllers. A finite harness has strict resource
  bounds and cleanup; report evidence as synthetic, not deployed NEAR.
- Required Rust/unit/clippy and npm checks/web build pass; precise report, local commits and
  remaining external rehearsal gates recorded. Astra reviews before003wf.

## Not in this job

No live signing, RPC writes, deploy, real account or credential, spending, host installation,
push/publication/submission, research or Day One access. No rewrite of purchase or acquisition.
All six milestones, worker002f1, import/network/expanded-product jobs stay in scope. Claude owns
contract/scripts/config and commits; Astra reviews. Actual Opus5.5/high subscription, sole writer.
