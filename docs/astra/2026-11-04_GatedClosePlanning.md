# Next acquisition slice: a managed handover that verifies continuity

Planning only, while003wf2 remains the sole active implementation job. Do not take or dispatch
this work until Astra accepts the Direct sale child and explicitly opens the next bounded job.
This preserves parent003wf's Gated requirement; it neither substitutes for Direct acceptance nor
adds permission to sign, deploy, access credentials or run external services.

## Product outcome

The buyer and seller approve the same exact terms. The acquisition page then explains that
Everstreet is checking the handover. It shows concrete progress and any unresolved operation,
without calling ownership transferred until the contract closes and local authority reconciles.
Customers keep their access, requests, results and remaining units. If a short admission pause
is needed for this business, show it plainly without charging for an unserved use. Other
businesses continue normally. A failed or expired handover has an honest recovery/abort path;
the buyer's returned escrow is an owed claim until its payout is proven.

## Grounded starting points

- Parent003wf explicitly requires a real closer/continuity integration, not just a synthetic
  closer or a swap of accepting/closed fixtures.
- BUSINESS_V3_SALE and current business-v3 source distinguish Direct from Gated at construction.
  Gated's second acceptance enters Closing. Only the configured closer can call close_sale.
- CloseOrder binds deal_seq, version, digest, expected_generation, closing_control_seq,
  manifest, manifest_seq and issued_at_ms. The contract verifies the accepted deal, generation,
  manifest and control sequence; issue time is no earlier than closing start or later than the
  block, and no more than1200000ms old. Close must execute before its deadline with funded
  escrow and the agreed available floor. After the deadline anyone may abort_close.
- Customer methods, current-generation metering, claims and callbacks remain allowed by the
  contract during a live deal. The contract does not prove off-chain drain or artifact readiness.
- V3Intents reconciliation already applies an observed exact close through the existing local
  authority transition. Its design explicitly leaves managed closing out. Preserve this path;
  do not write ownership directly from a closer task or a successful-looking wallet response.
-003wf1 supplies configured lifecycle, durable maintenance leases, response/body fences and
  bounded cleanup. Its application-wide stop is not a per-business handover implementation.
-003wf2 is adding actual wallet proposals/funding/acceptance and shared customer/sale synthetic
  economics. Its final APIs, corrected recovery rules and browser evidence must be reinspected
  before dispatching this next job.

## Required design before implementation

Inventory the exact work that can cross a business's ownership boundary: admitted customer
requests and provider calls, unit reservations/settlement, owner commands, queued builds,
evaluations, releases and pending local authority changes. Classify which work can safely finish,
which must stop, which needs reconciliation and what the buyer may resume. Do not introduce a
blanket global shutdown or assume a cancelled Promise stopped its external work.

Design a durable per-business handover state machine naming the exact closing identity and
the authority generation. Each readiness assertion needs production-service evidence and a
fence/lease that remains valid until the close decision; checking a count then admitting more
old-generation work is not a drain guarantee. The design must explain two app processes,
crash/restart, late callbacks and unavailable peers. Reuse proven lifecycle primitives where
appropriate, without equating their application-wide test evidence with this new business gate.

Make the order, journal and evidence bounded and immutable. Separate preparation, recorded
dispatch, unknown outcome, proven close, local reconciliation and customer service readiness.
An expired order, used nonce, missing reply or local timeout is not evidence that a previous
close failed. Recover its original transaction and the exact contract outcome before allowing
conflicting actions. Before issuing a replacement order, prove the older one cannot later cause
an inconsistent result; do not inherit the reversible-state assumptions flagged in003wf2.

Define the configured closer's restricted capability and supported signing/transport boundary
in Claude-owned code. Local verification uses ephemeral synthetic identities only. Real keys,
deployment, top-ups, paid providers and external execution remain outside this authorization.
Include an explicit disabled/unconfigured state, no background closer by accident, bounded
polling/work ownership and truthful health/readiness.

## Acceptance to carry into the bounded brief

1. Through normal APIs and actual encoded synthetic calls, propose/fund/accept a Gated deal,
   enter Closing, run the real handover coordinator, issue its exact order, verify its outcome
   and reconcile. No direct ownership SQL or fixture-state toggle.
2. Hold a real customer/provider/settlement operation at a deterministic barrier. Demonstrate
   the required drain/fence policy and preserved customer result/unit identity. Show the next
   use operating under the buyer's actual grants after the close. Do the equivalent checks
   for old-owner writes/releases and another unaffected business.
3. Kill/restart actual processes around gate acquisition, readiness, dispatch, lost reply and
   reconciliation. Concurrent coordinators must not produce conflicting authority or duplicate
   effects. Late callbacks cannot revive old-owner access or touch closed storage.
4. Exercise stale order identity, wrong closer, changed manifest/generation, clock/block limits,
   deadline expiry, abort and returned-escrow claims. Keep unknown versus refused/closed/aborted
   distinct; a failed callback or pending payout cannot be labelled paid.
5. Extend Rust-produced Gated fixtures and the coherent chain model, while separately testing
   the actual runtime coordinator. Fixture replay alone does not prove a drain. Local synthetic
   and any future authorized external evidence remain separately labelled.
6. Provide the finite normal-composition browser harness for both parties: visible handover
   progress, exact terms, failure recovery, customer continuity and correct post-close access,
   at1440/1280/390 with keyboard/zoom/reduced-motion checks. Preserve pending browser permissions.

Full parent100/20/80/79, owner plan/operator setup, unresolved-writer workflow, broader process
matrix and prepared-only external rehearsal remain separately required. All six milestones,
imports, expert help, portfolios, expanded products and approved handover/economics/agent
extensions remain. The next dispatch may split this integration into bounded implementation
and verification children, but must retain every requirement rather than call a contract-only
or simulated closer complete.

## Astra pass

Created this planning note and INDEX entry from the current parent brief, authority and v3
sale/reconciliation documents plus close_sale source. No new job dispatched, implementation
files changed, tests rerun, worker launched or external actions taken. The active003wf2 review
findings remain in DirectSaleRecoveryAddendum.
