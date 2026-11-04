# Handover evidence must stay visibly qualified

**Why (Tony's words):** seamless purchase and transfer on NEAR "has to stay central". People
need to distinguish what the contract shows, what this app recorded, and what is a local rehearsal.

## Findings at61aa594

Astra browser verified record lost-response recovery, buyer reconciliation lost-response recovery
to already-applied, seller receipt-only access and customer result/balance continuity through
the actual app reconciliation. No authority failure was observed. Correct these presentation gaps:

1. The synthetic acquisition preview has only the normal "NEAR testnet only" header on seller
   and buyer pages. The customer page alone has an explicit synthetic-authorizer notice. Add a
   persistent unmistakable preview-only label covering sale evidence, customer chain and runtime
   so internal captures cannot be confused with live testnet proof. Keep it out of normal app
   behavior; no signing/key or synthetic-success fallback in the production bundle.
2. Preview read at November4 02:50 Pacific is called fresh, while the proposed deal says offer
   open until November2 16:00. Fixture terms/digest are fixed; do not casually rewrite fields
   covered by the contract digest. Use a clearly stated coherent fixture clock, or generate
   proper new fixture evidence if truly necessary. Label passed deadlines in the UI as elapsed
   at the observed reference time where known, without asserting a terminal outcome until read.
   A historical live-deal field is not proof that acceptance is still possible now.
3. Source review: OwnerHandover.load keeps reviewing on matching seq/version/digest alone;
   review/record UI remains offered when observed.flag exists. Backend refuses flagged evidence.
   Keep historical terms visible with their qualification, but invalidate/disable the current
   record review on an explicit flag or other known disqualifying identity/owner state. Preserve
   exact unanswered-request recovery. Decide stale-age behavior explicitly: recording history
   is not signing, but do not call stale observations current or hide the need to refresh.
4. Source review: refreshEvidence accepts arbitrary string outcomes. Validate the actual finite
   response contract, including needed fields and cross-field consistency, before announcing
   success. A malformed response must remain retryable and must not silently replace evidence
   or restore authority. Existing Continuity controller work is a useful precedent.

## Done when

Focused finite tests reproduce known-flag review and malformed refresh issues before correction.
All recovery/identity/participant privacy tests continue to pass. A qualified read never looks
like a new validated review; no change to backend transfer authority just to make UI tests pass.
Preview clock/provenance documented accurately. npm run check/web:build, local commit/report,
then proceed001b. No broad transfer rewrite or contract change expected.

P1/S-M. No signing/deploy/live RPC/provider, spending/billing, push/public release, research,
submission or Day One. All six milestones open.
