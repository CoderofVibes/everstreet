# Wallet sign-in review: logout must survive a delayed verification

Tony's authorized platform needs predictable account switching and sign-out. This sharpens
003we requirement 3; it adds no external permission or scope. Claude 88579 remains the sole
implementation writer. Design section 9 is committed as 642e510; implementation is in progress.

## Reproduced through the real routes

Astra added `server/test/astra-wallet-logout-review.test.ts`. It uses actual AccountSignIn,
Store, in-memory SQLite and everstreetApi. Its only external boundary is a deferred synthetic
account-key reader. The NEP-413 proof uses a newly generated ephemeral test key. No wallet,
existing credential, transaction, network, provider or host action occurs.

1. POST /api/session/challenge and retain its real browser-binding cookie.
2. POST /api/session/verify with a valid synthetic proof; hold the full-access-key read pending.
3. DELETE /api/session with the same browser cookie; it returns 200.
4. Let the pending key read return true.
5. Apply the late verification's session cookie to GET /api/me.

Observed: verification returns **201 after logout**, and /api/me returns the fictional customer.
The regression expects no authenticated person and fails. Command:
`npm test -- server/test/astra-wallet-logout-review.test.ts` (one failed, no timeout).

This is a server/cookie race, not merely stale React state. Dropping a response body in the
browser cannot undo an HttpOnly session cookie already issued by that response. At observation,
logout ends only an existing session, while verify consumes the challenge, awaits a key read,
then unconditionally creates a verified session. Logout cannot invalidate that pending work.

## Required correction before accepting 003we

Make ending/replacing an authentication attempt authoritative on the server, with a final
atomic current-attempt check before session creation. Logout must invalidate pending proofs;
issuing or switching to a newer attempt must fence old ones. Keep browser generation checks
as well, but do not rely on them for server sessions. Cover delayed verify after logout and
after a newer account attempt, across reload and independent requests/connections as needed.
An old response cookie must be unusable even if it arrives after a newer response.

Preserve one-use challenges, current recipient/network, exact issued callback, browser binding,
expiry and full-access-key verification. Do not solve this by removing verified sign-in or by
silently signing the person back in. This is an in-progress finding; inspect the final changes
before concluding whether Claude already corrected it in the remainder of this job.

Changed: this pass file, its INDEX row and the independent regression above. The prior queued
003wf brief/planning files remain separate pending Astra work. No production file was edited.

The required full `npm run check` stopped at formatting in Claude's in-progress appConfig.ts
and wallet.ts (plus an informational bufferGlobal.ts lint finding). Those production files were
left to the active writer. The independently run regression above is the concrete behavior
failure; a final full check is still required after the implementation settles.

## First correction and two remaining server orderings

Claude added cancelled_ms and a finishSignIn check under a write transaction. The original
pending-read/logout case now passes independently. The review test now also covers:

- **Response not delivered:** let verification finish server-side, hold its returned cookie
  out of the browser, send logout using the browser's still-current challenge binding, then
  deliver the old cookie. /api/me still authenticates the old session. Cancelling the challenge
  does not revoke a session already created from it when the browser doesn't yet know its token.
- **Newer challenge:** while A's key read is pending, issue a new challenge with the old binding
  cookie, then let A finish. The old session is still usable. Merely minting a new random binding
  does not invalidate the old attempt on the server.

The stable repeat reports **one passed, two failed**. An earlier overlapping run observed Claude's
temporary no-op-cancel mutation and is not used to judge the restored correction.

## Old controller cleanup can end the newer session

New independent `astra-wallet-controller-review.test.ts` runs the actual SignInController with
injected wallet/API boundaries (no cryptographic operations). It models response headers applying
A's cookie before A's asynchronous body is delivered. B then signs in and becomes current. When
A's delayed body finally resolves, finish() sees an old generation and calls blanket endSession().
That clears B's current session. The test expects B to remain signed in and fails (null instead).

This is controller evidence with a model of cookie ordering, separate from the actual-route
proofs above. Cleanup must target the obsolete attempt/session and never whichever identity
happens to be current. Retain a server mechanism that makes old late cookies unusable; simply
deleting the controller cleanup without correcting server lifetime is insufficient. The two
regression files and this note are Astra-owned additions for Claude to review and correct against.

## Independent correction repeat at the e1 handoff

All four independent cases now pass. Server sessions are associated with their challenge binding;
ending that binding both cancels the pending proof and removes sessions already minted from it.
A new challenge ends its predecessor. The controller no longer calls blanket endSession after
an obsolete result. Claude committed e1 as e6649b2 and is continuing the authorized e2/e3 work.

Astra corrected its test fixture types (the required app environment, complete WalletBoundary,
actual Person fields, and a separately typed port retaining the obsolete endSession trap).
No behavioral assertion was weakened. The current port also implements cancelAttempt, keeping
that boundary separate from blanket session deletion. Lint and types now pass.

Full check 15034 reached 1,282 passed + 1 skipped, with one existing protected-store concurrency
test exceeding its five-second deadline while checks were also running in Claude's process.
The isolated protected-store suite then passed all 12 tests in 3.98 seconds. This is not a clean
full-suite claim; repeat the final suite after implementation settles. Actual browser review of
the new sign-in integration remains pending the finite synthetic wallet harness. Also inspect
SessionProvider's asynchronous refresh/signOut/settle ordering in that review: the controller
regressions alone do not prove all React state is fenced after an identity change.

The subsequent independent full check 26951 passed: lint/types clean, **1,284 tests passed and
one platform-specific test skipped**, after e1 follow-up f48b19b. This clears the earlier timeout
for this checkpoint; no timeout setting was changed. The synthetic wallet harness and React/browser
state review remain pending, as do e2/e3. Astra's fixture type corrections are included in this
passing check; there is no need to filter those files out of typechecking.

## 003wea independent model-to-dialog completion failure

The extracted SessionModel now fences stale refresh state. Its settle() still returns the original
signed_in outcome after awaiting that refresh. WalletSignInDialog then calls finishSignIn(out.person)
without a lifetime check, including after the old dialog has unmounted. That restores the old person.

New astra-session-model-review.test.ts exercises the actual model and that exact production callback
sequence: settle A, hold its /me answer, either sign out or complete B, then release A's answer and
run the dialog's signed_in -> finishSignIn branch. Both cases fail: person becomes fictional-a
instead of null or fictional-b. The newer-account case can also leave person A paired with account B.
Two failures, 197 ms run, fictional deferred API boundaries only; no DOM/wallet/network/crypto.

Fence the complete returned outcome and prompt/dialog completion, not only the refresh write.
Review the return page's late navigation and closing/replacing a pending dialog as related lifetime
boundaries. Keep server cancellation intact. If the public model API changes, adapt the test to
the production caller contract while preserving the expected identity after logout/newer account.
These are reproduced model/caller failures; actual delayed-response browser proof remains pending.

After Claude added the completion-generation check, the independent two-case repeat passes.
Full check56168 passed lint/types and1330 tests plus1skip, with only the then-unfixed revoke
regression failing. A subsequent targeted repeat of both new review files now passes all3cases
(603 ms total), after the revoke correction too. Final full/browser checks still pending.
