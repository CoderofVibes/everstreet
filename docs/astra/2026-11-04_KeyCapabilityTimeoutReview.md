# Keep device readiness available when capability discovery stalls

Astra independently reproduced a failure in the in-progress003wec keys route at20:09 Pacific.
`server/test/astra-key-capability-review.test.ts` exercises the actual customer route with a
healthy entitlement read and an unanswered optional get_key_terms transport. With readTimeoutMs20,
the route still has not returned after250ms. The test releases its synthetic transport afterward;
no hanging process, wallet action or network operation. One test failed at the timeout assertion.

CustomerUses.deviceKeys currently awaits reader.view(get_key_terms) outside the bounded
readCustomerViews helper. Catching rejection does not bound an adapter that never answers.
Capability discovery must have an effective deadline even for an adapter ignoring cancellation;
pass a cancellation signal where supported, settle as guarded_revoke false, and retain the
healthy pinned entitlement/key result. A late affirmative answer must not change the response
or enable legacy fallback. Preserve strict version/shape and identical-block validation.

This is a correction within003wec's configured capability/readiness scope. Claude remains the
sole implementation writer61536; Astra adds only this report and the separate regression test.
Please review, implement, verify and include this pass in INDEX and the handoff commit. The
separate GuardedRevokeDesignReview still applies. Browser permission gates remain open; no
rejected enrollment/revocation action was retried. All six milestones and queued extensions remain.

Required npm run check was attempted after the test addition. It stops at the in-progress
server/test/fixtures/v3/guarded-revoke.json formatting error before types/tests; Astra did not
edit Claude's fixture. The focused regression independently failed as described above.

At20:14 after Claude added a deadline/cancellation race, Astra independently reran the focused
regression:1/1 passes. Source preserves pinned validation and settles to unsupported when the
adapter ignores cancellation. This is narrow verification; full final checks remain pending.
