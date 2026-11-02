# Product acceptance ledger

Astra owns this ledger. A passing command or a completed builder report does not by itself
accept a milestone. Record an evidence path, commit and observed result when closing a gate.
Updated November 2 after the first independent code and browser review. Evidence for M1 is
in `2026-11-02_FoundationReview.md`; no complete milestone is accepted yet.

## M1: product studio and visual system

| Gate | Observable result | Evidence/status |
|---|---|---|
| Identity | Home immediately communicates digital creation, discovery and acquisition | Observed in browser at `07d666e`; visual refinement continues |
| Start | A new founder can understand and start a digital project without terminal/prompt knowledge | Browser: idea -> fictional sign-in -> private studio works; not an AI-generated brief yet |
| Resume | Refresh/reopen restores the saved brief and correct project | Passed saved revision 2 and reload in browser; independent keyless persistence tests pass |
| Version | Saving a revision and inspecting/restoring an earlier one preserves history | Server behavior passes; browser shows stale details after restore: 001a open |
| Ownership | Another actor's direct API calls cannot read or change the project or revisions | Independent 64-test check includes current-owner and alternate-actor tests; local identity only |
| Honesty | Prototype, generated artifact, checked build and live release have distinct accurate states | Prototype/provider labels observed; brief-check and readiness copy correction in 001a |
| Design | 1440/1280px desktop, narrower layout, keyboard focus, readable contrast, no clipping | 1440 preview fits; 1280 Versions overflow: 001a. 390 preliminary pass only; full keyboard/contrast review pending |
| Continuity | Existing offers, bookings, books and acquisitions still function | Existing keyless tests pass; independent legacy browser/testnet regression remains pending |

## M2: building and operating a digital product

| Gate | Observable result | Evidence/status |
|---|---|---|
| Guided creation | Plain-language idea becomes a useful editable brief with assumptions identified | Pending |
| Functional output | The first generated product performs its promised document-to-data task | Pending |
| Iteration | Founder requests a change; a new version appears without altering the current release | Pending |
| Recovery | Restart, timeout and cancellation leave an accurate resumable/retryable state | Pending |
| Release | Only the tested selected version becomes active; an earlier version can be restored | Pending |
| Isolation | Generated artifacts cannot reach platform authority, another tenant or host secrets | Pending |
| Limits | Input, runtime, provider concurrency and monetary budgets are enforced, not just displayed | Pending |
| Evaluation | Deterministic tests and model-quality evaluations record inputs and failures separately | Pending |
| Provider | Real configured provider completes one bounded flow; a fake never masquerades as it | Pending |

A declarative product implemented by a trusted managed runtime can be a real working product.
An inert schema preview is a prototype. An arbitrary-code product additionally needs an
independently tested execution sandbox. Describe the supported capability precisely.

## M3: commerce, performance and transfer

| Gate | Observable result | Evidence/status |
|---|---|---|
| Entitlement | A prepaid 100-use purchase can consume 20 exactly once per completed request | Pending |
| Accounting | Earned revenue, prepaid liability, withdrawals, refunds and compute cost reconcile | Pending |
| Financial UI | Charts explain period, currency, sources and partial periods; missing is not zero | Pending |
| Evidence | Buyer sees only granted fields; revocation and expiry terminate access on every request | Pending |
| Terms | Both parties accept the same version; revision invalidates stale acceptance | Pending |
| Close | NEAR records control and settlement; application reconciles reliably after interruption | Pending |
| Customer | After close, the same customer access has 80 uses and the product still works | Pending |
| Seller | Former owner cannot deploy, administer, spend or direct old operating agents | Pending |
| Buyer | New owner sees the business and can perform a reviewed release and serve old customers | Pending |
| Scope | External assets/dependencies show actual transfer status; no universal/IP transfer claim | Pending |
| Chain evidence | Full digital journey verified on testnet, independently of keyless doubles | Pending |

## M4: bring an existing product

Connect authorized source and deployment metadata; identify framework, services, ownership
evidence and dependencies; show a correct preview/readiness report; import no credentials
into generated code; separate historical imported data from NEAR observations; allow the
founder to correct mappings; do not claim transferred hosting from a repository connection.
Status: pending, subdivide after the managed digital runtime exists.

## M5: a useful marketplace and operating network

- Clients post needs with budget/constraints and control contact; founders can respond.
- Discovery finds relevant digital products and explains matches; previews have real actions.
- Profiles connect releases, founder identity, selected performance, feedback and provenance.
- Revenue/profit/usage/customer trends and cost per task support decisions from actual records.
- Operator/agent assignments enforce scopes and budgets on the backend and can be revoked.
- Expert engagements have explicit deliverables, access and completion state.
- Acquirer portfolios show owned businesses and actionable operations after closing.
- Business integrations expose service dependencies, entitlements and observed costs.

Status: pending. Existing need board, profiles and acquisition modules are starting points,
not proof that the redesigned integrated experience meets these gates.

## M6: expanded capability and continuity

- Additional product families meet the same creation, operation and transfer gates.
- Team/cooperative authority corresponds to actual enforced control, not a labelled lead.
- A transfer rehearsal proves another operator can run the business without affecting users.
- Operational history, runbooks and necessary product knowledge survive sale; personal
  material and unrelated credentials remain private.

Status: pending. Maintain exact scope for any supported ownership model.

## Verification protocol

Use fictional fixtures and isolated test state. Never erase Tony's working demo. Test the
server boundary with actor changes, invalid input, duplicate calls and interrupted jobs.
Use the approved browser tools to inspect the actual implementation. Screenshots are internal
evidence until the requested full walkthrough. Record failures with reproduction steps and
return a bounded correction job. Run npm run check after edits and the relevant web build.

Production identity, hosting, isolation and provider integrations require their own evidence.
A complete local milestone is not authorization for a public launch. Notify Tony when a
meaningful milestone is verified or an external decision is necessary; don't require routine
design approvals. Keep the full roadmap open until its behavior, not only its pages, exists.
