# Owner plan setup: price, service permissions, customer offer (job 003wf4, Phase A design)

Claude (claude-opus-5-5, high), November 5, 2026. **Design and test inventory only; nothing here is
implemented.** Normative requirements: `docs/astra/jobs/2026-11-05_003wf4_owner-plan-setup.md` and
`docs/astra/2026-11-05_OwnerPlanPlanning.md` (including its 04:00 source refinement and 04:27
interaction brief). This design keeps every one of their requirements and leaves the parent 003wf
scope intact (the fresh 100/20/80/79 journey, successor update, writer history, the wider
process/migration matrix, all six milestones and the approved extensions).

Not in scope: deployment, a new account, real wallet signing, a provider, keys, spending, worker
hosts, Day One, research. The contract work below is Claude-owned source in `contracts/business-v3`.
As before, a contract change ships only as a new business account after a separate authorization
(AGENTS.md).

## 1. What exists today (source facts)

| Fact | Where |
|---|---|
| `create_plan(input) -> u32`. It is owner-only and refused while a deal is live (`require_no_deal`). At most 32 plans (`E_LIMIT`). Its argument rules: price > 0; at least 1 unit per purchase; the outstanding cap at least the purchase cap; hold units 1..`rules.max_hold_units`; `hold_ttl_ms` in `MIN_SERVE_MS` (60 000)..`rules.max_hold_ttl_ms`; `settle_grace_ms` ≤ `rules.max_settle_grace_ms`. It inserts the plan with `created_generation = generation`, charges the **measured** storage growth (`charge_growth(before, 0)`: `E_STORAGE` unless the attachment covers it; the excess is refunded to the caller), advances `control_seq`, and emits `plan_created {plan_id, unit_price}` only. | `contracts/business-v3/src/lib.rs:1255-1293`, `3037-3051` |
| There is no guarded variant (no reviewed-control argument), no plan-storage quote, and no "next plan id" view. | same |
| `appoint_operator[_guarded](account, caps, [expected_control_seq])`. The guarded form refuses `E_REVIEWED` if `control_seq` moved. It takes the account's existing slot (in any generation) or the first empty one, and **replaces** its mask with `caps` and the current generation; it doesn't union them. `METERING = 1`, `SUPPORT = 2`. It needs at least 1 yoctoNEAR (the excess is refunded) and no live deal. | `lib.rs:1299-1328`, `71-72` |
| Versioned capability views exist for other paths, the pattern to follow: `get_purchase_terms` (measured `shell_bytes` × `storage_byte_cost`), `get_sale_terms` (guarded, `next_deal_seq`, `plan_count`), `get_key_terms`, `get_handover_terms`. `get_rules` returns the rules with `min_hold_ttl_ms`. | `lib.rs:2223-2256`, `2431` |
| The server's appoint action (`SaleActions`, kind `appoint`) always submits `caps = METERING`. That would silently drop an existing SUPPORT on the same slot. Its review and confirmation say customers "can be served" because metering is appointed. | `server/src/saleActions.ts:1480-1508`, `529-538` |
| The durable wallet protocol (SaleActions): prepare (one pinned read, the exact call and its digest); a create row stored in BEGIN IMMEDIATE under one exclusivity identity; requested (durable BEFORE the wallet is asked); the hash after it; check (by its own transaction: FINAL success/failure, else whether it can still take effect). There is no second creation while an asked row is open. | `saleActions.ts` (header comment, `exclusivity`, `CHECKABLE`, `check`) |
| Offer inspection (`readTerms`) checks binding, release, owner epoch, freshness and that the plan exists. It does **not** check whether the plan's timing is usable by this server. | `server/src/customerUse.ts:606-640` |
| Customer timing. `prepare` takes `window = min(serveWindowMs, plan.hold_ttl_ms)`, `acceptBy = T + window − MIN_SERVE_MS` and `signBy = now + (window − MIN_SERVE_MS) − submitMarginMs`, and refuses `window_too_short` if `signBy ≤ now`. `execute` requires `serve_until − block ≥ runtime.timeoutMs + executionMarginMs`. Defaults: `serveWindowMs` 600 000, `submitMarginMs` 120 000, `executionMarginMs` 60 000, `deliveryTimeoutMs` 300 000, runtime `timeoutMs` = `RUNTIME_LIMITS.maxSeconds` (60) × 1000. The constructor checks only `serveWindowMs ≥ MIN_SERVE_MS + submitMarginMs + 60 000`. | `customerUse.ts:395-419`, `1591-1600`, `2528-2530`; `server/src/runtime.ts:18-24` |
| The web Service workspace asks for a "Contract plan number" and assumes the plan already exists. | `web/src/pages/CustomerOffers.tsx:353` |

## 2. The journey (what the founder sees)

In Studio's Service workspace, **Set up customer access** names the selected tested release, then
offers three steps in order, each with its evidence and one next action:

1. **Pricing plan.** Either a guided new plan, or **Use an existing plan** (the existing inspector,
   unchanged, for plans created elsewhere).
2. **Service permissions.** What the platform's metering account can do now, and exactly what would
   change.
3. **Customer offer.** The existing independent release, plan and retention review, plus the live
   readiness reading.

Each step's state comes from durable rows and fresh contract reads (§8). "Next" is the first step
not yet satisfied. A satisfied step shows its evidence, never just a tick.

## 3. Guarded immutable plan creation and a measured quote (contract)

New methods on `business-v3` (source only; no deployment):

- **`get_plan_terms() -> PlanTermsView`**:
  - `version: 1`, `guarded: true`;
  - `next_plan_id: plan_count + 1`, `plan_count`, `max_plans: 32`;
  - `plan_bytes`: the exact storage growth of one plan insert, a constant **measured in a Rust
    test**, as `SHELL_BASE_BYTES` was;
  - `storage_byte_cost`, `control_seq`, `generation`, `live_deal: bool`;
  - `rules: RulesView`.

  Its absence (older code) means guided creation is unavailable with the remedy "this business's
  contract predates guided plans". Existing plans stay inspectable.
- **`create_plan_guarded(input, expected_control_seq, expected_plan_id) -> u32`**: exactly
  `create_plan`, plus `require_reviewed(expected_control_seq)` (`E_REVIEWED`) and
  `plan_count + 1 == expected_plan_id` (`E_REVIEWED_PLAN`), both checked before any write.
  - It binds the reviewed state: `control_seq` advances on every owner change (plans, operators,
    sales, closes), so a different owner or generation, another plan created meanwhile, an
    operator change or a live deal (`E_DEAL_PENDING`, checked first) each refuse it with no state
    change. The returned id equals `expected_plan_id`.
  - Unguarded `create_plan` stays, for compatibility.
- **Quote:** `deposit = plan_bytes × storage_byte_cost`, attached exactly. The contract charges the
  measured growth and refunds any excess to the caller. A stale quote (the byte cost rose, or code
  changed) refuses `E_STORAGE` atomically: nothing is created, the deposit comes back with the
  failed receipt, and the founder re-reviews. The review states: "Attached N yoctoNEAR for B bytes
  of contract storage; any excess is refunded; the plan is permanent and its storage isn't
  released."
- **Rust tests:**
  - the measured `plan_bytes` equals the actual growth for the largest field values;
  - a guarded create after a control change, a concurrent plan, during a live deal, at the 32-plan
    cap, under-attached, with each argument rule at its boundary;
  - the returned id, `created_generation`, the full readback and the event;
  - `get_plan_terms` before and after.

## 4. The wallet request: durable, exact, recoverable

A new SaleActions-family kind, **`create_plan`**, uses the same table, exclusivity and recovery
rules as the existing `appoint`. Its exclusivity identity is `control:<seq>`, the same as other
owner control actions. Recommendation: extend SaleActions rather than build a parallel protocol;
the alternative is a separate `owner_setup_actions` table with the same code.

- **Prepare.** One pinned final read: `get_plan_terms`, `get_control`, the owner's account and the
  token metadata. It builds the exact call
  (`create_plan_guarded(input, control_seq, next_plan_id)`, deposit = the quote) and the review:
  - money in canonical base-unit strings, plus readable amounts from verified token decimals;
  - limits, timing (§5) and the attached NEAR;
  - refund semantics and immutability;
  - network and contract, and the owner generation.

  Nothing is stored.
- **Create** (BEGIN IMMEDIATE). A fresh read must reproduce the same digest. One row is stored per
  exclusivity identity:
  - an open *prepared* row is returned for recovery;
  - an *asked* row admits nothing new except its exact replacement (`replaces`).

  Two tabs or processes contending for the same `control:<seq>` get the same row, or a refusal.
  Never two asks.
- **Requested.** Durable before the wallet is invoked, then the hash afterwards. The draft (the
  form's values) is kept separately, in the browser controller (`drafts`, as SaleFlow does): a
  typed-ahead edit never changes the asked request.
- **Check**, by its OWN transaction only (receiver, signer, method and args must match):
  - **FINAL success:** the receipt's return value is the plan id, which must equal the reviewed
    `next_plan_id`. Then a fresh read of `get_plan(id)` must equal the reviewed input field by
    field, with `created_generation` equal to the reviewed generation. Only then is it
    `confirmed` with that plan. A matching price, the `plan_created` event alone, or a lookalike
    plan never confirms.
  - **FINAL failure:** refused with the contract's code (`E_REVIEWED`, `E_REVIEWED_PLAN`,
    `E_STORAGE`, `E_LIMIT`, `E_DEAL_PENDING`, `E_ARGS…`).
  - **No receipt:** if `control_seq` has moved past the reviewed one, it is "no longer possible
    from now on; whether it landed is shown only by its own transaction" (existing wording). It
    is never "failed", and a duplicate is never offered as recovery.
- **Wrong transaction ID:** a named hash that isn't this request's call gives
  `transaction.matched = false` and the row stays as it was (existing `resolveSaleTx`).
- **Reload, account change, process restart:** the row is durable. The page reads it back by
  business and viewer. The check is repeatable and idempotent; the first terminal answer wins.
- **Away and back:** the row binds the person, account and owner generation. After the business
  changes hands its evidence is shown only to that participant. A new action needs a fresh review
  under the new owner; an old request can't land (`E_REVIEWED`).
- **Gate:** while the business is changing hands (003wf3), prepare and create are refused
  `handover_in_progress`. A check of an earlier request is allowed (allowed participant recovery,
  as today).

## 5. Timing that this server can actually serve (one policy, used everywhere)

Astra's review (`2026-11-05_OwnerPlanReviewNotes.md`) reproduced two failures through the real
routes:
- a contract-valid short plan is accepted as an offer but can't be signed;
- **even the default 30-minute plan** lets a customer sign at the permitted latest moment (420 s
  into the 600 s window) and the submission use its 120 s margin, which leaves 60 s when
  execution needs 120 s. The unit is reserved but can't run.

So usable timing must hold at the **latest permitted signature**, not only for an immediate
confirm.

**One policy function, `servePolicy(config, plan)`**, used by guided creation, existing-plan
inspection, offer creation, customer prepare and the readiness reading. It is evaluated at each
read against the current configuration, so a configuration change re-evaluates every offer and a
cached review can't keep an old offer usable.
- `window = min(serveWindowMs, plan.hold_ttl_ms)`.
- `reserve = max(MIN_SERVE_MS, runtime.timeoutMs + executionMarginMs)`: the serve time that must
  remain when the hold is accepted.
- `signWithin = window − reserve − submitMarginMs`: how long after prepare the customer may
  sign.
- **Usable** iff `signWithin ≥ minSignMs` (60 000: the server's existing "a minute to sign" rule).
  Defaults: 600 000 − 120 000 − 120 000 = **360 000 ms** to sign. The **minimum usable hold is
  300 000 ms**.
- **Settlement:** usable iff `settle_grace_ms ≥ deliveryTimeoutMs + submitMarginMs` (420 000 ms
  with defaults), within `rules.max_settle_grace_ms`.

**Changes this requires (Phase B):**
- **Prepare** sets `sign_by = now + signWithin` and `accept_by = serve_until − reserve`. Today
  these reserve only `MIN_SERVE_MS`: this is the fix for the late-authorization path.
  - A signature at the latest moment, submitted within its margin, is accepted with at least
    `reserve` left, so execution passes its existing `timeLeft` check unchanged.
  - The existing execution refusal (`not_enough_time`) and every margin stay as they are; none is
    weakened.
- **A submission slower than its margin** makes the hold accepted after `accept_by`. Prepare
  doesn't hide this: execution still refuses `not_enough_time`, and the reserved unit follows
  the established recovery (the customer's "Don't run it: return my unit", or settlement after
  the deadline). The customer page says the hold came too late to run, with nothing charged.
- **Inspection** of a plan the policy rejects shows its contents with "not usable by this server:
  customers need at least N s to sign and M s to run; this plan's hold is K s; create a new plan".
  **Offer creation refuses** it (`plan_unusable`). An existing offer whose plan stops being usable
  after a configuration change shows *unavailable (plan_unusable)* in readiness and is never
  presented as ready. Customer prepare refuses it before anything is signed.
- **Guided creation** suggests `hold = min(serveWindowMs, rules.max_hold_ttl_ms)` (600 000) and
  `grace = max(420 000, …)`, both within the rules. Advanced edits are validated by the same
  policy. If the rules can't fit the configured margins, guided creation is unavailable and names
  the conflicting margin and rule.

**Tests (durable regressions for each reproduced case):**
- Defaults, against Astra's table:
  - 60 000, 180 000 and 180 001: offer refused `plan_unusable` (no customer row);
  - 299 999: unusable; 300 000: usable;
  - 600 000 and the 1 800 000 default: usable.
- **The late-but-permitted path:** confirm 1 ms before `sign_by`; the submission held at the
  writer barrier for `submitMarginMs − 1`; the execute then succeeds (fulfilled, charged once).
  Too late: the submission past its margin refuses `not_enough_time`, with no provider call, no
  charge, no extra hold, and the unit recoverable through the existing path.
- **A non-default supported configuration**, its own boundaries: submit 30 000, serve 240 000,
  runtime timeout 60 000; and runtime timeout 300 000 with submit 120 000.
- **A configuration change:** an offer usable under one configuration is shown unavailable after a
  restart with longer margins, and its plan stays inspectable.
- Every refusal asserts: no provider invocation, no charge, no additional hold, no duplicate
  creation. Existing tests are reused where they already prove the exact claim.

## 6. Service permissions: an explicit replacement mask

The appoint kind's review carries the **current slot** and the **resulting mask**:

| Current slot for the platform account | Offered result | Wording |
|---|---|---|
| none | METERING | "Adds metering." |
| METERING, older generation | METERING, this generation | "Renews metering for this owner." |
| SUPPORT only, this generation | **METERING\|SUPPORT** (default) or METERING (explicit choice) | "Adds metering and keeps support." Or: "Replaces support with metering: support is removed." |
| METERING\|SUPPORT or METERING, this generation | nothing to do | "Already appointed." |

- The call carries the exact resulting `caps` and `expected_control_seq`. The review digest binds
  the old mask, new mask and generation.
- A stale read (control moved) refuses `E_REVIEWED`; the founder re-reviews.
- **Confirmation:** "Metering is appointed for this owner." Service readiness is shown separately:
  the runtime, release, budget, protection and worker capabilities (the existing D4
  `serviceReadiness`). This replaces the current "customers' new uses can be served" wording.
- No new signer: the founder's wallet, with the same durable recovery as §4.
- **Tests:**
  - SUPPORT-only kept by default, and removed only by the explicit choice;
  - METERING\|SUPPORT gives "already";
  - an older-generation slot renews;
  - unchanged-state review gives the same digest;
  - stale control gives `E_REVIEWED`;
  - a granted permission with an unavailable runtime is shown as permission yes, service no.

## 7. Customer offer

The confirmed plan (id and full verified contents) pre-fills the existing offer inspection and its
own review: release, plan, retention and terms digest. That review is never skipped. The offer is
created only if the plan is usable (§5) and the existing readiness passes. Unavailable provider,
protected storage, budget or worker keep the action unavailable with their real remedy.

## 8. API and data inventory

Routes are owner-only, gated by the handover in their write transactions:
- `GET /api/businesses/:id/customer-access`: the three steps' states;
- `POST /api/sales/:business/prepare` with `kind: "create_plan"` or `"appoint"`;
- the existing actions, requested, check and abandon endpoints;
- the existing offer inspection and creation, with `plan_unusable` added.

`GET /api/businesses/:id/customer-access` returns:
- the release;
- the plan options: the confirmed plan from this flow, plus existing plans read by id on request;
- the quote and timing bounds (§5, from the configuration);
- the operator slot (§6);
- an offer summary;
- the open request, if any (a viewer's own rows only).

Data: `sale_actions` gains the `create_plan` kind (the table is rebuilt once to widen the kind
CHECK, as was done for `abort`). Plan contents are never stored as authority; the contract is read.

## 9. UI states

Each step is one of:
- *needs input*;
- *ready to review*;
- *asked: waiting for your wallet*;
- *sent: checking*;
- *unknown, recoverable by its own ID*;
- *refused (code)*;
- *confirmed (evidence)*;
- *unavailable (remedy)*;
- *blocked by another step*.

Further rules:
- Disabled buttons say why.
- The draft survives "Not now", a cancelled wallet and a reload. The unresolved request is shown
  apart from the draft.
- Readable summaries come first; technical identifiers are under details.
- Desktop (1440/1280) and 390 wide, keyboard order and focus restore follow the sale page's
  patterns. Owner evidence is never shown to customers or to a later owner.

## 10. Acceptance matrix (Phase B)

**Rust (contract, WSL):**
- C-1: `plan_bytes` is measured exactly.
- C-2: guarded create refusals, each atomic: control moved, plan id moved, live deal, cap 32,
  under-attached, each argument boundary.
- C-3: success: id, full readback, `created_generation`, event, excess refund.
- C-4: `get_plan_terms` fields before and after.
- C-5: appoint masks: replacement semantics, SUPPORT kept or removed only as given, generation renew.
- Then `cargo test`, clippy and the wasm32 build. A fixture `plan-setup.json` is replayed by the TS
  double.

**Model (TS double):**
- M-1: `FixtureChain` implements `create_plan_guarded` and `get_plan_terms` in `lib.rs` order;
  replaying the C fixture gives byte-identical views.
- M-2: `SyntheticRpc` applies the founder's signed call (receipt return value) and refuses a wrong
  signer, receiver, method or deposit as signed transactions.

**Services (configured composition in process):**
- S-1: prepare, create, requested and check for `create_plan` through the real routes; confirmed
  only with the id, full readback and generation.
- S-2: a lost answer, recovered by its own hash; a wrong hash is unmatched; a second create is
  refused while the first is open; a reload or restart gives the same row.
- S-3: a stale quote (`E_STORAGE`), stale control (`E_REVIEWED`), a concurrent plan
  (`E_REVIEWED_PLAN`), cap 32, a live deal, a handover gate.
- S-4: `servePolicy` everywhere (§5): the reproduced short plans, the 300 000/299 999 boundary, the late-but-permitted signature that now executes, a submission past its margin, a non-default configuration, and a configuration change that makes an offer unavailable.
- S-5: appoint masks, as in §6, through the real route.
- S-6: an older contract (no `get_plan_terms`): guided creation unavailable, existing plan
  inspectable.
- S-7: away and back: an old request's evidence is shown only to its participant, and a new owner
  needs a fresh review.
- S-8: a draft survives cancellation and is separate from the unresolved request (controller test).

**Actual processes (two children, one installation):**
- P-1: two children both prepare and create for the same review: one row, one ask.
- P-2: the child is killed after requested and before the hash; the other recovers by the original
  hash; one plan.
- P-3: the normal-route journey: a founder-created plan, then the reviewed grant, then the offer,
  then a synthetic customer reserves, runs and settles through the configured composition. A
  bootstrap-created plan doesn't count.

**Browser (finite configured harness; actual pages):**
- B-1: desktop 1440/1280 and 390: the three steps, review, ask, recover a lost answer, refusal
  wording, the unusable-plan explanation, mask removal wording.
- B-2: keyboard order, focus restore, failure and reload recovery.
- Zoom, reduced motion and screen reader stay unverified unless the backend supports them, and
  are stated as such.

**Evidence layers:**
- Rust: contract truth.
- TS double: coherent encoded calls.
- Process: actual children.
- Browser: actual pages.

None of these is testnet, wallet or provider evidence.

**Budgets:** one test worker, a 512 MiB parent, at most two 256 MiB children, hard per-test
timeouts, disposable directories, no listener left running.

## 11. Engineering decisions (recommended, with alternatives where material)

1. **A guarded plan method plus a terms view on the contract (recommended).** The alternative,
   using unguarded `create_plan` and inferring safety off-chain, can't stop a second identical
   plan after a race. Rejected.
2. **The `create_plan` kind in SaleActions (recommended).** The alternative is a separate
   owner-setup table with the same rules: more code and no benefit now.
3. **Default to keeping SUPPORT (METERING\|SUPPORT).** Removing it needs an explicit choice. The
   alternative, always replacing with METERING, silently removes permissions. Rejected.
4. **One `servePolicy` from the configuration at read time (recommended), with `sign_by`
   reserving execution time.** The alternative, longer plans only, doesn't fix the reproduced
   latest-signature case: rejected. Not stored: a configuration change is reflected at the next
   read.
5. **Measured `plan_bytes` as a code constant, versioned through the view (recommended).** The
   alternative, a dry-run quote, is unavailable on NEAR views for state writes.

## 12. Open questions for Astra

- Is SUPPORT retention as the default (§6) acceptable as the product wording?
- The minimum usable hold under defaults is 300 s, and the guided default is 600 s. Should the
  guided default instead be the usable minimum, to shorten holds?

Neither blocks Phase B.
