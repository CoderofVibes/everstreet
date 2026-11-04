# Compose the digital platform in its normal application entry point

P0/L, after002e and003v, explicitly dispatched alongside the remaining004b/005c/005d roadmap.
No second writer. This is required integration work, not full production or live-chain acceptance.
Tony wants one platform to build, operate and acquire a digital business while customers continue.

## Grounded gap

Astra read server/src/main.ts and app.ts on November4. main creates localPreview:true, legacy
OpenSeat/v2 services and configured AI authoring/runtime; it supplies neither v3 nor customer
options. It also starts a legacy worker after ambient local key discovery. AppOptions has the
actual V3Options and CustomerUseOptions seams. customerUse.ts still defines CustomerChainWriter
and InputProtection; web/customerAuthorizer.ts is a page-supplied seam, with only the synthetic
preview integration currently demonstrated. v3rpc.ts provides a bounded read-only view adapter,
not a customer transaction writer. Existing route/controller proofs do not establish normal-app
composition. Do not run today's main to inspect secrets or silently trigger its legacy worker.

## Product result and implementation

The same normal application can show a truthful capability inventory and run the configured
digital workflow with durable records. No hidden demo injection is required to make an offer or
use available. Missing components explicitly identify what is unavailable and keep unrelated
work usable. An owner sees readiness; customers get a simple actionable unavailable state.

1. Design explicit application modes and a side-effect-controlled composition root before code.
   Preserve legacy tests and workflows. Local fictional preview is loopback-only, has clear
   provenance, and cannot silently discover live signing keys or start a real chain writer.
   Configured testnet mode explicitly names its capabilities; mainnet remains refused. A future
   public deployment cannot enable arbitrary fictional-person switching or depend on it for auth.
2. Wire actual completed adapters for build/execution, protected durable customer storage,
   configured v3 observation, customer read/write, model runtime, bounded maintenance and offer/
   release/acquisition services through deliberate configuration and validated identities.
   Don't import test fixtures into normal configured mode. If a required real adapter is missing,
   identify and implement it as a bounded sub-job rather than declare composition complete using
   a stub. Keep optional capabilities independent: lack of a writer need not prevent honest reads.
3. Configuration examples use placeholders only. Validate network/business/account/operator/
   key identifiers, separate development subscription auth from product billing, and keep model
   execution off without a configured budget. No opportunistic filesystem credential search,
   credential values in status, synthetic signer fallback or enabling paid calls just to test.
4. Recover durable work on restart using existing state machines: unknown dispatch isn't retried
   as a fresh provider request or transaction. Bound concurrency/maintenance and shut down cleanly.
   Customer ciphertext/retention and request identity survive restart and business sale.
5. Auth and wallet readiness must be explicit. Existing session-by-name creation and preview
   actor switching are not durable production identity verification. Prepare the concrete secure
   sign-in/account-binding/customer-authorizer integration if it is not yet implemented; do not
   turn localPreview:false into a false production-readiness claim. Verify supported wallet
   signing capabilities against the exact custom hold/use message scheme; never assume a generic
   wallet message-sign API signs those bytes. Additional live/account decisions remain separate.

## Evidence

- Meaningful composition tests start the real entry factory on a finite loopback listener with
  disposable durable storage and explicitly selected synthetic network/provider dependencies.
  They exercise the same composition code as configured mode, and label the dependency evidence.
  Repeat across process restart, rather than only keeping one in-memory Store alive.
- Missing/invalid/network-mismatched setup fails before writes; readonly mode makes no signer or
  paid model calls; fictional actor switching is inaccessible outside explicit preview mode.
  Ordinary readiness/status output excludes credentials, paths carrying secrets and private data.
- Integrated idea/revision/build/check/offer/customer-use/operating-evidence/exact-sale path uses
  one business identity. Preserve the existing100/20/80 fixture journey and the live acceptance
  gate. Assert old-owner denial, buyer management and customer result/units persistence after
  close and restart. An actual synthetic close is never reported as a live NEAR transaction.
- Browser review of the normal composed entry, not only bespoke per-feature previews. Review
  fresh setup, missing capability, recoverable outage, reopen and current authority.
- npm check/webbuild, bounded resource/cleanup evidence, explicit commits/report. Prepare a
  separate exact testnet/provider rehearsal packet for any external steps: required accounts,
  budget, transactions, inputs, receipts and cleanup. Do not run them merely because this job
  describes them. Astra doesn't sign/deploy; no new external release or spending authority.

Allsix milestones retained. Preserve004b/005c/005d and M6 expansion, rather than silently
substituting a local integration demo for the full platform. No push/public release/mainnet/
submission/real data/research/Day One. Exact Opus5.5/high, supported subscription capacity.
