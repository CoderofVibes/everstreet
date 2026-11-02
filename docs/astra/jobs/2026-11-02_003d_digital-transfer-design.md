# M3d: design the enforceable digital-business transfer protocol

**Why (Tony's words):** "The seamless purchase and transfer of business/product to the
investor/acquirer, on NEAR ... has to stay central."

## What the person sees and does

A customer buys 100 uses of a named service under clear terms, successfully uses 20, and
keeps the same access and 80 remaining uses when the business is acquired. The buyer sees
what they are acquiring, the promises they must honor, treasury and compute commitments,
and any external dependencies still needing transfer. The seller loses administration;
ordinary customer use does not need a new account or a handover shutdown.

This is a protocol/design slice for Claude's NEAR ownership, before production code. It
must produce an implementable state machine and test plan, not another aspirational diagram.

## Inputs and constraints

Read 003a's characterization report, `docs/design/TRANSFER_PROTOCOL_OPTIONS.md`, the
adversarial review with its qualifications, 002c's managed runtime spec, and existing v2
code. Existing v1/v2 contracts, deployed accounts and historical evidence remain unchanged.
A new implementation belongs in a distinct version and would need a new account later.

Specify the following together:

1. **Purchased rights.** Product and immutable plan identity, units, unit price/refund basis,
   input and service limits, pricing asset, service/retention/refund policy. Monetary balance
   alone cannot represent 100 fixed-price uses. New-owner pricing affects new purchases only.
   Explain how compatible release upgrades serve old entitlements and how incompatible
   changes are prevented or routed to the supported older service. Do not promise an
   indefinitely available third-party model; preserve a funded remedy for inability to serve.
2. **Request authorization and reservation.** Define which customer action authorizes a use,
   who may reserve/settle/release it, maximum outstanding units and expiry. Confirm reservation
   before billable service, prevent withdrawal races, and bind each logical request to an
   exact fingerprint. Duplicate delivery, timeout, lost response, retry and late completion
   must not charge twice. A different payload with an old request id is a conflict. Delivery
   remains attested by the runtime, not cryptographically proven by a usage cap or hash.
3. **Money and storage.** Exact bucket invariants through every callback, customer refund,
   treasury withdrawal, buyer escrow and seller proceeds. A failed seller withdrawal after
   close must not become the buyer's money. Specify funded storage and admission bounds for
   customers, plans, holds and replay history; one fixed record per customer is not a bound
   on customer count. Replaying after history pruning must not cause a second charge.
4. **Terms and finalization.** Bind deal version/digest, expected owner/generation, sale price,
   minimum transferred available treasury, obligations/plan manifest and successor operating
   grants. Enforce the floor at close, including payouts already in flight. Revisions revoke
   acceptances and readiness. Define exactly which actions may occur after first acceptance
   and what makes an acceptance stale. Bound closing work; no unbounded historical scans.
5. **Managed administration freeze.** A durable, contract-enforced readiness protocol drains
   or fences old administrative work before close can succeed, including outside-UI calls.
   Bind readiness to business/deal/digest/generation/freeze epoch/expiry and the managed
   runtime identity. Customer requests use stable business infrastructure and a pinned
   service policy; they do not inherit the seller's privileges or personal provider keys.
   Define cancellation, expiry, restart, attestation revocation, replay and safe unfreeze.
   A stale RPC answer or wall clock alone cannot authorize seller administration again.
6. **Observed authority versus atomic authority.** Use 003b's idempotent monotonic app
   reconciliation. Specify which guarantee legacy/imported businesses can actually receive
   without the managed handshake. No claim that a chain read plus local write is atomic.
   Missing final state fails closed for administration; funded customer paths have their
   separately stated availability/recovery behavior. State who is trusted to operate hosting.
7. **Privacy and continuity inventory.** Keep documents, prompts, personal notes and outputs
   off public ledgers. Minimize commitments and account for guessable document hashes. Mark
   on-chain accounts/amounts as public. Separate necessary business records from private
   customer data and identify what a new owner may access. External domains, cloud accounts,
   repositories and IP require independent transfer status/evidence, never a universal claim.

## Deliverables and acceptance

Write a versioned design with concrete method/input/view types, storage records, authority
checks, state-transition tables, callback behavior, invariant equations, resource bounds and
failure recovery. Include a migration boundary and a dependency map to 002c/003b/003p/003f.
Give a complete 100/20/80 sequence and an adversarial test matrix with expected states, not
only test names. At least: duplicate logical use; altered replay; withdraw versus reserve;
timeout then late success; sale during pending customer use; seller payout failure after
close; wrong successor grant; treasury reduction; direct close without readiness; freeze
restart; cancelled/expired/revised deal; late observation; buyer resale; storage exhaustion.

Identify unresolved tradeoffs with a preferred design and cost, so Astra can review concrete
options. Check current primary NEAR documentation for any SDK/protocol assumptions, cite
sources and distinguish source inspection from tests. No account credentials are needed.
Propose bounded implementation jobs after design review. Do not begin their code in this job.

## Not in this job

No contract edits, signing, deployments, live API requests, testnet/mainnet transactions or
new purchases. No legal-entity/IP transfer or investment guarantee. No change to v2 evidence.

## Priority and size

P0 / L design. Start after 003a; design can run read-only against code while the single builder
works another slice, but use a distinct design file and do not alter shared status files.
