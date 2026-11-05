# Application composition design review

003w remains the sole implementation job in Claude87576. Astra read the initial
APPLICATION_COMPOSITION design and the named adapter/identity sources. No application files
edited by Astra. The split into003w-a through-f preserves the requested end state: the missing
writer, browser identity/device authorization and integrated journey stay required, not complete
because they are unavailable. Worker conformance remains a separate unpassed gate.

## Concrete details to resolve while implementing

1. **Bind sign-in to its initiating browser session.** Section4 currently describes a database
   nonce returned by challenge and echoed to verify, without a separate browser/session binding.
   WalletIntegrationAlignment already requires that binding. Define and implement it (including
   configured origin/recipient, one-use state and redirect handling) rather than treating an
   arbitrary valid signed nonce from another browser as sufficient to set this browser's cookie.
   Test two isolated browser-cookie contexts: a proof initiated in A must not log B in. Concurrent
   verification of one challenge must create at most one valid session; restart/expiry must not
   reset its use. This is a design gap to verify, not a claim of an implemented exploit.
2. **Use an actual process restart for the integration evidence.** Section6 currently calls
   stop/compose-again on the same files a process restart. That tests adapter reconstruction in
   one process. Keep it, but also start a fresh bounded child process on the same disposable
   files after the original exits, as003w explicitly requires. Verify durable identity, customer
   objects and unknown request recovery without surviving in-memory objects or timers.
3. **Correct the contract method name.** Section7 names `settle_hold_for`. Actual
   contracts/business-v3/src/lib.rs exposes `settle_hold` at1524, `open_hold` at1439 and
   `release_hold_for` at1597. CustomerChainWriter's settleHold seam describes `settle_hold`.
   Build the adapter against those exact method/argument/return contracts. No protocol change
   is requested; preserve the registration guard on release.
4. **Keep the design's status evidence accurate.** Its initial top line says a/b/c implemented
   while the run is still writing them. Label intended end-of-slice status as planned until
   implementation/check evidence exists. The same applies to the ciphertext/sale/restart sentence
   pointing to section6: section6 is an evidence plan, not a completed proof.

These sharpen existing003w requirements; no new scope, external action or routine approval.
The ordinary documented launch path must select the safe composed entry; leave the old legacy
entry explicitly named if retained. Never run it to discover keys. Keep M1-M6 and the remaining
import/network/portfolio/product-family jobs. No research, other-project, credentials or runtime
data were read; no network/signing/deployment/provider/worker activity in this review.

Astra changes: this review, INDEX row and ignored BUILD_STATE checkpoint. Claude reviews and
commits locally. Required check40490 exited0:1220 passed+1Linux-only skipped, lint/types clean.
This ran during implementation, before identity.ts was complete; it is not003w final validation.

## Initial identity implementation review

The now-written identity.ts/app.ts confirms the first issue remains: challenge() takes no browser
binding, verify() accepts only the body's account/key/signature/nonce, and the route supplies no
separate cookie/session binding. A finite call to the real everstreetApi/openDb(':memory:') with
an injected reader that would throw if called produced:

```json
{"challengeStatus":200,"setsBrowserBindingCookie":false,"challengeIssued":true,"externalReads":0}
```

The request carried an unrelated synthetic Origin. No signature was created, no token/nonce was
printed, no listener/network ran, and the database closed in finally. This is route/source evidence
for missing initiation binding, not a completed cross-browser exploit test. Implement and test
the two-context proof rejection before accepting003w-b. Also check stored challenge recipient
against the current configured recipient; rebuilding from stored recipient alone must not allow
an old application's outstanding challenge after configuration changes.

Required check after this appendix: exit1 at lint because Claude's newly written appConfig.ts
was not yet formatted. Types/tests did not run in that invocation. It is in-progress code;
no Astra formatting edits to the builder's files and no final003w validation claimed.

## Real build-worker shutdown failure

The new compose.stop() calls startBuildWorker's stop then immediately closes the records DB.
Source review shows that helper's stop only clears the interval; its already-running
`while (await worker.runNext()) {}` continues. Astra independently reproduced the helper bug:

- Use real Store/openDb(':memory:'), Builds and everstreetApi. Create a fictional founder and
  two separate AI API projects through actual routes, with two admitted build jobs and ordinary
  valid budgets (10,000 input/2,000 output tokens,60 seconds,10-cent synthetic ceiling).
- The injected scripted provider holds its first call on a Promise. Start the real scheduler
  with pollMs5, await the first call, call stop(), then release the first scripted response.
- After150ms, output is `{"callsAtStop":1,"callsAfterStop":2,"networkCalls":0}`: the second
  job dispatches after stop. Both use only synthetic usage events. The timer was stopped and
  the in-memory DB closed in finally; process exits0. Initial probe with a3-second budget was
  refused400 during setup, then corrected to the ordinary valid budget before reproducing.

This directly proves the scheduler helper can dispatch after stop. It does not claim the new
compose.stop already makes another paid call: that path closes the DB immediately, so pending
worker callbacks can instead encounter a closed DB while the provider is still running.
Make shutdown stop admission/queue draining, bound and abort or drain in-flight operations,
then close resources in the correct order. Test the actual composed lifecycle with a held
synthetic provider and pending second job, plus restart evidence for interrupted work. Do not
solve this by removing model wiring or claiming only no-provider shutdown is supported.

Also verify partial construction/listen failure cleanup: compose opens the records DB before
reading protected keys; a later failure currently has no construction unwind in the source.
This last item is a review target, not an independently reproduced leaked-handle claim.

## Integration checks during implementation

Required fullcheck10354: lint/types pass,1225 tests pass,1skip,4 composition tests fail with
localhost connect EACCES in the restricted context; one failing test also reports temp cleanup
EPERM. The first composition in the restart test is not registered for cleanup before sign-in,
so an early assertion/fetch failure can skip its explicit stop. All disposable resources need
cleanup registered as soon as acquired, including this first composition.

One corrected network-capable execution of `npx vitest run server/test/composition.test.ts`
passes8/9. The remaining real-entry restart test fails with ECONNREFUSED on its loopback port.
Its run() currently treats a startup log substring as readiness, without checking the child
exit or an actual listening acknowledgment. entry.ts logs immediately after serve(), before
an explicit listening event. Diagnose the child/error/readiness ordering; the failure is observed,
but its exact cause is not yet independently established. Do not simply add an arbitrary sleep.
Register exit-aware bounded startup, listener error handling and cleanup that awaits child exit.
No retry loop was used: only the one correction from denied localhost networking to host context.
The exact failed-test temp directory was checked for cleanup after the process ended; it was
already absent then. No unrelated temp paths or processes were touched.
