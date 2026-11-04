# Fence reservation evidence before customer execution

**Why (Tony's words):** "the seamless purchase and transfer of business/product to the
investor/acquirer, on NEAR" remains central. A customer's reservation must not be declared
refused by old evidence, or usable after its serving deadline.

## What the person sees and does

Uncertain evidence stays uncertain and recoverable. Exact historical reservation proof is
distinct from permission to serve now. No false statement that units were never reserved.

## Independent reproductions at5bb81a0

Astra ran three finite real-app tests, all failing as expected. Temporary probe removed after
review; reproduce these as permanent behavioral tests before fixing:

1. customerWorld(); create offer and prepare with key astra-probe-0001/input Fictional invoice
   412 USD. Preparation sees block1000 and key epoch1. Override reader.finalBlock to height999,
   hash B repeated32, timestamp chain.ts-1000. Override its view to funded_100.entitlement with
   keys[0] copied from empty keys[1] but slot0, key_states[0]=0,key_epochs[0]=0. This is a labelled
   coherent historical state before installing the key. Confirm using w.signed(use.envelope).
   Actual writer opens one hold, but response is refused:key_changed and allocation is freed.
   Expected: stale read rejected, unknown retained. evidence_height is null initially; compare
   with prepared_block too. Key epoch regression is inconsistency, never proof of refusal.
2. Prepare normally; writer modes=[drop,drop]; confirm leaves reserve_unknown at block1000.
   Override finalBlock to that evidence block with a different valid hash (C repeated32);
   override entitlement to the funded fixture with key0 revoked at epoch2 and matching summary
   arrays. Reconcile currently terminalizes as refused:key_changed. Expected: equal-height hash
   conflict retained/refused as evidence, with no allocation release, fresh hold or resend.
   Also test same hash with changed view digest/timestamp and conflicting historical fields.
3. Prepare normally; reader.failNext=1; confirm opens the hold but remains unknown. Advance the
   fixture chain to serve_until+1 and clock.now to chain.ts. Reconcile returns reserved and
   serving:true. Expected historical reservation may be confirmed but serving is false; exact
   deadline semantics must cite the contract/runtime policy. Never infer execution readiness
   from key state alone. No provider currently runs; this is a bad admission signal to fix now.

## Corrections and related source-review checks

- Persist/fence a coherent evidence baseline from preparation, including block hash/timestamp
  and enough exact fields/digests for equal-block identity and monotonic key/hold/registration
  checks. Lower evidence, contradictory equal evidence and impossible regressions cannot free
  an allocation or grant readiness. A later valid block must have explicit recovery behavior;
  do not silently clear a sticky conflict without a defined rule.
- Preserve exact signatures/payload and one logical request. Do not solve stale evidence by
  trusting writer responses or inventing a fresh reservation. Bound retries and history.
- A status read must distinguish observed-at readiness from current readiness. Reserved rows
  are currently terminal to step(); a cached serving:true must not become a dispatch capability.
  Future dispatch revalidates fresh control, entitlement, exact hold and deadline independently.
- Review network/binding checks before submit: writer.network is only syntactically checked,
  while the request can name another network. Reject mismatched configured transport/signer
  binding without calling it. Revalidate relevant mappings after awaits; account/release/offer
  changes must not quietly authorize a different prepared request.
- meters() currently excludes the current owner despite its require_metering docstring. Either
  implement actual contract authority (owner or current-generation operator), or name/document
  an explicit narrower platform policy. Add a focused test; do not claim contract behavior
  differs from the actual c01 proof.
- The design still says every live prerequisite needs a new Tony approval. Correct that wording:
  code/interfaces/tests are already authorized; actual signing/deployment/spending/external
  commitments remain prohibited. No routine implementation approval is needed.

## Done when

Reproductions fail first then pass; first evidence, equal evidence, regression, exact deadline,
network mismatch and restart cases pass. Use contract fixtures with labelled synthetic history.
Run npm run check, web build, relevant keyless Rust checks only if changed. Update protocol,
report and JOBS with exact evidence. No signing/live wiring/provider calls. P0/M before003n.
All six milestones remain open. Claude makes local commits only, no push.
