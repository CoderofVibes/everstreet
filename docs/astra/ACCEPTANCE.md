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
| Version | Saving a revision and inspecting/restoring an earlier one preserves history | Browser restore sequence passed at `45fc476`; selected/detail both show revision 3. Six new race-state tests reported by Claude |
| Ownership | Another actor's direct API calls cannot read or change the project or revisions | Independent 64-test check includes current-owner and alternate-actor tests; local identity only |
| Honesty | Prototype, generated artifact, checked build and live release have distinct accurate states | Prototype/provider labels and corrected brief-only checks observed at `45fc476`; future M2 states need their own evidence |
| Design | 1440/1280px desktop, narrower layout, keyboard focus, readable contrast, no clipping | 001a browser: 1280 overflow resolved; 1440 and 390 fit; arrow-key tabs and visible focus pass. Full accessibility/legacy review pending |
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

002a at `c0e93ef`/`108bdb3`: Claude reports 89 passing tests. Astra independently reproduced
failures in usage completeness, over-limit success, provider identity and lease expiry.
See 002a1; durable job acceptance requires these corrections plus browser review.
All reproduction providers were explicit keyless test doubles.

002a1 at `03e29cb`: Astra independently reran all four reproductions successfully. Partial
usage/cancellation retains the reservation, excess usage fails and records cost, changed
provider identity is refused before dispatch, and an expired undispatched claim makes no
provider call. Full independent check after 003a: lint/types and 112 tests passed at 11:08
Pacific. Internal browser fixtures show failed/cancelled/successful history and honest partial
usage detail. Remaining UI issues (completed event pagination and rounded-budget cost labels)
are explicit 002b acceptance items. The corrected durable foundation may support 002b; this
does not accept live-provider, runtime, release or full M2 gates.

002b at `e491dcc` / `a6340f4` / `233d2bf`: Astra independently ran lint/types/158 tests and
web build successfully. Three provider-adapter probes pass after correction (thinking block,
actual usage over price band, free token-preflight refusal). These use injected transports,
not live Anthropic. Browser with an explicitly scripted provider confirms budget setup,
conversation → proposal → revision 2, exact computed cost versus rounded budget amount,
unsaved-edit protection, stale-base refusal after a manual save, and alternate-actor denial.

002b1 `18494d9`: delayed-send browser test now preserves typed-ahead text; founder message
styles are readable; narrow controls are reachable and 1280/390 document widths fit. Further
browser finding: Assistant → Brief → Assistant loses unsent composer/outbox state; see
`reports/2026-11-02_002b-panel-review.md`. Long-history truncation was independently reproduced
and corrected by Claude at `ff78c63`; Astra repeated 101 exchanges, recovered all 202 unique
messages across five pages and the tail shows the newest reply; 24 targeted tests pass. These are
partial guided-creation/iteration/limit evidence, not acceptance of a real generated product.

002b2 at0573248: Astra's delayed-response browser repeat preserves composer across Brief and
Screens, preserves typed-ahead text while hidden and produces one exchange. Actor switch denies
the project and resets unsent state. See reports/2026-11-02_002b2-browser-review.md for scope.

002c through8efd51e: independent check passes280 tests and web build. Unconnected Service is
honest; scripted results/metadata render. Three reproduced issues block keyless acceptance:
late former-owner response, empty-only release checks, and pending request lost on tab change.
See002c1 and reports/2026-11-02_002c-independent-review.md. Live provider gate remains pending.

002c1 server corrections at3732fef independently pass the four prior API probes: late owner
denied, required checks block trivial-only release, same-key retry survives release change,
overlong value is not fulfilled. Browser confirms panel continuity and same-text recovery without
extra charge, but typed-ahead text hides recovery (002c2). FullM2/live gate remains pending.

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

003a characterization at `c825bf9` establishes current gaps, not M3 acceptance. Claude reports
27 Rust unit tests passed; Astra independently reran the complete 112-test TypeScript check.
The report records unauthorized credit-use semantics, duplicate charge memos, treasury drift,
withdrawal races, failed seller payouts after close, duplicate local settlement, lost-response
recovery and offchain authority races. Stronger digital guarantees require follow-up slices.

003f at2b6dd69/197a749: independent319-test check/web build pass. Desktop/mobile charts, keyboard
details and source table inspected with fictional fixtures. Five independent server corrections
plus mobile overflow and provenance/precision issues are in003f1. FinancialUI not accepted yet.
003e authorizes only an undeployed entitlement/storage/payout contract core with keyless tests;
test-only owner changes do not prove a NEAR acquisition or runtime continuity.

November2,15:07:002c2 changed-draft/changed-target recovery browser repeat passes; ten-request
capacity still drops unresolved work (002c3).003f1's five original server probes pass independently;
390 expanded table now stays within375px document,1280/1440 also contained. Observed-zero source
badge remains003f2. See002c2-003f1-independent-repeat.003e has26 reported v3/27 v2 keyless tests,
but source review requires003e1 before integration; weak-key hypothesis is unconfirmed pending
pinned VM reproduction. All broader M2/M3 integration and live gates remain open.

## M4: bring an existing product

Connect authorized source and deployment metadata; identify framework, services, ownership
evidence and dependencies; show a correct preview/readiness report; import no credentials
into generated code; separate historical imported data from NEAR observations; allow the
founder to correct mappings; do not claim transferred hosting from a repository connection.
Status: pending.004a begins genuine supplied-manifest inspection and persistent import/readiness
records. External source/deployment connections and execution remain later gates, not completed
by a manually supplied manifest or founder assertion.

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


