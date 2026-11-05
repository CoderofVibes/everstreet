# One configured business from creation through customer use and acquisition

**Parent partial;003wf1 lifecycle child dispatched November4 after67009bd.** P0/L; retain every
gate below. See GuardedRevokeSourceVerified for source/keyless acceptance and explicit sequencing:
independent lifecycle work proceeds while003web/003wec browser submissions await permission.
Those gates remain open and must pass before full parent acceptance. Other children require
explicit bounded dispatch, with no duplicate writer.

**Why (Tony's words):** "One key function of Everstreet is the seamless purchase and transfer of
business/product to the investor/acquirer, on NEAR. So, that has to stay central to this as well."
The person should use one platform to create, operate, buy and continue serving a digital business.

## Grounded gaps at 373a17c / cc4aa9f

Astra inspected compose.ts, composition.test.ts, customer-settlement.test.ts, customer-world.ts,
maintenance.ts, anthropic.ts, v3intents.ts and the acquisition/sale design documents.

- Configured composition builds the real RPC adapters, but model adapters call httpsTransport
  without its existing fetch injection option. A no-network configured journey needs an explicit
  labelled transport seam, not replacement application services or global network patching.
- MaintenanceSupervisor exists with bounded phases, leases and stop/drain, but compose.ts does
  not instantiate it. Existing API maintenance tests do not establish normal-entry scheduling.
- The 100/20/80 test starts from a funded entitlement and switches sale fixture views. It proves
  valuable route behavior, but not fresh customer funding, real writer serialization through the
  configured app, a browser purchase, or a single coherent chain state across all those actions.
- The current acquisition workspace explicitly does not propose, fund, accept or close a sale.
  Recording an observed version and applying its outcome is not the requested purchase flow.
- 003wd's report leaves separate-process nonce/migration races, the CustomerUses route/restart
  path, and the needs_reconciliation/legacy_invalid operator procedure open.

These are implementation and verification requirements, not grounds to narrow the roadmap.
Reinspect after 003we; avoid duplicating whatever it completes.

## What the person sees and does

A founder signs in, turns an idea into a reviewed document-to-data service, sets a price and
budget, and makes it available. A fresh customer buys 100 uses, enables their device with explicit
limits, and consumes 20. The founder sees the corresponding operating evidence. A buyer reviews
the exact sale, funds and accepts it through their wallet, and receives management access after
confirmed finality and reconciliation. The customer keeps the same product, results and 80 uses.
The buyer serves the next use and can release a reviewed update. The former owner loses management
access. External transfer items retain their own evidence and are never called transferred by NEAR.

Missing setup, unanswered actions and outages have clear next steps. Neither refreshed pages nor
restarted processes silently repeat a purchase, provider request, acceptance or charge.

## Implementation slices and required evidence

1. **Complete composition and lifecycle.** Wire the existing bounded customer maintenance service
   through explicit configuration and deliberate start/stop. Share the correct guarded adapters,
   current authority checks and durable records; do not start a second competing uncoordinated
   loop. Verify restart, admission stop, drain/fence, late callbacks and DB close ordering with
   actual child processes. Configuration/readiness must distinguish enabled from healthy/current.
   Add a labelled network-boundary seam for configured model transport and preserve actual
   provider adapters, budgets, parsing and accounting. Synthetic transport must refuse unexpected
   destinations; never fall through to real fetch. Keep isolated generated-code execution disabled
   until 002f1 is independently accepted; this service-family journey must not claim that gate.

2. **Finish actual commerce and acquisition entry points.** Inventory which customer purchase,
   registration, owner plan/operator and sale transaction preparations remain after 003we. Implement
   the missing necessary adapters/UI as bounded children. Use the pinned wallet API, exact network,
   recipient, asset, base-unit amounts, deposits, version/digest and permissions. Read the actual v3
   methods and BUSINESS_V3_SALE rather than routing v3 through legacy v2. Support the full reviewed
   Direct sale path, cancellation/revision/expiry/refund and owed-versus-paid proceeds honestly.
   Preserve Gated requirements and implement its required closer/continuity integration in an
   explicit child if needed; a synthetic closer cannot prove drain or service continuity. Do not
   silently remove Gated from the roadmap or call it working merely because contract tests pass.
   Lost wallet answers recover the exact original intent and fresh contract evidence; account
   switching, revised terms and stale answers require renewed review rather than automatic signing.
   Include the metering grant in reviewed transfer terms when continuity depends on it; if absent,
   explain the interruption and the buyer's explicit grant/readback path. No hidden reappointment.

3. **Recover unresolved writer history.** Provide an access-controlled, bounded operator workflow
   for needs_reconciliation and legacy_invalid. Show the operation, attempts, immutable identities,
   evidence and remaining uncertainty without private customer content or signed bytes. Only
   authoritative exact evidence can resolve the outcome. No "mark successful" or "retry fresh"
   button based on elapsed time, missing status, used nonce or expired block. Handle earlier
   unresolved attempts behind a later terminal attempt. Verify competing processes and restart;
   retain uncertainty when the available evidence cannot settle it.

4. **Exercise the real configured route chain.** A finite harness starts the normal composition
   with disposable durable databases, ephemeral test identities, actual production services and
   adapters, and injection only at wallet/network/provider boundaries. Use one coherent synthetic
   chain that validates encoded transactions/signatures and applies the relevant state transitions;
   anchor its behavior to contract-produced fixtures and separate actual contract tests. Do not
   simply swap accepting/closed JSON to represent a wallet purchase. Label this evidence synthetic.
   Seed only explicit bootstrap prerequisites; create project/revision/build/check/release/offer,
   funding, enrollment, requests and acquisition through the normal supported APIs/controllers.
   Prove 100 purchased, 20 delivered/charged, 80 preserved at close, then 79 after the next use.
   Verify budgets/cost records, ciphertext retention, no owner access to customer documents,
   same request/result identities, seller denial, buyer management and reviewed update delivery.

5. **Restart and concurrency matrix.** Terminate and restart actual app processes at bounded
   checkpoints around purchase acknowledgment, persisted writer intent, accepted-but-lost replies,
   provider dispatch/result storage, settlement and close/reconciliation. Confirm exact identity,
   no duplicate effects and surviving customer access. Exercise same-operation and distinct-
   operation nonce contention across separate OS processes, plus simultaneous old-schema opening.
   Failed startup may be retryable but must not corrupt or misclassify history. Use deterministic
   barriers rather than sleeps to manufacture races. Keep deadlines, memory, call ceilings and
   cleanup explicit; late operations cannot touch a closed database or regain old authority.

6. **Actual browser review.** Provide a finite loopback harness of this normal composition for
   Astra, with clearly labelled synthetic identities and wallet/network controls. Cover founder,
   fresh customer, seller and buyer; happy path and lost-response recovery, reopen, missing
   capability and authority changes. Review 1440/1280/390, keyboard/focus, zoom and reduced motion
   where tool support allows, recording any unverified checks. Keep private acquisition evidence
   out of storefronts. Use the approved calm, luminous design and substantial evidence/charts.
   Preserve the first complete creative walkthrough for after the buildout.

7. **External rehearsal packet, prepared only.** List exact prerequisite accounts/deployments,
   supported wallet, verified code hashes, FT/storage deposits and gas, provider authentication and
   explicit spend ceiling, inputs, ordered commands/actions, expected receipts, cleanup and abort
   criteria. Distinguish recorded legacy evidence, local contract execution, synthetic HTTP/browser
   results and missing live evidence. Request only genuinely new external decisions once this
   packet is concrete. Do not execute it under the local implementation authorization.

## Acceptance and scope

Run meaningful regressions, npm run check and web:build; record local commits and a requirement-
by-requirement evidence matrix. Fix concrete failures before marking a child accepted. Keep the
parent partial while any required real adapter, lifecycle path or verification is missing. Passing
this local configured journey alone does not prove live NEAR or provider behavior, M2, or full M3.

Claude owns contract/scripts/config/signing implementation and local commits; Astra reviews.
No real wallet connection, transaction, existing credential read, paid call, deployment, worker
host attempt, push, public release, mainnet, submission, spending or research assessment in this
job. Keep 002f1, 004b, 005c, 005d, 006a and all six milestones. No Day One access. Exact actual
Claude Opus 5.5/high subscription capacity; one writer. Stop at bounded review handoffs.
