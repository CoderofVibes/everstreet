# Device-key lifetime and concurrent enrollment review

Tony's customer-continuity requirement includes recoverable authorization: the customer keeps
control of the same device key through interrupted work, without authorizing after leaving the
account. This is an in-progress review of 003we2, with Claude 88579 as sole implementation writer.

## Two independent reproductions

`server/test/astra-device-key-review.test.ts` exercises the actual DeviceKeys controller with
synthetic read, store, wallet and WebCrypto boundaries. No real signature or key is generated,
no browser storage is used, and no transaction or network call occurs.

1. **Retirement during readiness read.** Start authorizer.sign, hold its readback promise, retire
   the DeviceKeys instance (account change/sign-out), then return the unchanged ready key.
   Observed **two synthetic sign calls**, expected zero. The alive check precedes the awaited
   read and is not repeated before signing. Fence after every asynchronous boundary, including
   between the two signature operations, and do not deliver a pair after retirement.
2. **Two enrollment controllers.** Two instances share a store and both observe its original
   empty record before either generates a key. They each persist a different key and request
   enrollment in the same slot. Observed **two distinct requested public keys**, with only the
   second stored. If the first enrollment lands, its private half has been overwritten and the
   promised same-key recovery is impossible. The test uses a barrier, not timing sleeps.

Command: `npm test -- server/test/astra-device-key-review.test.ts`: two failures, 6 ms test time.
These are controller interleavings, not claims of actual two-tab IndexedDB execution.

## Corrections and acceptance

Preserve one recoverable enrollment identity with an atomic storage decision shared by tabs,
not only a component's busy flag or a per-instance lock. Generation may happen outside the
transaction, but losing contenders must recover the stored winner or refuse before wallet use;
they must not overwrite an outstanding key. Test the real IndexedDB implementation over separate
handles (fake-indexeddb is already installed) and later the browser harness. Include interruption,
reload and denied storage, and keep exact reviewed slot/key/limits stable through recovery.

The existing private-key storage and exact contract signature requirements remain. Review
revocation/forget as well for late deletion overwriting a newer record or acting after retirement.
The new independent test fixture may need adaptation if the store interface gains an atomic
claim operation; retain the behavioral assertions and add actual storage-level evidence rather
than treating an absent mock method as a product regression. This is not final acceptance of
unfinished code, and no second implementation writer was started.

Changed: this pass file, its INDEX row, and the two-case independent test. Astra did not edit
Claude's production files. The previous wallet review and queued 003wf planning work remain pending
review/commit. All six milestones and the separate actual browser/live gates remain open.

Required full check stopped at formatting of the in-progress deviceKey module and this test's
import order. Astra fixed only its test's imports; the targeted Biome check and npm run typecheck
then passed. The two behavioral regressions remain failing pending Claude's correction; a clean
full suite is required after implementation settles. 88579 was polled and remains live.

## Source review: readiness refresh feedback loop

The first UI wiring introduces a concrete effect cycle to correct before the browser harness:

1. CustomerProduct passes a new inline onAuthorizer function on every render.
2. DeviceKeyPanel's apply depends on onAuthorizer; check depends on apply/onAuthorizer; its effect
   calls check whenever check changes.
3. A successful read calls apply, then onAuthorizer, then w.refreshAuthorizer().
4. refreshAuthorizer unconditionally calls CustomerWorkspace.set, which creates a new snapshot and
   notifies useSyncExternalStore subscribers. CustomerProduct renders again, returning to step 1.

This is inspected source/data-flow evidence, not yet a browser measurement. It applies even when
the authorizer remains null. Stabilize the parent callback and effect dependencies, and prevent
unchanged readiness from creating a self-triggering refresh. Verify a bounded initial read and
explicit refresh in the actual harness, including after unrelated parent updates. The panel also
opens a new IndexedDB connection on every view through store: () => openDeviceKeyStore(); give
that resource an owned lifetime and cleanup instead of accumulating connections during checks.

Keep the other acceptance items: late reads after offer/account change must not restore stale
readiness; the real request fields need explicit review before wallet submission. Current preview
copy says "exactly this" while its first public key is still a placeholder and enroll may choose
another free slot after the read. Recheck what is shown against what is actually submitted in the
browser review, rather than calling the placeholder an exact transaction preview.

## Harness fidelity review before browser acceptance

The in-progress walletHarness.ts calls its synthetic install/revoke behavior the contract's rules.
Source comparison with business-v3/src/lib.rs install_key/revoke_key finds gaps: installation does
not check the supplied plan identity or plan hold limit, and revocation does not shorten the active
hold's serve_until_ms for that slot. Preserve the real contract's customer continuity semantics in
the double, or explicitly limit its evidence; a successful harness revocation cannot establish
that pending service authorization stopped. Keep already signed uses settleable as the contract does.

The initial listener is loopback and time-bounded, but that alone does not establish the stronger
"Nothing leaves this computer" statement. Check the actual Wallet Selector setup path and enforce
an outbound-network refusal for this harness before calling it no-network. Do not substitute a
controller-level mock for the browser's real selector/module boundary in the acceptance evidence.
These are source-review findings on unfinished code, not executed browser or live-chain results.

Full check 23483 after this review update: lint and types pass; 1,287 tests pass, one is skipped,
19 fail. Two are the unchanged device regressions above. The other 17 are loopback-dependent
composition/sign-in cases in the restricted execution context (connect EACCES, with downstream
failed-fetch assertions/timeouts). This does not supersede the earlier unrestricted e1 pass or
establish 17 new product regressions. Repeat the final check with the authorized local-listener
permissions after Claude's corrections; do not alter assertions or increase timeouts for this.

## Independent storage correction check

While Claude replaces the controller, Astra added astra-device-store-review.test.ts to exercise
the production IndexedDB adapter through two separate handles on one fake-indexeddb database.
Competing claims both return the stored winner; a delayed update/delete from an old handle cannot
overwrite/remove a replacement public key. Both tests pass (237 ms total run). The records contain
dummy private-key objects: this proves cross-handle storage decisions, not CryptoKey persistence,
real browser behavior, or completion of the controller/UI correction. No wallet/network/crypto.
Claude must review and commit this additional independent test alongside the earlier probes.

Independent full check 93100 with permitted loopback access now passes **1,315 tests + 1 skipped**,
including both original controller regressions and the two storage tests. Types pass; lint has
two warnings for comma-operator fallback helpers in the in-progress deviceKey.ts. This clears
the restricted-run failures and the two original behavioral failures at this snapshot. The UI,
same-key intent concurrency, SessionProvider lifetime and browser review remain separate gates.

## Remaining request-review UI gate

The corrected panel now prepares a real enrollment key before presenting its request. Revocation
still calls k.revoke directly from the first slot button, including the lost-device buttons; it
does not present the revoke contract/plan/slot/deposit or a separate reviewed request. Requirement
5 includes both installation and revocation. Give revocation a review step with plain-language
consequences (the current service window stops; already signed uses can still settle), exact
request details and a final explicit wallet action. Include the acting account and gas alongside
the existing request fields, without making raw method/argument names the primary explanation.
This is source review of the current panel; actual browser review is still pending the handoff.

## First actual browser handoff: product unavailable

At b961892/6773920 (report 7f6fc0b), independent web build passes (main chunk 911.63 kB).
Astra ran wallet-harness for five minutes with a 768 MiB heap and opened the printed product in
IAB tab 59. The synthetic sign-in dialog completes and the header shows Cara Okafor, but the
product shows "Not available". Reload preserves that failure; console error/warning list empty.
The screenshot shows the synthetic strip, authenticated header and unavailable product together.
The tab is closed. Source confirms the harness does not publish its business, while the real
publicOffer correctly requires it. Also verify the harness clock against real browser time.

Opened 003wea for this reproducible blocker, exact revocation review and SessionProvider/late UI
lifetime review. The earlier source risks remain distinct from this actual browser reproduction.
All six milestones, remaining fresh-customer work and 003wf stay open. No live action occurred.

## 003wea in-progress: replacement key under an old revoke review

New independent astra-revoke-review.test.ts exercises actual DeviceKeys with fictional injected
wallet/store/read boundaries. Prepare a revocation for slot0/keyA/epoch1; another device revokes
and installs keyB/epoch3; then submit the earlier review. Current comparison checks only the
revoke_key call fields (contract/plan/slot/deposit/gas), which remain identical, so it sends one
wallet request. Expected no send until the changed key is reviewed. Targeted run: one failure,
194 ms total. No signature, transaction, real storage or network.

Bind the review to the observed key/epoch and entitlement registration as well as its exact call
and account/network. On an observed identity change, clear/re-present the review rather than
silently revoking a replacement. If the interface changes, adapt this test to pass the complete
review object without weakening the no-send assertion. The contract's existing revoke_key is
slot-based; a client read is not an atomic on-chain identity guarantee. Document that limit and
assess whether a guarded method is necessary; do not claim a frontend comparison proves it.
This is a concrete controller failure, separate from pending actual browser verification.

Full check after the new probe stopped at in-progress DeviceKeyPanel ARIA validation. Astra
removed its own unnecessary non-null assertion; its targeted Biome check and full typecheck pass.
Claude owns the panel and revocation implementation; leave them to the sole active58217 writer.
The behavioral regression remains failing until its correction; no final acceptance is claimed.

The subsequent independent targeted repeat passes the replacement-key case, alongside both
SessionModel callback cases (3/3). The implementation remembers an observed key/epoch/registration
and compares it at the next read. Its current map is keyed by serialized call fields, so a later
review for the same slot replaces that observation; keep review lifetime/caller binding in the
final audit rather than assuming byte-identical revoke calls identify a particular key. The
slot-based contract race remains explicitly open; a guarded on-chain method is follow-up work.

## Follow-up: the serialized-call observation can be overwritten

Astra extended the actual controller probe to three orderings. Original replacement still passes.
Two new orderings fail (one wallet request each, expected zero): prepare key A, replace with B,
then either prepare a newer review before submitting A's old call, or submit A's old review twice
after the first attempt correctly returns changed. Both calls have identical serialized bytes;
the map now holds B's observation, silently relabelling A's old review as B's. Targeted test at
18:12 Pacific: 1 passed, 2 failed, 216ms. No network/signature/real transaction.

This is controller evidence, not a reproduced UI exploit: the current panel replaces the shown
review on changed and disables actions while busy. Still, a reviewed call alone cannot identify
the key it was reviewed for. Bind an immutable review object/token plus observed identity to each
confirmation, and validate that original observation without overwriting it under equal bytes.
Adapting this probe to the complete review object is appropriate; weakening no-send is not.
Preserve the separate acknowledged on-chain slot race. The test and this appendix are Astra's
pending changes for the sole Claude writer to review alongside 003wea browser corrections.

Required full check83328: lint/types pass; 1331 tests passed, 1 skipped, 3 failed. Two failures
are the new revoke orderings above; the other is protected-store concurrent/repeated writes
at its 5-second timeout (5253ms), matching the separately recorded contended-run issue. No
unrelated implementation failure is inferred from that timeout, and no clean full pass claimed.

At the immutable-review correction, Astra adapted its probe to pass the entire original review,
not its now-insufficient bare call (otherwise universal bare-call refusal would pass vacuously).
All three original no-send assertions independently pass,489ms. Actual browser repeat and final
full check remain pending; this does not close the separate on-chain race.
