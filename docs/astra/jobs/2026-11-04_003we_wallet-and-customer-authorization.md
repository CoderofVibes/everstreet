# Wallet sign-in and customer-owned service authorization

**Why (Tony's words):** "One key function of Everstreet is the seamless purchase and transfer of
business/product to the investor/acquirer, on NEAR. So, that has to stay central to this as well."
The approachable studio and customer service must work with actual account identity and customer
consent, without requiring people to understand development terminals or cryptographic internals.

**Queued, not dispatched.** After003wd correction and independent review. Registered in JOBS
after37509 completed; do not start it before the writer's overlapping retry correction passes.

## What the person sees and does

Sign in through a supported NEAR testnet wallet, return to the intended workspace, reopen it,
switch account or sign out predictably. Cancellation and unsupported wallets have usable recovery.
No name-only shortcut in configured mode. The person sees plain language for three separate acts:
proving their account, enabling this device to use a service within stated limits, and authorizing
one exact customer request. A wallet approval is never presented as a confirmed chain outcome.

Customer-use authorization survives a page reload and business ownership transfer while remaining
under the customer's control. Losing device storage or revoking the device has an honest recovery
path. An old device key, previous account or stale envelope cannot authorize new requests.

## Underneath

Design first, then implement003w-e in APPLICATION_COMPOSITION. Read WalletIntegrationAlignment,
identity.ts, customerAuthorizer.ts, customerEnvelope.ts and the actual v3 contract. Observed code:
nep413Digest currently fixes callbackUrl=None; pageAuthorizer is an injected seam; install_key
requires the customer's account and one yocto, with slot/epoch/limits; revoke_key increments
epoch and stops the serving window while already signed uses remain settleable. These are
different authorities and different payloads, not interchangeable wallet signMessage calls.

1. Select and pin a supported wallet adapter from its official API. Dependency selection is a
   routine engineering decision within this development scope; document support limits. Use
   supported connection/message/transaction APIs, not a fabricated universal wallet interface.
   Keep dependencies bounded and explain any required configuration.
2. Complete server-verified NEP-413 sign-in and actual browser wiring. Handle direct response
   and any redirect path the chosen adapter supports. Bind callback/state to the initiating
   browser and exact server-issued challenge/recipient/network; if callbackUrl is signed, the
   verifier must reconstruct that exact approved value. No arbitrary callback URLs, client-only
   account identity or replayable proofs. Preserve expiry, wrong-browser and mode isolation.
3. Account changes/logout fence pending work and private UI. A late response from account A
   cannot activate account B's state. Keep ordinary reopen/drafts/recovery behavior and safe
   return destinations. Wallet disconnect versus ending the application session must be clear.
4. Customer device use-key design: creation, storage, public-key enrollment, limits, readiness,
   reload, loss/replacement, revocation and removal. Keep private material exclusively on the
   customer device, outside server records/logs/analytics/export and business sale assets.
   Review browser support and storage failure behavior; do not claim a universal device guarantee.
5. Build actual reviewed install/revoke requests for the customer's wallet with exact contract,
   account, plan, slot, public key, limits and deposit. Confirm authority from fresh contract
   readback, not an optimistic wallet result. Interrupted enrollment recovers the original key
   and intent; it must not silently generate and enroll replacements. Do not silently add a
   full-access account key to enable service use.
6. Wire the real customer authorizer through normal composition/UI, retaining the synthetic
   preview as an explicitly labelled separate dependency. Recompute/validate the exact envelope
   before authorization, recheck key slot/epoch/account/readiness, keep original requests separate
   from edited drafts and respect consent/expiry. A NEP-413 account proof is never a raw hold/use
   signature. Preserve existing privacy, delivery, settlement and100/20/80 invariants.
7. Identify missing purchase/enrollment prerequisites and exact transaction preparation needed
   for a fresh customer. Implement necessary bounded adapters or open explicit follow-ups within
   this parent; do not declare the end-to-end customer path complete from a pre-seeded entitlement.
   Keep operations and NEAR acquisition available to the same business identity.

## Done when

The actual normal browser entry supports the chosen wallet adapter and durable customer
authorization configuration. Tests inject the wallet/RPC boundary, use disposable ephemeral
keys and fictional data, and exercise real controllers/routes. Cover cancellation, redirect
return/replay, missing/invalid capability, reload, wrong account, changed key/epoch, expired
challenge/envelope, lost enrollment response, storage unavailable/lost, revocation and late
answers after logout/switch. Validate cryptographic interoperability with the contract-produced
fixtures and the pinned wallet/SDK where applicable, not two mutually matching homemade codecs.

Provide a finite no-network browser review harness for actual sign-in/enrollment/use/recovery
and phone/keyboard review. Inject at the wallet/RPC boundary without replacing the production
controller or presenting synthetic proof as live wallet evidence. Test cleanup and resource
bounds, run npm check/webbuild, commit locally and report precise scope and remaining gaps.

Prepare (do not execute) the exact real wallet/testnet rehearsal prerequisites and steps.003w-f
still owns the full same-business integrated/restart100/20/80 journey. Keep003w parent partial
until all required slices and acceptance gates pass. Stop at the bounded handoff for Astra review.

## Not in this job

No real wallet connection/account creation, real key enrollment, customer payments, transactions,
provider calls, host testing, deployment, push, spending or submission. Tests may construct and
verify synthetic signatures with newly generated test keys; existing credentials remain unread.
Do not invoke legacy main, enable the unaccepted worker, or read local-only research/Day One.
No new full-access server custody or narrowing of the six milestones.

## Priority and size

P0/L; after003wd, before003w-f. If implementation needs subdivision, write bounded child jobs
with dependency order and concrete gates; retain every requirement above. Sole actual Claude
Opus5.5/high builds; Astra reviews. No routine design approval needed.
