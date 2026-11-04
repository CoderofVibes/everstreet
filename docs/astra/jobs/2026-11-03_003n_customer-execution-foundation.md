# Execute a reserved customer request and keep its result private

**Why (Tony's words):** Everstreet should let someone "build with AI inside Everstreet" and
showcase a working product. Its customers must keep their service across a NEAR acquisition.

## What the person sees and does

A customer with an exact confirmed one-unit reservation requests execution of the released
document-to-data product. They can retrieve the same result after a lost reply or owner change.
Failed or uncertain execution is explicit; no automatic duplicate model run. The customer unit
is still awaiting settlement in this slice, which is clearly distinguished from provider cost.

## Underneath

Follow corrected003m1. First write the concrete execution transitions/data/privacy boundary in
CUSTOMER_USE_RUNTIME, then implement this bounded backend slice. Read existing invocations.ts,
runtime.ts, extract.ts and release/budget/financial routes before changing them. Reuse the
existing validated extraction/provider/pricing machinery where possible; do not relax ownerOnly
or answerFor to expose business trial outputs to customers. No full contract settlement yet.

1. A durable one-to-one request/invocation identity, separate purpose customer_use, exact offer/
   release/artifact and input digest. No caller-supplied owner identity or artifact swap. New
   owner can operate the product but cannot retrieve customers' documents or private results.
2. Explicit execute/status/result API for the requesting customer. Input must match prepared
   digest/length. Supporting resubmitted input is acceptable; never silently execute with missing
   protected input. Review current protection seam: a failure after row insertion followed by an
   idempotent retry currently skips protection. Make retry/resupply semantics durable and clear,
   avoiding orphaned references, double protection or silently lost accepted work.
3. Immediately before admission, obtain coherent fresh pinned control/plan/entitlement evidence,
   exact request hold, unused slot, correct key/epoch and serving deadline. Current operator
   authority and at least the maximum execution duration plus margin must remain. Refuse stale,
   conflicting, revoked, already-used, wrong-binding or insufficient-deadline evidence. A read
   can be overtaken by a sale/revocation: state the residual bound, no atomic guarantee.
4. In one local transaction reserve bounded provider cost/concurrency under the business's
   existing runtime budget and operator ceiling and persist dispatch intent. No network await
   in SQLite. At most one automatic provider call per logical customer request. A crash between
   intent and send is outcome_unknown, not proven sent. Lease-generation/CAS protects late
   responses and accounting; no retry spending caused by lost replies or restart.
5. Store deterministic success/refusal/failure/unknown independently from exact/partial/unknown
   provider usage. Successful validation is not model-quality proof. Provider costs use the
   established ledger, with no duplication and no release of uncertain spend. Customer units
   remain reserved/pending settlement; do not increment consumed/refund or fabricate a chain
   charge. Reserved allocations remain until a subsequent settlement/release job proves closure.
6. Protected customer result storage through an explicit injected protect/load/delete seam;
   production is unavailable without configured protection, never plaintext fallback. Persist
   retention deadlines and support bounded deletion/retrieval expiration with synthetic fixtures.
   No raw input/output in owner-facing invocation, finance, events, errors, exports or listings.
   Aggregated cost/usage can remain business operational history. Audit every existing detail
   route if sharing runtime tables. Owner trials keep their existing retention semantics.
7. Customer reads remain authorized to that person across sale; old owner private trials remain
   fenced. Check caller access after awaited work. Business budget/authority changes during an
   await cannot cause an unfenced new dispatch. Delivered customer results do not disappear
   solely because the owner generation changed. Late responses after cancellation/revocation
   get an explicit policy that never turns invalid/unknown work into a chargeable result.
8. Injected bounded worker/step only; no automatic main wiring, external provider/chain calls,
   secret reads, or production signing. Missing adapters report unavailable without dispatch.

## Done when

Real app tests and file-backed restart cover reservation -> one provider call -> validated
private result; changed input/digest/release; no provider/protection; wrong customer and both
owners; budget/concurrency; lost replies; competing workers; stale lease; crash before/after
dispatch; partial/unknown usage; cancellation/timeouts/late output; expired/revoked/stale/conflict
holds; sale during admission and execution; retention expiration; existing trial regressions.
Use actual contract view fixtures plus labelled synthetic transitions and an injected scripted
extractor. Prove call counts and ledger sums, not just response statuses. Finite ceilings on
all fixtures. Report exact tests/commits and remaining settlement/UI/live prerequisites.

Run npm run check and web build, then stop for Astra review. If refactoring requires a broader
authority change or the reservation invariants remain unresolved, stop with concrete findings
rather than weakening the boundary. P0/L after003m1.

## Not in this job

Customer wallet UI, real provider/model calls, chain settlement/release transactions, automatic
worker startup, deployment, billing changes, spending, public release, research assessment or
Day One access. No fullM2/M3 completion claim; all six milestones remain in the roadmap.
