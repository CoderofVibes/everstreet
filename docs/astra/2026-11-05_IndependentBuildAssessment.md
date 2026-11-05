# Independent build assessment and showcase direction

November 5, 2026. Astra, at Tony's direct request. Reviewed checkout `c4cebb9`
(handoff documentation after implementation `13b2c8c`). Initial working tree clean.
No production changes, deployments, real signing, spending, publication or milestone closure.

## Decision

Accept the core simulated business journey narrowly. It now connects creation, customer use,
sale, continuity and the successor's release in one configured process. That serves the vision.
Accept the surrounding features with the corrections below. Do not accept 006b as finished:
customer control and error handling in its page need another pass. Reject Fable's numerical
story as an implementation specification until its arithmetic, provenance and permissions are
corrected. Accept the three-layer concept and the proposed visual direction with these changes.

Tony requested, in order: "An independent assessment of today's build", "Shaping Fable's design
proposal", and "Confirming or correcting the order". This pass follows that order. It does not
resume the paused automatic goal or dispatch another builder.

## 1. Independent evidence and per-item verdicts

### Checks actually run

- `npm run check` in the sandbox: 1643 passed, 17 failed, 1 skipped. A focused repeat of
  composition and wallet-signin reproduced `connect EACCES 127.0.0.1` and cascading assertions.
  These were execution-environment failures, not evidence of a product sign-in regression.
- Full check repeated with approved loopback access: exit 0; **1660 main passed / 1 skipped,
  12 protected passed, 63 process passed**. No assertions or timeouts changed.
- `npm run web:build`: exit 0. Existing warnings include the large main bundle, browser
  externalization of util, and dependency eval. These are not a clean-warning claim.
- Added `server/test/astra-agent-boundaries.test.ts`: three distinct preparations concurrently
  through the real customer routes with a one-use grant; exactly one admitted. Passed. This
  covers that particular interleaving; it is not proof of all grant/expiry/revocation races.
- Final full check after adding that probe: recorded in the closing verification below.
- Read the actual restart, Gated and agent-sale tests and relevant service/UI code, rather than
  accepting the packet's counts as feature evidence. Read the brief, handoff, current execution
  note, proposal and dashboard mockup. No research, secrets or runtime files were opened.

| Item | Verdict | Evidence and limit |
|---|---|---|
| A: founder to customer to Direct sale, 100/20/80/79, successor update | Accept narrowly | Full process suite passed; configured child and durable records demonstrate the local journey. Chain, wallet and model are doubles; not NEAR/provider evidence. |
| A: writer-history procedure | Accept narrowly | Existing writer-history suites pass within the main check. Recovery remains status/identity based; this is not permission to resubmit an uncertain write. No independent operator-console walkthrough here. |
| B: Checks and recorded manual checks | Accept with corrections | At 1440, real browser shows build passed, 10/10 named evaluations, released-but-no-customer-use, and explicitly self-reported manual checks. Keep known 1280 density correction; no broad accuracy claim. |
| B: worker readiness stage 1 | Accept narrowly as repository preparation | Read the boot, memory and orphan evidence design; main check passed. Did not independently rerun the separate WSL setup harness or real host. Stage 2 and enabling the worker remain blocked on their own evidence/authorization. |
| C: connected source | Accept narrowly | Source/import suites pass; inspected design distinguishes pinned observed source from deployment claims and fences seller connections. Fixture only; no live GitHub acceptance. |
| D: economics and recovery | Accept with corrections | Per-asset integer arithmetic and unknown-cost handling inspected; economics and journey tests pass. Keep local-record obligation qualification. Readable amounts must precede showcase work; do not infer zero from absent history. |
| D: expert help | Accept narrowly | Tests pass; design uses self-reported profiles, explicit shared context, private request state and no delegated authority. This is introductions/work coordination, not verified expertise or a payment system. |
| D: portfolio | Accept with corrections | Server suite passes; actual 390px owned/considering/former page and note disclosure inspected. Move operating dashboard to Operate; strengthen actor-change response fencing before adding private history. Long populated-token rows still need a representative narrow fixture. |
| F: control sheet and portable record | Accept narrowly | Record tests pass; inspected verifier expressly limits itself to internal consistency/digests, not origin, current ownership or legal title. Preserve those distinctions in the showcase. |
| F: agent API and sale continuity | Accept with corrections; completion rejected | Actual configured agent-sale test passes, uses its own key and survives sale; seller denied, buyer switch denies new preparation before row count changes, human use continues. UI revocation/actor/error issues and assertion gaps below prevent full acceptance. |
| Hardening: K1-K5 and concurrent requests | Accept with corrections to claims | Actual child exits/restarts, reused durable storage, exact holds/charges and returned interrupted use are meaningful. K5 cuts the transport before the synthetic model records the call; this is not proof of an upstream provider accepting work then losing its reply. |
| Hardening: Gated journey | Accept narrowly | Test asserts one close order/close, one returned reservation, retained result, buyer service/update, and exact remaining units. No live-chain or real-worker claim. |
| G: polish | Accept with corrections | Desktop/phone and keyboard checks below. Product is not yet uniformly readable or fully accessibility-verified. |
| E: 006a, more engines, team/co-op, 006c | Reject any completion claim | Still future work. This assessment does not erase them or mark milestones complete. |

### Browser pass

Fresh `web:build`, finite `sale-harness.ts --minutes 60`, synthetic-only loopback ports 8814/8815.
The first sandboxed listener was unreachable; it was stopped and restarted with approved local
connectivity. The fixture includes a released invoice reader, fictional Ava and one offer.

- **1440 x 900:** agent page readable, labelled fields, no visible clipping. Studio Checks
  displays separate evidence categories and limits. Service/customer-access shows the real
  per-offer Agent use control. Base-unit pricing is still visibly exposed.
- **Keyboard:** synthetic sign-in activated with Enter; agent form traversed by Tab and submitted
  empty with Enter, returning focus to required Offer id. Checks and Service activated with
  Enter; Customer access with Space. Agent switch changed from off to on with Space and updated
  its accessible state, but focus fell to the document. A second Space did not toggle it back.
  Preserve focus through pending/readback; the disabled focused button currently loses it.
- **390 x 844:** portfolio short-name fixture fits; owned/considering/former and note disclosure
  are reachable. Agent fields stack and retain labels. This does not clear the known long-token
  portfolio overflow: this fixture has no charged money row.
- **Real Chrome 200% zoom:** verified the browser's 200% indicator and keyboard traversal to
  Offer id and Create access; fields stack without a clipped submit action. The sticky header
  consumes substantial vertical space. This is an agent-form check, not a claim that every
  page/chart was tested at zoom.
- **Reduced motion:** Chrome DevTools Rendering explicitly selected
  `prefers-reduced-motion: reduce`; the matching CSS rules appeared in Styles. The agent page
  rendered and its mobile Menu opened successfully under that emulation. This is a bounded
  page/navigation check, not coverage of every chart or animation. No screen-reader
  certification is claimed.

### Corrections, with confidence separated

**006b page controls (source-confirmed).** `AgentAccess.tsx` shows Revoke only for `active`.
The service deliberately lets a `used_up` token read its own existing results until expiry;
the customer therefore needs Revoke for that state too. Load errors currently become `[]`
and display "None."; revoke does not check HTTP success. The owner switch similarly hides
itself on read errors. Unknown permission state must be explicit, with safe retry and readback.

**Actor lifetime (source-confirmed missing fence; disclosure reproduction still required).**
`AgentAccess.tsx` keeps token/grants across `person` changes and does not cancel/sequence old
responses; `Portfolio.tsx` similarly retains private data while fetching the next person's
portfolio. Sign-out hides the content, but that is not a state reset. Require tests for a late
old response and sign-out/sign-in without unmount, including the one-time token. Do not claim
a demonstrated cross-account exploit from this source finding alone.

**Agent semantics.** Owner count called `active_grants` counts every unrevoked grant, including
expired/used-up ones. Count what the label says or rename it. MCP advertises idempotency keys
up to 80 characters while service validation accepts at most 60; use one definition. State
clearly what turning off does to prepared, reserved and running requests. Currently prior
preparations bypass the new-preparation switch check; confirm/execute do not check the switch.
Do not advertise "stops at once" as revocation of already admitted work.

**Test claims.** In `agent-access.test.ts`, the foreign-use refusal is conditional on successful
fixture preparation. Assert preparation succeeds before testing denial; otherwise the check
can be skipped. A garbage token is not an expired legitimate grant: add real expiry evidence.
Seller-switch tests accepting any status >=400 should assert the expected authorization refusal,
not accept a server error. K4's `close_sale <= 1` is a weak supplementary assertion: document
the Direct path's actual closing method and assert one committed sale transition. K5 proves
an interrupted transport attempt is not replayed; add upstream-accepted/lost-answer evidence
if claiming a provider received exactly one call. Keep the existing positive readback assertions.

Checked the primary MCP 2026-07-28 overview at
https://modelcontextprotocol.io/specification/2026-07-28 : stateless requests and per-request
negotiation are consistent with the chosen shape. This was not a full independent protocol
conformance audit; no general MCP-client compatibility claim is accepted from the internal
client alone.

## 2. Fable: three layers and ten decisions

The **base product** is the reusable platform for real founders, customers and buyers. Its
dashboard, releases and handover behavior cannot depend on a special demo identity.
The **showcase** is public teaching on the real site: labelled samples, read-only example
Operate/Acquire views and clearly separate example cards. It must not mutate commerce history.
The **demo account** exercises the base product with fictional people and history generated
through actual flows on a simulated chain. It supplies walkthrough evidence, not product logic.

| Question | Direction for Claude |
|---|---|
| 1. Stage priority | Keep Ledgerline's bounded sample in the launch homepage rail. Put genuine published products first in the clearly separate live catalog and search. Do not quietly turn Discover into only a demo. Revisit the rail after real catalog usage exists. |
| 2. Portfolio location | Operate owns My businesses/portfolio. Acquire retains Considering and acquisition receipts; both link to the same authorized records, without duplicating private notes or authority. Preserve deep links. |
| 3. Chart tokens | Add semantic `--data-refused` (slate, cross pattern) and `--data-agent` (violet, dot pattern). These are proposals until contrast-tested against paper and other series. Refusal is not error red; agent is not a success state. Pattern, legend and table carry meaning without color. |
| 4. Same-asset totals | No overview totals in this slice. Later only with identical network, token contract, decimals, period, completeness and definition; never by matching ticker. Units of different products are not interchangeable either. |
| 5. Customer burn-down | Aggregate by default. No per-customer chart in public examples or buyer rooms. Add an owner-only operational table only for an actual support need, with existing authorization; shortened account names do not make data anonymous. Never expose documents/results. |
| 6. Example appearance | Accept quiet paper, dashed boundary and explicit Example business/sample data eyebrow. Keep warm in the small label. Separate from the real catalog structurally, not by color alone. Use distinct pattern semantics for returned/refused/unknown so dashed does not ambiguously mean all of them. |
| 7. Illustrations | Use small presentational components for the three-step stories, explicitly Illustration, not a run. No fake loading, disabled pseudo-app or simulated success animation. Share typography/primitives, not execution controls. Replace only when engines work. |
| 8. Founder | Initials, no portrait. Marisol Teague is a suitable provisional fictional name; final name remains Tony's choice. No Tony/avatar/employer data. Persistent Demo founder/Simulated history identity, not only a dismissible welcome. |
| 9. Density | Default: attention, four figures, earned/compute/usage, current control and next action. Put secondary breakdowns in named disclosures (Usage detail, Customer obligations, Releases and checks), not one vague More charts. Tables stay reachable. Avoid hundreds of tab stops: one chart entry with documented arrow navigation or direct table access. |
| 10. Release names | Stable per-project sequence + short digest; evaluation result is a separate fact tied to that artifact. Optional founder title later, never a replacement for immutable identity. Do not invent v1.4 or imply 10/10 means universal accuracy. |

### Required proposal corrections before implementation

1. **Derive totals.** 350 purchased minus 212 charged is **138**, not 149. Returned holds are
   not additional purchases; never add them again after excluding them from charged uses.
   If all net paid units are 0.15 TUSD, those inputs imply 52.50 prepaid, 31.80 earned and
   20.70 unearned. These are arithmetic checks, not new target fixture numbers. The current
   day-by-day plan, 49 agent uses and headline totals must be reconciled by the real-flow seed.
2. The mismatch invoice says 200 + 60 in section 3 but 294 in the result example: use the actual
   fixture's values and tested output. No invented matching figures.
3. Do not change a whole dashboard from simulated to testnet because a chain adapter changes.
   Model/build/history/fees/observations each need their own provenance and timestamp. A testnet
   chain with a stand-in model remains mixed evidence. An unrelated v3 observation is not a
   reconciliation of aggregate customer balances.
4. Public example routes must read an explicit allowlisted demo projection, never an arbitrary
   owner's private control sheet. Tests must deny private notes, private listings, identities,
   source details and grants. Public demo write access needs isolated/resettable sessions and
   synthetic-only outbound adapters; no shared real credentials in a committed seed.
5. Homepage samples can run without server writes; "nothing recorded" must match analytics and
   request logging as well as business tables. Say what is meant, or keep the entire sample local.
6. Do not simply port a clock-advanced 30-day simulation to live testnet. Real timestamps, spend
   and authorization are separate. The synthetic scenario can inform a separately approved
   testnet rehearsal; it cannot fabricate 30 days of chain history or switch provenance labels.
7. Attention belongs to the current actor. A seller awaiting the buyer must not get "Accept
   terms" as their own next action. Do not show an expired customer agent grant as an owner
   task to renew; only its customer controls renewal. Resolve the story's completed/still-stuck
   Relaydesk item consistently.
8. Show known compute as a **known subtotal plus unknown calls**, not a complete total with a
   footnote. Show raw exact units in an optional detail alongside the readable amount.

The mockup's strongest ideas are one-business focus, a clear next-action rail, and ownership
beside customer obligations. Keep those. Reject its shared TUSD revenue/compute axis and any
decorative smoothing that suggests unobserved daily performance.

## 3. Remaining work order

Recommended correction to the agreed sequence, not a cancellation of approved scope:

1. Close this pass's agent permission/UI and evidence corrections. Fix readable token amounts
   and baseline narrow/keyboard issues now, before new screens reuse them. Recheck affected
   paths; preserve the worker/live gates.
2. Define the evidence/provenance and public-example projection, plus a small reproducible
   Ledgerline history through real flows. Then build the homepage sample and Follow it into
   Operate/Acquire. This removes the proposal's dependency cycle: step 2 cannot require the
   full three-business demo currently scheduled at step 7.
3. Trusted product-type framework, then Relaydesk end to end. Prove intake charging, fulfillment,
   retry and continuity before designing all its charts.
4. Signalwatch end to end, with bounded inputs and delivery/charge semantics. No arbitrary
   tools or outbound actions added by a changelog prompt.
5. 006a isolated web-app releases, rollback/retirement and free/time-pass behavior. Repository
   work can proceed, but real releases remain disabled until worker conformance passes.
6. Team/co-op ownership and then 006c as agreed. Define membership versus controlling authority
   before implementation. No implicit shared-key model or unapproved legal ownership claims.
7. Expand the early Ledgerline fixture to the full three-business demo and dashboard. Build
   daily projections before charts. History is derived, not hand-edited to hit the mockup.
8. Final integrated screen/accessibility passes, independent review and Tony's walkthrough.
   Repeat the core journey after each engine, not only at the end.

Seek Tony's external rehearsal/host decisions early enough to avoid a last-day gate, without
executing them. Prioritize a captured, reproducible core before decorative dashboard depth.
If time contracts, defer secondary charts and optional release labels first. Do not silently
cut an approved product family or team/co-op scope; bring that tradeoff to Tony. Day One remains
separate and keeps its stated priority.

## Handoff and files

Opened correction jobs (queued; not dispatched):
- `jobs/2026-11-05_006b1_agent-control-corrections.md`.
- `jobs/2026-11-05_review-evidence-and-presentation.md`.
- `jobs/2026-11-05_showcase-proposal-corrections.md`.

Changed: this pass; INDEX.md and JOBS.md rows; those three briefs; one independent concurrency
test. No application code changed. Claude reviews and commits. The historical review packet
and Fable proposal remain intact; this pass supplies the review disposition.

## Closing verification

Final `npm run check` with loopback access: exit 0, **1661 main passed / 1 skipped,
12 protected passed, 63 process passed** (1736 passes total). Existing non-fatal lint warning
unchanged. The test addition was formatted with Biome. Documentation-only edits followed;
no production code changed. Browser coverage is bounded exactly as recorded above; populated
long-token portfolio, every-page zoom, screen-reader behavior and external integrations remain
open. Reduced-motion observation completed in native Chrome; in-app viewport reset on cleanup.
