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

## 5. Timing that this server can actually serve (revised for Astra's D1/D2, 04:56)

Two kinds of deadline exist, and they are never merged:

- **Contract expiry**, unchanged: `accept_by_ms = serve_until − MIN_SERVE_MS`, the last block time
  at which the signed hold can still open on the contract. `decideReservation` uses it as proof
  that an unknown hold can no longer open (`expired_unopened`), and allocation, sequence and
  recovery rely on it. **An operational target never shortens it.** Astra's counterexample: a
  shortened copy says expired at T+500 000 while the original signed hold still opens.
- **Operational cutoffs**: when THIS server can still serve the hold. They are absolute times
  counted back from the signed `serve_until`. They use the same conservative clock rule as
  `timeLeft` (the later of the local clock and the block time) and the `fresh` bounds (a block
  at most `maxBlockAgeMs` old, at most `maxFutureSkewMs` ahead):
  - `reserve = max(MIN_SERVE_MS, runtime.timeoutMs + executionMarginMs)`: serve time that must
    remain when execution starts.
  - `execute_by = serve_until − reserve`: execution can still pass its existing `timeLeft` check
    (unchanged; not weakened).
  - `submit_by = execute_by − submitMarginMs`: the last moment a FIRST submission may start.
  - `sign_by = submit_by − maxFutureSkewMs`, in local time. A local clock behind NEAR's by up to
    the accepted skew can't push the signature past `submit_by`. An old block at prepare already
    moved `serve_until` earlier, so every cutoff moves earlier with it: an aged block can't make
    the execution reserve look larger than it is.
- **Usable** (one function, `servePolicy`) iff at prepare `sign_by − now ≥ minSignMs` (60 000, the
  server's existing rule). For inspection and offer creation, which have no prepare, it is
  evaluated against the worst accepted block: `window − maxBlockAgeMs − reserve −
  submitMarginMs − maxFutureSkewMs ≥ minSignMs`. With defaults: 600 000 − 120 000 − 120 000 −
  120 000 − 30 000 = 210 000 ≥ 60 000, so usable. **The minimum usable hold is 450 000 ms**; the
  **guided default is 600 000 ms** (Q2) when the rules allow it. Rules that can't fit the
  configured margins make guided creation unavailable, naming the margin and rule; the margins
  are never squeezed.
- **Settlement grace**, from the actual deadlines (Q3). A use may start execution as late as
  `execute_by`. Its result is decided within `runtime.timeoutMs`, then delivery within
  `deliveryTimeoutMs` (recovery finalizes `not_delivered` after that). The settle then needs one
  submission window (`submitMarginMs`, which covers the writer's timeout and the readback).
  `settle_until = serve_until + grace` must cover `execute_by + timeoutMs + deliveryTimeoutMs +
  submitMarginMs`. So `grace ≥ timeoutMs + deliveryTimeoutMs + submitMarginMs − reserve`; with
  defaults that is 60 000 + 300 000 + 120 000 − 120 000 = **360 000 ms**, and the maintenance
  interval is added when maintenance drives settlement. Below it, a delivered result could go
  unpaid (the customer then keeps the unit): **guided creation refuses** it, and an existing plan
  shows the warning. The plan stays usable for service: it isn't a safety failure.

**Effects, protected throughout (D1):**
- **Prepare** stores `sign_by` (as today, now execution-aware) and `submit_by`, alongside the
  unchanged `accept_by`.
- **Confirm after `sign_by`:** refused, as today. Nothing is signed or held.
- **First submission:** none after `submit_by`. A confirmed request with NO writer attempt at that
  point is cancelled unsent; nothing can land, so its allocation is freed (the existing
  `cancelUnsentInTx` rule).
- **An attempt that already exists** (signed or submitted, outcome unknown) is **never released,
  replaced or called failed because `submit_by` passed**. It stays unknown until contract evidence
  proves its outcome or its impossibility (`accept_by`, the existing proof). Its allocation is
  kept. A resend of the same bytes still happens only while they are valid (the writer's rule).
- **The original arriving between `submit_by` and `accept_by`:** the hold opens; readback
  reconciles it to the original request (the same identity). If it can no longer run (time left
  below `reserve`), the server **returns it uncharged**: an automatic release intent on the
  reconciled reservation, the existing release path, no execution. The customer sees "it was
  confirmed too late to run; your unit came back".
- **Execution's `not_enough_time` refusal and every margin are unchanged.**

**Isolated build worker (Q3):** serving an extraction offer doesn't need the isolated app-check
worker. Its unavailability never makes an extraction offer or a plan step unavailable. Only the
real service checks apply (the D4 readiness: release, runtime, budget, protection, writer, metering).

**Tests** (actual admission and recovery effects, not arithmetic only):
- The reproduced plans: defaults with 60 000, 180 000, 180 001 and 449 999 are unusable for an
  offer; 450 000 and 600 000 are usable.
- A non-default supported configuration with its boundary.
- **False early expiry regression:** a request whose `submit_by` passed with its attempt unknown
  is never `expired_unopened` before `accept_by`. Its allocation is kept and no second hold is
  made.
- **Delayed original in the gap:** it opens, reconciles to the original identity, and is returned
  uncharged. No provider call, no charge, no duplicate.
- **Lost reply in the gap:** readback finds the hold, then the same return.
- **Late-but-permitted signature:** confirm just before `sign_by`, the submission within its
  margin, then execution succeeds.
- **An old block still accepted** (maxBlockAgeMs − 1) and **future skew** (maxFutureSkewMs − 1) at
  prepare: the cutoffs move accordingly and the late-but-permitted path still executes.

## 5a. Conflicting plan requests (two tabs)

The `create_plan` exclusivity identity is `control:<seq>`. Creating a request whose digest
differs from an open row under the same identity is refused `request_conflict` (409), with that
row's readable terms. The founder then explicitly recovers it (check), abandons it (if never
asked), or replaces it (an asked one: only with `replaces`, which is itself safe because the
original can't land after control moves). New terms are never silently adopted, and the old row is
never silently returned as if it were the new request.

## 6. Service permissions: an explicit replacement mask

The appoint kind's review carries the **current slot** and the **resulting mask**:

| Current slot for the platform account | Offered result | Wording |
|---|---|---|
| none | METERING | "Adds metering." |
| METERING, older generation | METERING, this generation | "Renews metering for this owner." |
| SUPPORT only, this generation | **METERING\|SUPPORT** (default) or METERING (explicit choice) | "Adds metering and keeps support." Or: "Replaces support with metering: support is removed." |
| SUPPORT only, older generation | METERING\|SUPPORT for this generation (default) or METERING (explicit) | "Renews support for this owner and adds metering." Or: "Adds metering; support isn't renewed." |
| METERING\|SUPPORT, older generation | METERING\|SUPPORT for this generation (default) or METERING (explicit) | "Renews metering and support for this owner." Or: "Renews metering; support is removed." |
| METERING\|SUPPORT or METERING, this generation | nothing to do | "Already appointed." |

- The call carries the exact resulting `caps` and `expected_control_seq`. The review digest binds
  the old mask, new mask and generation.
- A stale read (control moved) refuses `E_REVIEWED`; the founder re-reviews.
- **Confirmation:** "Metering is appointed for this owner." Service readiness is shown separately:
  the release, runtime, budget, protection, writer, metering and plan-timing checks of the existing
  D4 `serviceReadiness` (§5). The isolated build worker is not one of them: serving an extraction
  offer never needs it (Astra Q3). This replaces the current "customers' new uses can be served"
  wording.
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
created only if the plan is usable (§5) and the existing readiness passes. An unavailable runtime
provider, protected storage, budget, writer or metering keeps the action unavailable with its real
remedy. The isolated build worker's availability never does: it isn't a service requirement (§5).

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
- S-4: `servePolicy` everywhere (§5): the reproduced short plans, the 450 000/449 999 boundary; the false-early-expiry regression; a delayed original and a lost reply in the gap, each returned uncharged; the late-but-permitted signature; an old block and future skew; a non-default configuration; a configuration change that makes an offer unavailable.
- S-9: conflicting plan requests under one control identity (§5a).
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

## 12. Decisions taken (Astra 04:56)

- Q1: SUPPORT is kept by default only as the explicitly reviewed resulting mask; deliberate
  removal stays available. Older-generation SUPPORT and combined slots are included.
- Q2: the guided hold is 600 000 ms when supported.
- D1/D2: §5 (contract expiry separate from operational cutoffs; conservative absolute cutoffs).

## 12a. Previously open questions (answered above)

- Is SUPPORT retention as the default (§6) acceptable as the product wording? (Q1: yes, as the
  reviewed resulting mask.)
- Should the guided default be the usable minimum? (Q2: no, 600 s. The usable minimum is now
  450 s from the worst accepted block, §5, superseding the earlier 300 s.)
