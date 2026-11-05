# Managed handover: keep customer service intact through a Gated acquisition

**DISPATCH November5,00:43 Pacific. P0/L. First phase: design and test inventory only, then stop for Astra review.** Direct003wf2 is narrowly accepted for local/synthetic integration (DirectSaleAccepted); all parent003wf and milestone gates remain. Use exact Claude Opus5.5/high subscription. One implementation writer.

## Product outcome

Buyer and seller approve exact terms. Everstreet then shows the business-specific handover checks and any unresolved operation. Only an authoritative exact close plus local reconciliation establishes the buyer's management. Customers keep access, requests, results and units. Any short admission pause is clearly explained, without charging for an unserved use. Other businesses continue. Expiry/abort/refund recovery is honest; owed is not paid.

## Required starting reads

Read docs/ASTRA.md, PLATFORM_VISION, EVERSTREET_UI_DIRECTION, parent003wf, DirectSaleAccepted and docs/astra/2026-11-04_GatedClosePlanning.md. The latter's required-design section and six acceptance requirements are normative parts of this job, not optional inspiration. Reinspect current v3 contract, BUSINESS_V3_SALE, DIRECT_SALE, sale actions, V3Intents, configured composition/lifecycle, customer writer/runtime/settlement and actual studio build/evaluation/release services. Select relevant pinned NEAR skill references and record usage within existing permissions.

## Phase A: reviewable design, no implementation yet

Write docs/design/MANAGED_HANDOVER.md before code. Ground each proposed invariant in actual source/API/table behavior. Inventory every operation crossing ownership: admitted customer/provider work, reservations and settlement, owner writes, builds, evaluations, releases and local authority reconciliation. State whether it finishes, fences, cancels, reconciles or is resumed by buyer. A cancelled Promise is not proof external work stopped.

Specify a durable per-business state machine bound to exact sale identity and generation. Show admission, lease/fence ownership, multi-process behavior, crash/restart and late callbacks. Readiness cannot be a count checked before more old-generation work enters. Global app shutdown is not a business handover. Enumerate any work not yet instrumented and concrete integration changes needed; do not quietly omit it.

Specify immutable bounded CloseOrder/journal/evidence: deal_seq, version, digest, expected_generation, closing_control_seq, manifest, manifest_seq, issued_at_ms; contract time/age/deadline/floor/funding checks. Distinguish preparation, durable dispatch, unknown result, proven close, local reconciliation and customer readiness. Used nonce/timeout/expired order/missing answer never proves an old send failed. Explain original-transaction recovery and when replacement is safe. Reuse existing reconciliation; never directly assign ownership.

Define restricted configured closer signing/transport capability, disabled/unconfigured/readiness state, bounded coordination and supported authentication. Implementation must be Claude-owned; verification ephemeral and synthetic. No live keys/network calls enabled by default.

List exact deterministic tests and barriers through actual services/processes, including two coordinators and another unaffected business; map required UI states/actions to APIs. Identify migrations, compatibility and resource/cleanup budgets. Separate Rust contract behavior, coherent encoded-call synthetic model, configured runtime coordination and browser evidence. Contract fixtures alone do not establish drain.

Run required npm run check before reviewing/committing Astra docs. Locally commit reviewed docs and phase-A design. Mark JOBS taken then review, report design commit and unresolved engineering choices. Do not leave a preview/worker running. Stop for Astra review; no Phase B implementation until explicit continuation.

## Phase B retained implementation and acceptance (after design review)

1. Normal APIs and actual encoded calls propose/fund/accept Gated deal -> Closing -> real coordinator/order -> exact outcome -> existing local reconciliation. No fixture close toggle or ownership SQL shortcut.
2. Hold real customer/provider/settlement operations at deterministic barriers; prove drain/fence and original result/unit identity, then next use under buyer grants. Equivalent old-owner command/build/evaluation/release cases and an unaffected second business.
3. Actual process termination/restart at gate/readiness/dispatch/lost reply/reconciliation; competing coordinators; late callbacks and closed storage; no duplicate effects or revived seller authority.
4. Stale/wrong closer/order/manifest/generation/time/deadline/floor; abort/refund/claim evidence; unknown versus refused/closed/aborted and owed/restored/paid remain distinct.
5. Rust-produced Gated fixtures and strict coherent chain model plus runtime coordinator tests. Relevant Rust checks, npm run check and web build. Requirement matrix with local commits and limits.
6. Finite normal-composition browser harness for both parties, handover progress/failure/recovery/customer continuity,1440/1280/390 and keyboard. Zoom/reduced-motion where supported; explicitly report remaining gaps. Preserve pending enrollment/revocation permissions.

## Retained roadmap and boundaries

Parent003wf still requires complete100/20/80/79, owner plan/operator setup, unresolved writer workflow, wider nonce/migration/provider/process matrix and prepared-only external rehearsal. Keep all six milestones, worker verification, imports, expert help, portfolios, other product families/team ownership and approved003x/005e/006b/006c extensions. Customer-facing content should explain meaningful decisions without exposing internal coordination jargon.

No credentials, real wallet/provider/transaction, deployment/signing by Astra, paid API, spending, push/public release/submission/mainnet/Day One/research access or worker-host attempts. Research stays local-only ignored. Claude owns contracts/scripts/config and all local commits. Tests finite, keyless or ephemeral synthetic, explicit bounds and cleanup. Never silently substitute model/authentication or retry a usage limit in a loop.

## Phase B continuation — Astra, November5

Phase A at6ac6adb/4a5562b has been independently reviewed. Proceed with Phase B after updating MANAGED_HANDOVER.md for the decisions and mandatory D1–D7 corrections in2026-11-05_ManagedHandoverReviewNotes.md (section Phase-A review and engineering decisions). Those are part of this job's acceptance. They answer all nine engineering questions; no routine Tony approval is needed. Implement the local Closing/open_hold contract guard with compatibility evidence now; no deployment or real account creation. Preserve the complete original C/M/S/P/B matrix and all parent/milestone requirements.

Commit coherent implementation checkpoints and report partial progress honestly. Stop for Astra's final code/behavior/browser review once the full child is implemented and required checks pass; never mark whole-job done from only the gate or contract. If a concrete source contradiction prevents an approved invariant, record it precisely and stop that dependent part while continuing independent authorized work. All prior limits remain.
