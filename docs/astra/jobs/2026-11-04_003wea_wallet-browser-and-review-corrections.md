# Finish wallet browser review and exact revocation consent

P0/M; child of 003we, before its remaining fresh-customer slice and queued 003wf.
Tony's approachable customer service and uninterrupted acquisition remain the requirements.

## Reproduced browser failure at b961892 / 6773920

Astra built the web app and ran scripts/wallet-harness.ts for five minutes (768 MiB Node heap).
Opened its printed /use/<offer> in the actual IAB. Sign-in dialog correctly names the synthetic
wallet; Continue successfully authenticates Cara Okafor. The destination then says "Not available"
and remains unavailable after reload. No console warnings/errors were captured. Tab closed.

Source confirms the harness calls w.offer() without publishing its business. The actual
publicOffer route correctly requires published_at. customerPreview.ts already handles this
prerequisite, but walletHarness.ts does not. Do not relax public access rules to fix the fixture.
Also inspect its clock: the older preview synchronizes fictional chain/time with browser time;
this harness currently does not. It must support the actual prepare/authorize/use flow, not only
direct-controller tests that bypass the product page and browser clock.

## Required correction

1. Make the finite harness enter the real customer page with a valid, explicitly fictional
   published offer and coherent time. Exercise public offer, verified sign-in, keys, prepare and
   real authorizer/use through the existing production routes/controllers. Keep CSP/network
   refusal, ephemeral keys, exact wallet module boundary, bounded lifetime and cleanup. Do not
   replace production services or claim this is composeApplication/live NEAR evidence.
2. Read DeviceKeyReview's latest request-review section. Enrollment now has two steps; revoke
   still sends from the first slot button. Give both this-device and lost-device revocation an
   explicit exact-request review/confirm flow. Explain the current window stops while already
   signed uses remain settleable. Show acting account, contract, plan, slot, deposit and gas in
   readable details. Never silently change the reviewed request after a fresh read/account change.
   Correct report requirement 5: the current two-step claim applies only to enrollment.
3. Verify SessionProvider itself, beyond SignInController. refresh() currently applies awaited
   /me without a generation fence; settle() awaits refresh; signOut() clears state only after its
   response. Reproduce delayed old refresh / logout / newer sign-in orderings with deterministic
   barriers, then fence stale state/results, resolver completion and private mounted controls.
   An old refresh must not restore an ended identity, and a delayed logout response must not clear
   a newer identity. Keep server cancellation and existing cookie/attempt tests intact. This is a
   source-identified risk until reproduced; report actual findings precisely.
4. Offer/account/unmount changes must clear pending request presentation and busy/error state,
   retire the old authorizer and own its IndexedDB connection even when open/read resolves late.
   Preserve the now-passing two-handle claim/update/delete tests; no weak fallback in real storage.
5. Provide bounded harness controls needed to review late answers, account switching, cancellation
   and lost wallet answers in the real browser, not hidden state injection into React. Add actual
   API/controller regressions for the published offer and clock prerequisite, plus meaningful
   lifetime/review cases. Run check/web build, local commits, report exact remaining browser gates.

Review and commit the pending Astra reviews, four probe files, INDEX and queued 003wf planning
after checks; do not leave these repeatedly uncommitted. Preserve their evidence distinctions.
003we remains partial: quoted storage, token balance/registration, purchase sequence, customer
purchase UI and uncertain-purchase recovery are the next bounded child inside this parent.
003wf remains queued after that, alongside 002f1 and every other roadmap milestone.

No real wallet/transaction/provider/host action, credentials, legacy main, deployment, spending,
push/publication, research or Day One access. Exact actual Claude Opus5.5/high subscription;
one writer. Stop at this bounded review handoff with the harness ready for Astra's actual UI pass.
