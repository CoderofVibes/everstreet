# Design the durable customer-use bridge and produce contract readback fixtures

**Why (Tony):** a builder's product should serve customers continuously when the business is
acquired. The flagship customer keeps80 of100 purchased uses after20 uses and a sale.

This follows003k1. Deliver a concrete implementation design and keyless contract-produced
readback fixtures for the next managed-runtime job. Do not attempt a live integration or conceal
an unresolved authorization/signing dependency behind a test double.

## Source and deliverables

Read BUSINESS_V3_CORE/SALE, V3_RECONCILIATION, actual contract open_hold/settle_hold/release_hold,
get_plan/get_entitlement/check_use and current server runtime invocation/admission/release code.
The existing synchronous Admission hook does not establish a safe remote transaction workflow.

Write docs/design/CUSTOMER_USE_RUNTIME.md with concrete tables/types, transition rules and an
API sequence, then a bounded implementation proposal for the next job. It must specify:

1. Trusted mapping of person/customer chain account, business contract, immutable plan and
   supported product release; clear owner-trial vs customer-use authorization. No caller-chosen
   entitlement owner or product mapping. New owner administration never inherits customer keys.
2. Durable request identity and exact fingerprints bound to customer/registration/hold/slot/
   plan/product/release/input. Do not publish raw document text or guessable personal-data hashes
   unnecessarily. Stored output ownership/access, retention and disclosure to a successor must
   be explicit and consistent with the product's actual promise.
3. Separate asynchronous transitions: request accepted, reserve requested/confirmed/unknown,
   dispatch started, result recorded, settlement requested/confirmed/unknown, release/refund
   remedies. All intent is persisted before side effects. No billable dispatch before verified
   reservation; no remote await inside SQLite transactions; one logical request never charges
   or dispatches twice after a lost reply/restart. State exactly when replay cannot be proven.
4. Real customer consent and HoldAuth/UseAuth signing requirements. Specify supported credential
   ownership and handoff boundary, revocation/key epoch, expiry/hold sequence/closed-root checks.
   Fixtures cannot stand in for a wallet signature or claim production authentication exists.
5. Provider cost accounting versus customer-unit settlement, exact costs versus unknown usage,
   cancellation/timeouts and late output. A failed/unknown model response is not successful use.
   Separate deterministic extraction validity from model quality. No free retry caused by
   losing a settlement reply; no automatic charge solely because provider tokens were used.
6. Sale while a use is pending: which generation's operator may settle, authority replacement,
   service grant/readiness needs, deadline and drain/freeze behavior. Customer result retrieval
   remains tied to customer authorization while old owner trials/private replies are fenced.
   If uninterrupted execution cannot be guaranteed by current methods, say exactly where and
   propose a bounded remedy. No vague promise of zero interruption.
7. Restart/reconciliation workers with bounded work, locks/leases and idempotency. Unknown chain
   state must remain explicit. Stale or conflicting reads cannot release credit or grant access.

Produce compact JSON fixtures from actual contract unit methods for plan/entitlement/check_use
readback: funded100, consumed20, active hold, charged replay, altered fingerprint, closed hold,
expired/released hold and entitlement after actual sale. Reuse existing cases where possible;
do not duplicate an entire test suite. Label any synthetic mutations. Include expected-state
table for interruption/retry/ownership cases and identify which missing live prerequisites
remain. Run relevant keyless contract tests/clippy if fixtures change and app checks as needed.

## Boundaries

No production customer-admission code until Astra reviews the protocol. No real customer keys,
credentials, signing/deployments/transactions, live endpoints, provider calls, billing/package
changes, main wiring or runtime DB reads. Contract test/fixture additions only; no silent
contract behavior changes. Local commits/report and stop for Astra review. Priority P0/M-L.
All six milestones remain in scope; this is the next M2/M3 bridge, not a completed milestone.
