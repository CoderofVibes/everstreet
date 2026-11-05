# Managed handover: a Gated acquisition that keeps customer service intact (job 003wf3)

**Phase A: design and exact test inventory only.** Written before any code, at `3651645`
(after Direct 003wf2's narrow acceptance, DirectSaleAccepted). The brief is
`docs/astra/jobs/2026-11-05_003wf3_managed-handover.md`. The required-design section and the six
acceptance requirements of `docs/astra/2026-11-04_GatedClosePlanning.md` are normative here.
Nothing in this document is implemented yet. Phase B starts only on Astra's explicit
continuation. Every requirement of Phase B, the parent 003wf, the six milestones and the
approved extensions stays in force.

Source references are `file:line` at `3651645`.

## 1. What people see

- **Seller and buyer** agree exact terms for a business whose contract closes through a named
  closer (Gated). After both accept, the contract is *closing*. The sale page then says
  "Everstreet is checking the handover". It shows concrete progress:
  - new customer uses are paused for this business;
  - the uses already running are finishing;
  - their units are settled;
  - the close order is sent, then confirmed on the contract;
  - the close is applied here;
  - customers are served under the new owner.
  
  Any operation still unresolved is named. Ownership is never called transferred until the
  contract shows this exact close **and** the existing local reconciliation applied it.
- **Customers** keep access, requests, results and remaining units. During the pause, a new use
  is refused before anything is signed or charged: "This business is changing hands. New uses
  are paused for a few minutes; nothing was charged and your units are safe." A reserved use
  that hadn't run yet has its unit returned. Results stay readable. Every other business
  continues normally.
- **If the closer can't finish before the deadline**, the contract lets anyone end the closing.
  The page says so plainly, the seller's administration resumes only once the contract shows the
  deal ended, and the buyer's escrow becomes an *owed* claim until its payout is proven.

## 2. Grounded facts this design relies on

### 2.1 The contract (business-v3, undeployed, born locked)

- **Close mode is fixed at construction.** `new(…, closer: Option<AccountId>)`
  (`contracts/business-v3/src/lib.rs:1182`) chooses Gated with a closer account that must be
  its own account.
- **Entering Closing.** The second acceptance enters `DEAL_CLOSING` (`lib.rs:2095-2101`). It
  records `closing_started_ms`, `deadline_ms = now + close_window_ms` and `closing_control_seq`.
  Gated close windows are 10 minutes to 24 hours (`lib.rs:2616-2619`). Gated terms must grant at
  least one METERING operator (`lib.rs:2628-2632`, mirrored at `server/test/sale-chain.ts:692`),
  but it can be any account (`tests.rs:3317` c02).
- **What freezes while a deal is live, Closing included:**
  - owner administration: `create_plan`, `appoint_operator`, `revoke_operator` and
    `set_manifest` all `require_no_deal` (`lib.rs:1247, 1302, 1325, 1344, 2552`);
  - terms, funding and cancellation: revision, unfund, cancel, expire and fund all refuse
    Closing (`lib.rs:1975, 2036, 2129, 2147, 2774`);
  - withdrawals: `withdraw_profit` refuses Closing (`lib.rs:1759`).
  
  So `control_seq` can't move during Closing except by `close_sale` or `abort_close`, and the
  order's `closing_control_seq` stays valid.
- **What still works during Closing:** customer methods, including `open_hold`, `settle_hold`,
  `release_hold*`, refunds and claims. `open_hold`/`settle_hold` need `require_metering`: **the
  owner, or a METERING operator of the current generation** (`lib.rs:2527-2537`). The seller's
  own wallet can therefore open and settle holds during Closing, outside anything the platform
  gates (limitation L1, §12).
- **Holds aren't bound to a generation.** The hold and use messages carry business, plan,
  customer, registration, key slot/epoch, hold sequence, units and deadlines
  (`lib.rs:1054, 1083`), but no generation. After a close, a hold is settled by a METERING
  operator of the **new** generation, by its owner, or released by anyone after its settle
  deadline (`lib.rs:1685-1697`). `finalize` replaces every operator with the agreed grants at the
  next generation (`lib.rs:2725-2739`).
- **`close_sale(order)`** (`lib.rs:2165-2202`):
  - **checks:** Gated mode; caller is the closer; the live deal with that `deal_seq` is Closing;
    the version; the generation (in the order and on the contract, with the owner still the
    seller); `closing_control_seq` equal to the contract's control_seq; the digest (live and
    accepted); the manifest and `manifest_seq` (the contract's and the deal's);
    `issued_at_ms ≤ now`, `now − issued_at_ms ≤ 1 200 000 ms`, `issued_at_ms ≥
    closing_started_ms`; `now < deadline_ms`; `available ≥ available_floor`; `escrow == price`;
  - **not payable**, so a function-call access key can sign it (comment at `lib.rs:2163-2164`);
  - **at most once:** after it lands the deal is gone, so any later order fails `E_NO_DEAL`
    (`tests.rs:2391`).
- **`abort_close(deal_seq)`**: anyone may call it once `now ≥ deadline_ms` (`lib.rs:2154-2160`).
  The outcome is `aborted`, the generation is unchanged, and the escrow becomes the buyer's
  escrow-return claim (`tests.rs:2416-2434`).
- **Treasury.** `get_treasury` exposes `ent_held_value` (the value of all active holds),
  `available`, `escrow_total` and the claim totals (`lib.rs:791-802`). During Closing,
  `available` only rises. In the source, its only decrease is `withdraw_profit`
  (`lib.rs:1771`), which is refused during Closing (`lib.rs:1759`), and settlements add to it
  (`lib.rs:1671`). Rust test C-3 will pin this as an invariant.
- **Existing Rust coverage:**
  - g08: only the closer, with only the exact order, every field and age bound (`tests.rs:2360`);
  - g08b: the exact deadline;
  - g09: abort and escrow return;
  - g10: away and back in both modes;
  - c02.
  
  Not covered yet: C-1 to C-6 (§10.1).

### 2.2 The platform's services

- **Local authority transitions exactly one way.** `V3Intents.reconcile`
  (`server/src/v3intents.ts:318-449`) reads fresh evidence, records it through the observation
  ordering rules, decides, and applies in one transaction. The apply step is a CAS on the intent,
  a monotonic ownership check, the `businesses.owner_id` and `ownership` rows, team revocation,
  listing closure, value settings and deal voiding. It needs a participant viewer (`:320`).
  Nothing else writes ownership; this design keeps that.
- **Per-business control epoch.** `store.controlEpoch`/`stillControls` (`server/src/store.ts:908-927`)
  equal the owner plus the `ownership` row count. Most owner writes check it inside their write
  transaction (callers: `app.ts:892-941`, customer offers, imports, opportunities, publication,
  payments, v3 intents).
- **Every `store.tx` is `BEGIN IMMEDIATE`** (`store.ts:136-146`; also `customerUse.ts:424` and
  `customerWriter.ts:655`). SQLite therefore serializes every write transaction across
  connections and processes. A row written by one committed transaction is visible to every write
  transaction that begins after it.
- **The customer use lifecycle** (`server/src/customerUse.ts`), with request states from
  `db.ts:584`:
  - **prepare** reads at a pinned block, allocates the next hold sequence and stores the exact
    envelope;
  - **confirm** (`:1913-1970`) moves `prepared → reserve_requested` in one transaction, then
    `step`;
  - **step/submit** (`:2024-2245`) is leased. It records the intent `reserve_unknown` before the
    writer's `open_hold`; readback decides `reserved/refused/unresolved`; a still-acceptable hold
    is resent with identical bytes up to `maxSubmissions` 5;
  - **execute** (`:2356-2546`) reads the chain, then dispatches inside `runtime.startCustomer`'s
    transaction. That transaction rechecks the owner epoch (`:2520-2526`) and inserts
    `customer_executions`;
  - **settlement** (`:2915-3100`): a final delivery decision freezes a `charge` or `release`
    intent, and a leased `unitStep` submits `settle_hold`/`release_hold_for` and decides by
    exact readback.
  
  Bounds:
  - the provider call: `RUNTIME_LIMITS.maxSeconds` 60 (`runtime.ts:22`);
  - the execution margin: 60 s (`customerUse.ts:394`);
  - the serve window: at most 10 min (`:402`);
  - the delivery timeout: 5 min (`:397`);
  - the write timeout: 20 s; the step lease: 30 s.
- **Releases serve across owners.** `ManagedRuntime.releaseFor` (`invocations.ts:635`) has no
  owner or generation check. An active release keeps serving customers across a close, while
  *activating* a release requires an artifact built under the current owner and generation
  (`releases.ts:67`).
- **Builds** bind `owner_id`/`owner_generation` (`builds.ts:93-94, 614-633`). `fenceStale`
  (`:390-410`) fences live jobs of a former owner at its next touch and signals in-process
  workers. A cancelled or fenced job's provider call may still be running (a cancelled Promise
  doesn't prove it stopped). Usage is then reconciled by receipts.
- **Evaluations and trials** are runtime invocations owned by a runner process
  (`evaluations.ts:344-356`, `runtime_invocations` at `db.ts:380-398`), bound to an artifact of
  the owner that requested them.
- **The customer writer** (`server/src/customerWriter.ts:1-25`) keeps one durable attempt per
  operation (`chain_tx_attempts`, `db.ts:774-786`). It writes the payload digest, nonce, block
  hash, signed bytes and hash before broadcast. Nonces are allocated under BEGIN IMMEDIATE (shared
  `chain_tx_nonces`). It rebroadcasts the same bytes, and a fresh attempt follows only an
  admission refusal received by the sole counted sender. The table's `method` CHECK allows only
  `open_hold`, `settle_hold` and `release_hold_for`.
- **Lifecycle** (003wf1, `APPLICATION_COMPOSITION.md` §12):
  - durable maintenance leases (`maintenance_lease`, CAS claim/renew);
  - per-process holder ids and `process_presence`;
  - admission ends, then scheduling stops and work drains, then the `Fence` and `gateDb` close
    (`fence.ts`), then resources close.
  
  This is **application-wide shutdown**, not a business handover. Its primitives (CAS lease,
  holder liveness, fence) are reused below. Its test evidence is not.
- **Sale actions today refuse Gated.** `SaleActions` reports `capability.reason = "gated"` and
  refuses every kind but claims and registration (`saleActions.ts:813-916`).

## 3. Work that can cross an ownership boundary

**Policy key:**
- **Gate:** refused once the business's handover gate is closed (§4.2), inside the same write
  transaction that would admit it.
- **Finish:** allowed to complete; readiness waits for a final state.
- **Fence:** allowed to complete, but its result can't act for the new owner (existing
  generation binding).
- **Cancel:** ended locally only where no external effect can exist.
- **Return:** the customer's unit goes back (a release on chain).
- **Resume:** the buyer may do it again after the close.

| # | Work | Durable record before external effect | Admission point (where the gate check goes) | Policy across the handover | Readiness evidence | Instrumented today? |
|---|---|---|---|---|---|---|
| W1 | Customer prepare | `customer_requests` `prepared` (no chain effect) | `CustomerUses.prepare` | **Gate** (refused with `handover_pause`, so nobody signs in vain) | none needed: a prepared row can't be confirmed while gated and expires at `sign_by_ms` | no gate check |
| W2 | Customer confirm → reservation | `reserve_requested` row; writer attempt before broadcast | the `confirm` transaction (`customerUse.ts:1945`) | **Gate** | — | no |
| W3 | First reservation submission of an already-confirmed row | `reserve_requested`, `submissions = 0`, no `chain_tx_attempts` row | `submit` intent write under lease (`:2028`) | **Gate**, then **Cancel**: no attempt exists for the operation, so nothing can land. A new transition `reserve_requested → cancelled` (reason `handover_pause`, allocation freed) only when no attempt row exists | the row is `cancelled` | no |
| W4 | Reservation already submitted (`reserve_unknown`, or with attempts) | attempts row with signed bytes | resubmission in `step` (`:2230-2242`) | **Gate the resend.** Keep exact readback until decided: reserved (then W5), refused or unresolved. **Provably dead** when the contract's block time passes `serve_until_ms − MIN_SERVE_MS` (`open_hold` then fails `E_EXPIRED`, `lib.rs:1587`) and readback shows no active hold with that sequence | `decideReservation` final, or the dead-by-contract-time proof at a pinned block | resend not gated |
| W5 | Reserved, not executed | `reserved` row, no `customer_executions` | `execute` dispatch transaction (`:2496-2541`) | **Gate** new dispatch, then **Return**: a coordinator-requested release intent (`kind release`, reason `handover_pause`) settled by `release_hold_for` | settlement `returned` | no gate in `inTx`; no handover release reason |
| W6 | Execution in flight (provider call, then result protection) | `customer_executions` + `runtime_invocations` `running` | — (already admitted) | **Finish**: never cancelled to "prove" it stopped. The invocation commits `completed` **before** the customer sink protects and records the result (`invocations.ts:790-805` → `customerUse.ts:2549-2608`), so "not running" is not "delivered". Wait for `customer_executions.delivery` to be final. A runner that is gone is recovered by its own process's recovery, or the next start's (existing) | invocation terminal **and** `delivery ∈ {delivered, not_delivered}` (the existing `deliveryDecision`, with its 5 min timeout) | yes (existing states) |
| W7 | Settlement of a delivered or ineligible use | `customer_settlements` `requested/unknown` | `unitStep` (leased) | **Finish**, prioritized for the gated business. Settled under the **seller's** generation before the order | settlement `charged` or `returned` | yes; no priority |
| W8 | Holds opened outside the platform (by the seller's wallet or another current-generation METERING operator) | none here | **the contract** (Phase B, Q8): `open_hold` refuses a NEW hold while the live deal is Closing (`E_CLOSING`); an identical active hold still answers `already` | closed at the contract for code that has the guard (`get_handover_terms`, §16.1). For contract code without it, managed handover is **unavailable**, never silently claimed | `ent_held_value == "0"` at the readiness block, and the guard proven by `get_handover_terms` | Phase B |
| W9 | Customer purchases (wallet `ft_transfer_call` to the contract) | `customer_purchases` (the customer's own wallet sends) | purchase prepare | **Allowed** (question Q4): units are contract obligations that carry over unchanged, and they don't touch `available` | none | n/a |
| W10 | Customer result reads, input and result expiry, deletion | the customer's own rows | — | **Unaffected** (the customer's data, never the owner's) | — | yes |
| W11 | Owner administration routes (business profile, offer, publish/unpublish, public profile, listing, team, value settings, costs, budgets, updates, sessions, deals, payments, imports for this business) | each route's own rows | `store.stillControls` inside each write transaction (where used) | **Gate** while closing (409 `handover_in_progress`). Afterwards they are the buyer's (the existing control-epoch change already fences seller tabs) | none | partial: `stillControls` is used by many routes, but not all (§11 list) |
| W12 | Customer offers: create and retire | `customer_offers` | `CustomerUses.createOffer` / `retireOffer` (`stillControls`) | **Gate** | — | via `stillControls` |
| W13 | Release activate and rollback | `runtime_releases` | `Releases` (own owner check, `releases.ts:67`) | **Gate** (they change what customers get mid-handover) | — | no |
| W14 | Build request, retry, claim, dispatch and artifact publication | `build_jobs` queued (owner and generation bound) | four distinct points: the request transaction; the worker **claim** (`builds.ts:941-969`); the **dispatch** transaction before `provider.start` (`:1094`); the final artifact/state transaction | **Gate** the request, the claim and the dispatch for the gated business. A claimed job waiting before `provider.start` is refused at dispatch and requeued, and is fenced after the close. A build **already dispatched** is **Fenced, non-blocking**: a lease expiry or abort never proves its provider call didn't run, so its usage stays `unknown` until receipts say otherwise. Its artifact, published during or after the gate, carries the seller's `owner_generation`, which `releases.ts:67` and `fenceStale` (`:390-410`) make unusable by the buyer. Builds don't touch customers or the contract, and can run 15 min (`builds.ts:44`), so blocking the close on them would trade a real risk for none | none (non-blocking); listed in readiness as "won't carry over", with any unknown usage | claim and dispatch not gated |
| W15 | Evaluations, app checks, owner trials | `eval_runs` (a **loop** of cases) and one `runtime_invocations` row per case (purpose evaluation/trial) | **every case's** `runtime.start` dispatch transaction (`evaluations.ts:501-512`), not only the run's start; the trial route; the app-check start | **Gate** each case dispatch: a live seller loop refused between cases ends its run (`stopped`, reason `handover_pause`). **Blocking** while any evaluation or trial invocation of the business is `running`, or any eval run is still `running` (bounded by one case, at most 60 s). Results bind to the seller's artifact (fenced) | no evaluation/trial invocation running, and no eval run `running`, for the business | no |
| W16 | Sale actions on this deal | `sale_actions` | `SaleActions` | Allowed where the contract allows: claims, registration, and (after the deadline) the abort. Proposing, revising, funding, unfunding and cancelling are already refused by the contract during Closing | — | Gated refused today (§8) |
| W17 | Local authority reconciliation | `v3_intents` `recorded` | `V3Intents.reconcile` | **Reconcile** only after the contract shows this exact close. It is reused, never bypassed | intent `applied` (or `already`/`superseded`) | yes; participant-only entry |
| W18 | Late answers after the close | the attempt and execution rows | — | A late writer answer is an event only. A late result is the customer's own (the customer keeps it). A late build or eval stays fenced by generation. A late close or abort transaction is resolved by contract state only | — | yes |

### 3.1 Why readiness is not a count checked too early

- The gate (§4.2) is a row committed by one write transaction.
- Every gated admission (W1–W5, W11–W15) re-reads the gate inside **its own** write transaction,
  which is `BEGIN IMMEDIATE`. Any admission that commits after the gate therefore sees it and is
  refused.
- So once the gate is committed, the set of admitted gated work can only shrink: existing rows
  move to final states, and none are added. A readiness read after the gate sees the whole set.
- No admission may create an external effect before committing its admission row. W2/W3 write the
  attempt before broadcast, and W5/W6 insert the execution in the dispatch transaction. This is
  true today for every row above. §11 lists the code that must be made to check the gate.
- What the gate can't cover is W8 (off-platform actors). It is *measured* at the readiness read,
  not assumed.
- **The checks live in the services' write transactions, never in route middleware.** A handler
  that awaits its body, a chain read or a protected-input load before mutating, or a call made
  by a service outside HTTP (maintenance, the build worker, an eval loop), still meets the gate
  at its commit. A pre-handler read in one process can't protect a later commit in another.

## 4. The per-business handover state machine

### 4.1 Identity

One row per exact closing: `business_handovers`, unique `(business_id, deal_seq, version)`, with
a partial unique index allowing **at most one non-terminal row per business**. Its identity
fields are immutable (a trigger refuses updates to them):
- `network` and `account` (the v3 binding);
- `deal_seq`, `version` and `digest` (the accepted digest);
- `expected_generation`, `closing_control_seq` and `closing_started_ms`;
- `deadline_ms`, `manifest` and `manifest_seq`;
- `price`, `available_floor` and `grants`;
- `closer`;
- `seller_account`, `buyer_account`, `seller_person_id` and `buyer_person_id`;
- `intent_id`, the v3 intent recorded at proposal.

They are taken from **one pinned read** showing `live_deal.state == "closing"` with these exact
values, never from a local belief.

**Two different epochs, both bound and never assumed equal.**
- The contract's `expected_generation` comes from the read. The order carries it.
- The **local** control epoch (`store.controlEpoch`, the count of ownership rows,
  `store.ts:908-916`) comes from the intent's `local_epoch` (`v3_intents`).
- They can differ, for example after an import or a reconciliation history that started at
  another count. The handover checks each against its own source: the chain generation at every
  pinned read, and the local epoch in the reconciliation's existing monotonic check
  (`v3intents.ts:401-406`).

### 4.2 States

```
              (pinned read: this exact deal is closing)
                          │
                          ▼
   ┌──────────────► gated ──────────────┐            ┌───────────────────────────┐
   │   (re-drain on   │  readiness proven at a        │  contract outcome ABORTED │
   │   restart)       ▼  pinned read                  │  for this deal_seq        │
   │              ready ───────────────┐              │  (seen from ANY state)    │
   │                │  order n created │              └─────────────┬─────────────┘
   │                ▼  (immutable)     │                            ▼
   │            ordering ──► outcome_unknown          released_to_seller (terminal)
   │                │  (attempt hash known; resolve by hash and contract state)
   │                ▼
   │   contract outcome CLOSED for exactly (deal_seq, version, digest)  ← seen from ANY state
   │                │
   │                ▼
   │         closed_observed ──► reconciled ──► released_to_buyer (terminal)
   │                              (existing V3Intents apply, or already/superseded)
   └── attention (non-terminal; the gate stays closed): conflict, unresolved customer item,
       binding change, or evidence flag. Leaves only by authoritative evidence.
```

- **The gate is closed in every non-terminal state.** It opens only in the two terminal states,
  and each terminal state is entered **only** from contract evidence:
  - `released_to_buyer`: from the `closed` outcome for this exact deal plus the reconciliation;
  - `released_to_seller`: from the `aborted` outcome for this `deal_seq`.
  
  No timeout, local failure, lost reply or expired order ever opens the gate.
- **Closing → `gated`.** The row is created by whichever happens first (both are idempotent on
  the unique key):
  - **a) the coordinator's pass** observes Closing for a bound business;
  - **b) `SaleActions` records a confirmed closing acceptance** (its resolution is `closing`)
    and arms the gate. It still takes identity only from a pinned read.
  
  If neither closer nor coordinator is configured, see Q2.
- **`gated → ready`.** This is a readiness evaluation, recorded as an immutable evidence row
  (`handover_evidence`, kind `readiness`). One transaction reads the local inventory after a
  fresh pinned chain read **R**, and passes only if:
  1. R shows the identical closing deal and the contract checks of §2.1 (state, control_seq,
     generation, digest, manifest, escrow);
  2. every W2–W7 row of this business is final (W3 cancelled, W4 decided or provably dead,
     W5 returned, W6 terminal with delivery final, W7 charged/returned), with none in conflict
     or unresolved; and no W15 evaluation/trial invocation or eval run is running;
  3. `ent_held_value == "0"` at R;
  4. `available ≥ available_floor` at R;
  5. there is time: `deadline_ms − R.timestamp_ms ≥ dispatch_margin_ms`.
  
  A failure records which condition failed, by category and count, never customer content.
- **`ready → ordering`.** An order is created (§5) **only under the business's handover lease**
  and with readiness re-evaluated in the same pass. A readiness older than the pass is never
  reused.
- **`ordering → outcome_unknown`.** The closer's answer is missing, timed out or ambiguous. The
  attempt's own hash is known (written before broadcast).
- **Any state → `closed_observed`.** A pinned read whose outcome ring holds `closed` for this
  `deal_seq`, `version` and `digest`, whichever order landed. A `closed` outcome for this
  `deal_seq` with a different version or digest is impossible by the contract; if seen, it is
  `attention` (evidence conflict).
- **`closed_observed → reconciled`.** The existing reconciliation (W17) through an internal
  entry using the same decide/apply code (§6).
- **`reconciled → released_to_buyer`.** The gate opens. Customer admission then runs on the
  existing per-use checks, notably `platformMeters` at the new generation (`customerUse.ts:2443`).

### 4.3 Admission gate semantics

- `store.handoverGate(businessId)` returns the non-terminal row or null. It is called inside the
  admission's own write transaction.
- **Customer-facing refusals** (W1, W2, W5) answer 409 `handover_pause`, with a plain message
  and `retry_after_ms` (bounded at 60 s; it is advice, not a promise). Nothing is signed,
  charged or held.
- **Owner refusals** (W11–W15) answer 409 `handover_in_progress` and name the deal, never
  internal coordination terms.
- **Background refusals** (W3/W4 submission, W14 dispatch) return a step result
  `handover_paused` and back off. They don't count as failures.
- **Sale-side allowances** (W16): claims and registration, plus abort after the deadline.
- **Other businesses:** the gate is keyed by `business_id`, and no global flag exists. Another
  business's admissions read no handover row.

### 4.4 Coordinator, leases and several processes

- **One coordinator per process**, `HandoverCoordinator`, started like maintenance (after
  listen, `compose.ts` start) and only when `handover` is configured (§7).
- **Per-business lease.** `handover_lease(business_id, holder, gen, until_ms)`, claimed and
  renewed by CAS as `maintenance_lease` is. The holder is the process holder id, and the lease
  lasts 3 × max(interval, pass budget).
- **Every coordinator write is a CAS on `(business_id, gen)` under BEGIN IMMEDIATE.** An expired
  holder's late write changes nothing.
- **Two coordinators:** one holds a business's lease and works; the other stands by for that
  business (it may hold a different business's lease). It takes over after expiry.
- **Enforcement doesn't depend on the lease.** Every process enforces the gate (it is a database
  row), even with no coordinator configured or running.
- **Work per pass is bounded:**
  - at most `batch` businesses;
  - per business: one pinned read for readiness, at most N W3–W7 item steps (delegated to the
    existing leased customer operations), and one order or attempt step;
  - a pass budget plus an operation deadline, as maintenance has.
- **Crash or restart at each state (durable resume):**
  - `gated`: re-drain;
  - `ready`: re-evaluate (readiness isn't carried across a restart);
  - `ordering` with a signed attempt: resolve by its hash; rebroadcast the same bytes only under
    the writer rules;
  - `outcome_unknown`: read contract state;
  - `closed_observed`: reconcile (idempotent);
  - `reconciled`: open the gate.
  
  A killed process's in-flight provider call stays an unknown invocation, recovered by the
  existing runtime recovery. Readiness waits for it.
- **Unavailable peers.** A peer's running invocation is left to that peer while its
  `process_presence` is live (the existing `isLive`). A gone peer's work is recovered by the
  existing recovery paths. The coordinator never marks another process's work done.
- **Late callbacks** (W18) were covered above. After process stop, the existing `Fence` and
  `gateDb` refuse late continuations, and they are recovered on the next start.

## 5. CloseOrder, dispatch, journal and evidence

- **The order** is an immutable `close_orders` row: `(handover_id, n)`, with `n` from 1 to
  `max_orders` (8).
  - **Contents:** the exact `CloseOrder` JSON. `deal_seq`, `version`, `digest`,
    `expected_generation`, `closing_control_seq`, `manifest` and `manifest_seq` come from the
    handover row, and `issued_at_ms` is **the block timestamp of the fresh pinned read** used to
    build it (never the local clock). It also stores the read block (height, hash), its own
    digest (sha256 of the canonical order JSON) and `created_ms`.
  - **Contract bounds:** `issued_at_ms ≥ closing_started_ms` holds because the read is during
    Closing, `issued_at_ms ≤ landing` holds because blocks only move forward, and age ≤ 20 min is
    the reason for replacement.
  - **Pre-checks before creating it:** each §2.1 check that can be decided from the read.
- **Dispatch.** `CloserWriter` (§7) signs `close_sale({order})` as the configured closer, with
  deposit 0 and fixed gas. It writes the attempt (`closer_tx_attempts`: operation = order id,
  payload digest, nonce, block hash, signed bytes, tx hash) **before** broadcast, with the nonce
  from the shared `chain_tx_nonces` under BEGIN IMMEDIATE.
- **Recording dispatch.** `ordering` means an attempt row exists. The broadcast's answer is a
  journal event only.
- **Evidence is separated, never merged:**

  | Fact | Source | Proves |
  |---|---|---|
  | preparation | the `close_orders` row | what we intend to send |
  | durable dispatch | the `closer_tx_attempts` row | which exact signed transaction may exist |
  | transaction result | FINAL status for **that hash** | that transaction's own success or failure |
  | proven close | the contract's outcome ring at a pinned block: `closed`, this `deal_seq`/`version`/`digest`, `generation_after` | the business closed on the contract (whichever order landed) |
  | local reconciliation | intent `applied` (or already/superseded) | ownership here follows the contract |
  | customer readiness | the gate open plus `platformMeters` at the new generation | customers can be served |

- **A replacement is safe, and why.** Every order of one handover names the same deal, version,
  digest, generation, control sequence and manifest. The contract closes a deal at most once
  (the state leaves Closing, and later orders fail `E_NO_DEAL`), so any order that lands closes
  exactly the agreed deal. Outstanding older orders therefore can never cause an *inconsistent*
  result: the outcome is binary and decided by the contract. The only dangerous action is a
  conflicting **local** one while an order might still land, which means opening the gate to the
  seller. That happens only on the contract's `aborted` outcome, after which every order fails.

  Hence:
  - **A new order** `n+1` is allowed only while the contract still shows this exact deal Closing,
    and when either the last order's age is above `MAX_ISSUE_AGE_MS − dispatch_margin_ms`, or its
    attempt has an exact FINAL failure (for example `E_FLOOR` before late settlements landed).
    It is also capped at `max_orders`.
  - **Never** is a used nonce, timeout, expired order, missing answer or rebroadcast refusal
    treated as proof that an earlier send failed. Old attempts stay tracked and are resolved by
    their own hash. Their result is journaled, not acted on.
  - This differs from 003wf2's flagged reversible-state assumption: nothing here depends on an
    acceptance or registration that could revert.
- **Unknown result.** Keep reading:
  1. the contract outcome first (it decides);
  2. then each outstanding attempt's FINAL status, for the journal.
  
  `outcome_unknown` is shown to both parties as "The close was sent; confirming on NEAR". It is
  never shown as closed, and never as failed.
- **Deadline.**
  - With less than `dispatch_margin_ms` left, no new order is created. The page explains that
    the contract will let anyone end the closing after the deadline.
  - After the deadline, the abort is a wallet action for either party (§8). Optionally the
    coordinator sends `abort_close` itself (Q5).
  - `released_to_seller` needs the `aborted` outcome.
  - The buyer's escrow is then an owed claim, collected through the existing guarded claim path.
- **Journal.** `handover_journal` is append-only (triggers refuse update and delete) and bounded
  to 256 entries per handover. Each entry has a kind, a short code, a block or hash where
  relevant, a lease gen and a time. It never holds customer content, signed bytes or keys.
- **Evidence rows.** `handover_evidence` is immutable and bounded to 64 per handover: readiness
  passes and failures, order pre-checks, and outcome reads, with block, counts and decision.

## 6. Local reconciliation and customer readiness

- Gated proposals record the v3 intent at proposal confirmation (as Direct does through
  `SaleActions.ensureRecorded`). The handover row keeps `intent_id`.
- **Reconciliation** reuses `V3Intents`:
  - its decide/apply body is factored into an internal `applyObserved(intent, actor)`;
  - the participant route keeps calling it with the viewer, as today;
  - the coordinator calls it with `actor = system:handover`, which is recorded in `events` and
    the journal.
  
  No other code writes `owner_id`, `ownership`, team, listing or deal rows. A conflict leaves
  the handover in `attention` with the gate closed, and both parties see "the contract shows the
  close but it couldn't be applied here; nothing was changed".
- **After `reconciled`:**
  1. the gate opens;
  2. the seller's tabs are already fenced by the control-epoch change;
  3. queued and running seller builds are fenced at their next touch (existing);
  4. the buyer becomes owner here.
  
  Customer service is then decided per use by existing checks. If the platform meter isn't in
  the grants, the existing `operator_not_authorized` path explains it, and the buyer can appoint
  through the guarded `appoint_operator_guarded` (from 003wf2).
- **Customer continuity facts carried across, never recomputed:** each request keeps its id,
  hold sequence, result and unit state, and the entitlement's free, consumed and claim come from
  the contract's views.

## 7. The closer capability

- **Config (validated, absent by default):**

  ```json
  "handover": {
    "enabled": true,
    "closer": {
      "account": "closer.example.testnet",
      "keys": [ { "business_id": "…", "key_file": "…" } ]   // one function-call key per binding (Q3, §16)
    },
    "interval_ms": 10000, "batch": 5, "pass_budget_ms": 8000, "op_deadline_ms": 5000,
    "dispatch_margin_ms": 180000, "max_orders": 8, "stop_timeout_ms": 10000
  }
  ```

  - It needs `rpc`, `v3` bindings and customer use. Every field is required when the section is
    present; unknown fields are refused. `enabled: false` is the same as absent.
  - The key file has the same shape as the operator key (`account_id`, `public_key`,
    `private_key`). It is read only by the composition, never printed or logged.
- **Supported signing boundary.**
  - `CloserWriter` reuses the customer writer's proven machinery, extracted into a shared
    transaction core: Borsh, sign, the durable attempt, nonce under lock, rebroadcast rules and
    FINAL status. It has its own attempts table, because the existing `method` CHECK
    (`db.ts:776`) lists only the three customer methods and SQLite can't alter a CHECK without a
    rebuild; Q6 asks whether to rebuild instead.
  - Methods: **`close_sale` only**, plus `abort_close` if Q5 says so. The receiver is exactly
    the bound business account, the deposit is 0, and the gas is fixed.
- **Least privilege.** Per the pinned near-api-js key-management reference (function-call keys
  restricted to a contract and method names, with an allowance), the closer key should be a
  **function-call access key** for receiver = the business account and methods = [`close_sale`].
  `close_sale` is not payable, so this works.
  - At start, the composition reads `view_access_key` and requires exactly that permission.
  - A full-access key is refused, and the capability says why (Q3: refuse or warn).
  - One FC key serves one receiver, so several Gated businesses need one key each on the closer
    account (Q3).
- **States, truthful in `/api/system/capabilities`:**
  - `managed_handover: unavailable`: not configured. Gated acceptance into Closing is refused by
    `SaleActions` with `handover_unavailable` (Q2).
  - `unavailable`: configured, but the key check failed. The reason says which check.
  - `on`: configured and the key verified for N businesses. **Observed** health is separate
    (`handover_observed`: state, last pass, in flight), with no business ids.
  
  Per-business readiness shows only on that sale page, to its participants.
- **No background closer by accident.** The coordinator exists only when configured. It closes
  only rows created from a pinned Closing read, and it never creates a deal or acceptance.
- **Local verification:**
  - ephemeral synthetic closer identities only;
  - `SyntheticRpc` (lifecycleWorld) extended to answer `view_access_key` with a FunctionCall
    permission, and to apply a signed `close_sale` (verified signature, nonce, receiver, method,
    deposit 0, gas) to the coherent sale double.
  
  No real key, network or deployment.

## 8. Sale actions and UI states

- **`SaleActions` for Gated:**
  - `propose` and `revise` with a `close_window_ms` (default 60 min, from 10 min to 24 h,
    validated against the contract);
  - `fund`, `unfund` and `cancel` as Direct (the contract refuses them during Closing);
  - `accept`: its confirmed result is `accepted` or `closing`. `closing` arms the gate (§4.2b),
    and the page then follows the handover instead of a local apply step;
  - a new **`abort`** (`abort_close`, anyone, only when the reading shows the deadline passed);
  - claims and registration as today.
  
  Every kind keeps 003wf2's exact review, single ask, lost-reply and original-transaction
  recovery. The platform-meter grant: see Q1.
- **The sale room's Gated progress** (pure functions, like `saleSteps`; an API field
  `handover` on `GET /api/sales/:business`, shown only to participants):

  | Step | Status words | From |
  |---|---|---|
  | Terms proposed / escrow funded / accepted by both | as Direct | contract reading |
  | Handover checks | "Checking: new uses paused, 2 uses finishing, 1 unit settling" / "Ready" / "Needs attention: …" | handover row + readiness evidence (counts by category) |
  | Close sent | "Not yet" / "Sent; confirming on NEAR" / "Sent again (order 2): the first one was too old" | orders + attempts (never shown as failed from a missing answer) |
  | Closed on the contract | "Closed" / "Ended without a close (deadline passed)" | the outcome ring |
  | Applied here | "Applied" / "Couldn't be applied; nothing was changed" | the intent |
  | Customers served | "New owner serving" / "Paused: the new owner hasn't appointed metering" | gate + control operators |
  | Proceeds / returned escrow | owed / in flight / paid (existing) | party claims and payouts |

  The deadline shows in local time and UTC. Actions are "Check again" (read-only refresh) and,
  after the deadline, "End this closing" (wallet `abort`). Nothing forces a close, skips checks
  or marks anything done.
- **Customer offer and use page:** the `handover_pause` refusal (§4.3), and a returned unit
  labelled "returned: the business was changing hands", with no charge.
- **Seller desk during Closing:** a banner ("This business is closing; changes are paused until
  the contract decides") and disabled controls with that reason. Read-only views continue.
- **Buyer after close:** the primary action opens the business workspace, with continuity and
  any unresolved item. Resale is a secondary action (§14.3). The released-to-buyer handover
  record links toward 003x's portable record later.

## 9. Data model, migrations, compatibility and budgets

- **New tables** (additive, `CREATE TABLE IF NOT EXISTS`; existing CHECKs unchanged):
  `business_handovers`, `handover_lease`, `close_orders`, `closer_tx_attempts` (or the rebuild
  in Q6), `handover_journal` and `handover_evidence`.
  - Triggers: immutable identity fields and immutable orders and evidence; the journal is
    append-only.
  - Indexes: one non-terminal handover per business; due-work indexes on state.
- **`customer_requests` and `customer_settlements` need no schema change:**
  - `cancelled` and `release` already exist;
  - reasons are free text (`handover_pause`);
  - the new transition `reserve_requested → cancelled` is code, guarded by "no attempt row".
- **Compatibility:**
  - no handover row means no gate, so behaviour is unchanged for every existing business and
    for Direct;
  - a database from before this migration simply has no rows.
  
  Old processes (before this code) on the same database wouldn't enforce the gate, so a mixed
  deployment is unsupported. A schema marker (`v3_meta` key `handover_schema`) makes a new
  process refuse to coordinate while an older peer's presence is live (Q7).
- **Budgets (all explicit and bounded):**
  - interval and pass budget as configured, and lease 3 × max(interval, pass budget);
  - per pass: ≤ `batch` businesses and ≤ 25 item steps per business;
  - ≤ 8 orders per handover, and ≤ 256 journal plus 64 evidence entries per handover;
  - every attempt-status check is bounded per pass with backoff;
  - stop drains within `stop_timeout_ms`, then the fence closes (existing);
  - no unbounded retries, and no polling loop outside a pass.

## 10. Exact test inventory (Phase B)

Layers are kept apart. Contract fixtures alone never establish drain.

### 10.1 Rust contract (business-v3; WSL, `CARGO_TARGET_DIR=$HOME/everstreet-target`)

- **C-1** A `gated-sale.json` fixture produced by the contract through propose, fund, both
  accepts (closing), `close_sale` and the outcome; plus a second run that ends in `abort_close`.
  The TS double replays both byte for byte.
- **C-2** During Closing, owner administration is refused (`E_DEAL_PENDING`) for every owner
  method. `control_seq` is unchanged across customer open, settle and release.
- **C-3** During Closing, `available` never decreases across settle, release, refund and claim
  calls (an invariant checked after each call).
- **C-4** A hold opened before the close is settled after the close by a successor METERING
  grant (new generation). An old-generation operator not re-granted is refused
  `E_NOT_OPERATOR`. Anyone may release after the settle deadline.
- **C-5** The owner (seller) can open a hold during Closing. This documents L1 as a tested
  fact.
- **C-6** Order replay: two valid orders with different `issued_at_ms`. The first closes; the
  second fails `E_NO_DEAL`. After abort, every order fails.

Then `cargo test`, `cargo clippy --all-targets` and the wasm32 release build.

### 10.2 Coherent encoded-call model (TS double)

- **M-1** `SaleChain` Gated: `close_sale` and `abort_close` follow `lib.rs` in its order, and C-1
  is replayed byte for byte.
- **M-2** `SyntheticRpc` accepts a signed `close_sale` only from the closer's FunctionCall key
  (receiver, method, deposit 0, gas, nonce, signature). Wrong signer, method, deposit, key kind
  or receiver are refused, and nothing is applied.
- **M-3** The outcome ring and treasury views are snapshot-coherent at pinned blocks (existing
  64-block snapshots).

### 10.3 Services in process (real services, deterministic barriers)

- **S-1** Gate on a Closing read: prepare, confirm and execute for that business get
  `handover_pause`; another business's prepare, confirm and execute succeed.
- **S-2** Race: an execute that passed its chain read before the gate is refused in its dispatch
  transaction after the gate (barrier between the read and `inTx`).
- **S-3** A held provider call (barrier) keeps readiness failing (`executions_running: 1`).
  Releasing it gives a delivered result, a charge settlement and then `ready`. The customer's
  result and unit identity are unchanged.
- **S-4** Reserved, not executed: it is released (`returned`, reason `handover_pause`) and the
  customer sees no charge.
- **S-5** A confirmed request never submitted (no attempt) is cancelled. A submitted
  `reserve_unknown` is never resent while gated, and is decided by readback or by the
  dead-by-contract-time proof.
- **S-6** Owner writes for the gated business (each W11–W15 route) get `handover_in_progress`.
  The same routes for another business pass.
- **S-7** A running build of the seller, finishing after the close, is fenced and can't be
  released by the buyer. A running evaluation's result doesn't make a buyer release ready.
- **S-8** `ent_held_value > 0` (a hold opened outside the platform by the seller) blocks
  readiness with a named reason.
- **S-9** Floor: `available < floor` blocks readiness; after the settlements land it passes.
- **S-10** Order content equals the contract's exact fields, and `issued_at_ms` is the read
  block's time. A stale, wrong-closer, changed-manifest, changed-generation, early or late order
  is refused by the double with the contract's code, and the handover stays gated.
- **S-11** A lost dispatch answer gives `outcome_unknown`. The contract showing closed leads to
  `closed_observed`, then reconciliation through the existing code, then `released_to_buyer`.
  No ownership is written outside `V3Intents`.
- **S-12** Order age: after more than 20 min minus the margin, order 2 is created. Order 1
  landing late is refused by the double; the outcome is still one close. Neither order's answer
  opens the gate.
- **S-13** The deadline passes without a close: no new order. `abort` by a party is recorded,
  the `aborted` outcome leads to `released_to_seller`, and the escrow is an owed claim, then
  restored or paid through the existing guarded claim.
- **S-14** The next use after the close runs under the buyer's grants, and the
  `operator_not_authorized` branch applies when the platform meter isn't granted.
- **S-15** A coordinator lease CAS: an expired holder's late write changes nothing.
- **S-16** Delivery barrier: the invocation is `completed` while the sink's protection is held.
  Readiness fails (`delivery_pending`). On release, the same result reference, outcome and unit
  identity are recorded, and the close follows. A protection failure gives `not_delivered`, then
  release and `returned`, with no orphan kept (the existing orphan sweep).
- **S-17** Evaluation loop: the gate closes **between two cases** of a live seller run. The next
  case's dispatch is refused, the run ends `stopped`, and readiness then passes. A case already
  dispatched blocks readiness until it ends.
- **S-18** Build points: a job claimed and held before `provider.start` when the gate closes is
  refused at dispatch and requeued, and fenced after the close. A job already dispatched
  finishes after the close: its artifact is unusable by the buyer and its usage stays `unknown`
  until a receipt. A build request and a retry during the gate are refused.
- **S-19** Races at the end:
  - close and abort both sent after the deadline: the contract decides; exactly one outcome is
    recorded and the gate follows it;
  - the original close sent with no reply, then a coordinator lease change: the new holder
    resolves by contract state and never opens the gate on a timeout;
  - the reconciliation fails after the chain close (a forced local conflict): `attention`, the
    gate stays closed, the seller's writes stay refused, and nothing is reopened.
- **S-20** Epochs: a business whose local ownership-row count differs from the contract
  generation (an imported history) is bound by both. A mismatch in either is refused with its
  own code, and nothing is assumed equal.
- **S-21** Route coverage: one test per classified mutation in §14.2 (gated owner write,
  customer recovery that stays allowed, read, not applicable), each through its service and,
  where relevant, with a body awaited before the mutation.

### 10.4 Actual processes (entryChild over `serve.ts`; IPC RPC/model; disposable directories; heap caps)

- **P-1** Two children on one database with the handover configured. One holds the business
  lease; the other refuses admissions by the gate row. Kill the holder at `gated`, `ready`,
  after the attempt is written but before broadcast, after broadcast with the reply lost, and at
  `closed_observed` before reconciliation. Each time the other process takes over after expiry
  and the result is the same: one close, one reconciliation, no duplicate settlement or charge,
  and the seller's authority is never revived.
- **P-2** A held provider call in child A at the moment of the gate. Child B's coordinator waits;
  A finishes; readiness passes; the close completes.
- **P-3** A late callback after A's stop: nothing reaches closed storage, the unknown state is
  recovered on restart, and readiness accounts for it.
- **P-4** An unaffected second business, with customer uses and owner writes, runs through the
  whole handover in the other child.
- **P-5** Cleanup and bounds: an injected startup failure, stop during each state, no listener,
  child or directory left, and finite budgets reported.

### 10.5 Browser (configured-composition harness, extended for Gated)

- **B-1** Both parties through their synthetic wallets: propose Gated, fund, accept (closing).
  The handover panel progresses; a held use is shown finishing; close; applied; the new owner
  serving.
- **B-2** A customer page during the pause: the refusal message, the returned unit, readable
  results.
- **B-3** Lost close answer, reload, abort after the deadline, and the escrow claim restored
  then paid.
- **B-4** 1440/1280/390, keyboard, zoom and reduced motion where the environment supports them.
  Remaining gaps are reported. Customer enrollment and revocation permissions stay untouched.

### 10.6 Required checks

`npm run check` (the new process tests go in the process phase), `npm run web:build`, and the
Rust checks above. The requirement matrix maps every Phase B item to a test ID.

## 11. Integration changes needed (concrete, none made in Phase A)

- **`db.ts`:** the new tables, triggers and indexes (§9).
- **`store.ts`:** `handoverGate`, and `stillControls(viewer, epoch, { gate: true })`, so the
  existing owner-write calls also refuse during a handover (opt-out for sale actions and reads).
- **`customerUse.ts`:**
  - gate checks in `prepare`, in the `confirm` transaction, and in `execute` `inTx`;
  - `submit` gated (no first submission and no resend);
  - `cancelUnsent(id)`, guarded by "no attempt row";
  - a handover release intent;
  - a per-business settlement priority.
- **`maintenance.ts`:** the reserve phase reports `handover_paused`, and the settle phase
  prefers gated businesses.
- **`builds.ts`:** gate checks at the request, the claim (`:941`) and the dispatch transaction
  before `provider.start` (`:1094`); a refused claimed job is requeued.
- **`evaluations.ts`:** a gate check at **each case's** `runtime.start` (`:501-512`); a refused
  run ends `stopped`.
- **`invocations.ts` (trials), `releases.ts` (activate and rollback), `appVersions` and
  checks:** gate checks in their write transactions.
- **Owner routes in `app.ts` that don't use `stillControls` today:** audited one by one in
  Phase B against the W11 list, each with a test in S-6.
- **`saleActions.ts`:** the Gated kinds, `abort`, and gate arming on a `closing` result.
- **`v3intents.ts`:** `applyObserved(intent, actor)` factored out of `reconcile`.
- **New files:**
  - `handover.ts`: the coordinator, state machine, readiness, orders and journal;
  - `closerWriter.ts`: the shared transaction core plus the closer;
  - `appConfig.ts` and `compose.ts`: the `handover` section, capability and observed health,
    start/stop with the existing stoppers, and the fence on its adapters.
- **Web:** the Gated progress and handover panel, the customer pause messages, and the seller
  desk banner.
- **Tests and doubles:** M-1 to M-3 and the extended harness.

## 12. Limitations this design states rather than hides

- **L1 Off-platform actors** (superseded in Phase B by Q8). The local contract source now
  refuses a new `open_hold` while Closing, so a hold can't be opened between the readiness read
  and the close by any caller, the seller's wallet included. Settlement, release, refunds and
  claims of existing holds are unchanged. What remains:
  - **Already-deployed v3 code** lacks the guard. Managed handover is unavailable for it: the
    capability check on `get_handover_terms` fails, and the reason says so.
  - **The guard isn't deployed anywhere.** That would be a new account, and needs Tony's yes.
- **L2** A provider call can't be proven stopped. The design waits for its terminal state or
  recovery instead, so a stuck runner can delay readiness until the deadline, and then the
  honest outcome is an abort.
- **L3** The minimum 10-minute close window is tight. The worst case is a 10-minute serve window
  plus a 5-minute delivery timeout plus settlement. A 60-minute default and the
  `dispatch_margin_ms` check keep it honest. A shorter window may simply abort.
- **L4** All evidence is local and synthetic until an authorized external rehearsal.

## 13. Engineering questions for Astra

- **Q1 Platform meter in Gated terms.** Should `SaleActions` *require* the platform's metering
  account among the grants for a Gated (managed) sale, since the handover promises continuity?
  Or allow its absence with Direct's explicit interruption wording? *Proposed: require it for
  managed handover. A buyer who wants another operator uses Direct.*
- **Q2 No closer configured.** If a Gated business reaches Closing here without a configured
  closer, should the gate still close admissions until the contract decides (safer for
  customers; the deal will abort at the deadline)? Or should `SaleActions` refuse the acceptance
  that would enter Closing? *Proposed: both. Refuse the closing acceptance here, and gate if
  Closing appears anyway (say, from an outside wallet).*
- **Q3 Closer keys.** One closer account per business, or one closer account with one
  function-call key per business (each restricted to that receiver)? Should a full-access closer
  key be refused or only warned about? *Proposed: one account, FC key per business, and refuse
  full access.*
- **Q4 Purchases during the pause.** Wallet purchases go straight to the contract and carry over
  as obligations. Allow them during the pause (proposed), or pause them too for clarity?
- **Q5 Abort sender.** Should the coordinator send `abort_close` itself after the deadline
  (`abort_close` would join the FC key's method list), or leave it to either party's wallet?
  *Proposed: parties' wallets only, in Phase B.*
- **Q6 Attempts table.** A separate `closer_tx_attempts` (proposed: no rebuild of a table that
  holds customer history), or rebuild `chain_tx_attempts` with a widened `method` CHECK?
- **Q7 Mixed versions.** Refuse coordination while a pre-handover process shares the database
  (schema marker plus presence)? Proposed: yes, with a named capability reason.
- **Q8 L1 in the contract.** Should a later contract revision refuse new holds while Closing
  (born locked, so a new account), or is detection plus disclosure sufficient for this phase?
- **Q9 System actor for reconciliation.** Is `applyObserved(intent, system:handover)` acceptable,
  given that today only a participant can trigger reconciliation (the same decide/apply code,
  audited)?

## 14. Astra's service-boundary review notes (00:48 / 00:54) and how this design answers them

Astra's `2026-11-05_ManagedHandoverReviewNotes.md` was written while this design was being
drafted. Each point was checked against the source and folded in above.

### 14.1 The eight boundaries

1. **A completed invocation isn't a completed delivery.** Confirmed: `invocations.ts:790-805`
   finishes the row before awaiting the sink. Readiness requires a final
   `customer_executions.delivery` (W6, §4.2). Test S-16 holds the sink at a barrier.
2. **Admission after asynchronous reads.** The gate is checked in `execute`'s `inTx`, the
   atomic dispatch transaction, after every await (W5, §3.1). Test S-2 pauses a request before
   `inTx` while the gate commits.
3. **An evaluation is a loop.** The gate is checked at each case's `runtime.start` transaction.
   Readiness blocks on a running eval run, not only on a running invocation (W15). Test S-17
   closes the gate between cases.
4. **Build claim and dispatch are different points.** They are gated separately (W14).
   Artifact publication and stale-owner fencing are covered. Usage stays `unknown`, never
   inferred from a lease expiry or abort. Test S-18.
5. **Synchronous owner mutations need an in-transaction check.** `stillControls(…, { gate:
   true })` runs inside each write transaction. `Releases.activate`/`rollback` and every other
   owner mutation in §14.2 get the check in their own transaction (§11). Tests S-6 and S-21.
6. **Local epoch versus chain generation.** Both are bound and checked against their own
   sources (§4.1). Test S-20.
7. **A transport deadline isn't terminal work.** The rule:
   - **blocks the close:** customer work until final, delivery included (W2–W7), and evaluation
     or trial provider work in flight (W15);
   - **journaled, not blocking:** builds already dispatched (W14) and their unknown usage, and
     writer and closer attempts whose result is still unknown (they are resolved by their own
     hash).
   
   An expired peer lease never proves that no external effect happened. It only lets another
   holder continue the same item from its own durable state and exact evidence (§4.4).
8. **Gate release needs exact terminal sale evidence.** Only the contract's `closed` (for this
   exact deal, plus the reconciliation) or `aborted` outcome opens the gate (§4.2, §5). The
   no-reply close, lease change, abort race and failed reconciliation are each specified, and
   tested in S-19 and P-1. No stale seller write is ever reopened by a local timeout.

### 14.2 Route classification (`app.ts` mutation inventory)

Every check is in the service's write transaction; the route only maps the refusal.

| Class | Routes / service calls | During a handover |
|---|---|---|
| Gated owner mutation | product projects: create for this business, revisions, restore, conversation, proposal apply; app-version current, checks and preview issuance; builds: request, retry; `build-budget`, `runtime-budget`; runtime trial invocations; test cases; evaluations; releases and rollback; business profile `PATCH /api/businesses/:id`, `offer`, `idea`; publish, unpublish, public-profile draft and publish; customer offers create and retire, offer inspections; listing; team add and remove; value settings, try and scenarios; costs add and delete; updates; sessions; imports for this business (create, edit, inspections, dependencies); v2 payments activate and withdraw; v2 deals | 409 `handover_in_progress` |
| Allowed participant or customer recovery (never frozen by an owner shortcut) | customer use status, result, `reconcile`, `units/reconcile`, `release`, execution cancel, cancel of a prepared use; customer purchases (prepare, requested, check, abandon), see Q4; sale actions: check, requested, abandon, claims, registration, abort after the deadline; v3 intent reconcile by a participant | allowed; each keeps its existing exact rules |
| Gated customer admission | customer prepare, confirm, execute | 409 `handover_pause` |
| Harmless read or evidence | every GET; `v3/refresh` (records observations through the existing ordering rules; never authority) | allowed |
| Not applicable | businesses not bound to a v3 contract (`v3.bindings`), and v3 businesses in Direct mode | unchanged: no handover row can exist for them |

- **Legacy applicability rule.** A handover exists only for a business bound in `v3.bindings`
  whose contract reports `close_mode: "gated"`. Older v2 routes (bookings, payments, deals) keep
  their own existing rules. The gate refuses their owner mutations only when that same business
  has a non-terminal handover, which a v2-only business can't have.
- **Phase B verifies this list against the source.** Any mutation not listed here is found by
  an audit of every `app.post/put/patch/delete` and every service write reachable outside HTTP,
  classified, and given its S-21 test. The list doesn't quietly assume completeness.

### 14.3 Acquisition aftercare

After `released_to_buyer`, the buyer's **primary** action opens the business workspace, with
continuity and readiness and any unresolved handover item visible. Proposing a resale stays an
explicit secondary action that opens its form. A fresh owner with no earlier deal keeps
"Prepare terms" reachable. Before the reconciliation, no operating readiness is shown and
nothing unresolved is hidden.

The same composition applies to Direct's post-close next action (`saleFlow.ts` around 626) when
the handover UI is built. It changes no transaction authority.

### 14.4 Product-wide copy (DirectSaleBrowserReview 00:52)

The handover's customer and storefront copy follows Astra's follow-up: continuity language fit
for digital-only, legacy-only and mixed storefronts, with no invented transferred rights and
private terms kept private. The broader copy review (Home stages, PublicPage history, the
releases note) stays in the cross-journey finish, as Astra placed it. It isn't added to 003wf3.

## 15. Not in Phase A, and retained

- **Not in Phase A:** any implementation, migration, config, test, harness or browser work.
  The Phase B items 1–6 of the brief stay required in full.
- **Retained:** Gated stays in the roadmap; parent 003wf's complete 100/20/80/79 journey, owner
  plan/operator setup, the unresolved-writer workflow, the wider nonce/migration/provider/process
  matrix and the prepared-only external rehearsal; all six milestones and the approved
  003x/005e/006b/006c extensions.
- **NEAR skill reference used.** The pinned `near-api-js/references/key_management.md` (SHA-256
  `0525a60e…9906`, matching the cache manifest at revision `cb32b6af`) supports the
  function-call access key for the closer (§7). Its examples aren't copied; the signing stays
  this repository's own (customerWriter core). The smart-contract and audit references from
  003wf2 apply unchanged to C-1 to C-6 when contract tests are added.

## 16. Phase B decisions and mandatory corrections (Astra, November 5 01:01)

This section governs where it differs from §1–§15. Astra's Q1–Q9 answers and corrections
D1–D7 are in `docs/astra/2026-11-05_ManagedHandoverReviewNotes.md`.

### 16.1 Contract guard and compatibility (Q8)

- **`open_hold`.** After its "already" branch (an identical active hold still answers
  `already`), it refuses `E_CLOSING: no new holds while the sale is closing` when the live deal
  is Closing. This applies to every caller: the owner's wallet and current-generation operators
  included. `settle_hold`, `release_hold*`, refunds, claims and purchases are unchanged.
- **A new view `get_handover_terms()`** returns `{ version: 1, closing_hold_guard: true }`. This
  is the explicit compatibility check. Contract code without the view (every deployed v3
  account) can't be managed: the capability is `unavailable` with reason `contract_upgrade`, and
  nothing claims a drain for it.
- **Evidence:**
  - Rust tests H-1 to H-4: new holds refused while Closing for the owner and the operator;
    `already` answered; settle, release and refund of an existing hold work while Closing; new
    holds work again after the close (successor meter) and after an abort;
  - the contract-produced fixture `gated-sale.json`: a close run and an abort run, with an
    `open_hold` refused while Closing;
  - parity in the TS doubles: `FixtureChain.openHold` and `SaleChain`.
  
  No deployment and no account creation.

### 16.2 Managed metering and mode (Q1)

- A Gated proposal or revision through `SaleActions` must grant METERING to the configured
  platform operator (`customer.operator_account`). Otherwise it is refused with
  `managed_meter_required`.
- Direct keeps its explicit omission and appointment workflow. The copy never suggests a Gated
  business can switch to Direct (the mode is fixed at construction).
- An alternate meter is outside this child.

### 16.3 Closer capability and arming without a signer (Q2, Q3)

**Capability.** It is ready for a business only when all of these hold:
- the config has a key for that binding;
- the key file parses;
- the contract's `closer` equals the configured account;
- `view_access_key` shows a **FunctionCall** permission with `receiver_id` equal to the
  binding's account and `method_names == ["close_sale"]`, and its allowance is `null`
  (unlimited) or at least `min_allowance_yocto`;
- `get_handover_terms` is present;
- no incompatible live peer (§16.9).

A full-access key is refused. Reasons are non-secret codes.

- **Refusing the closing acceptance.** `SaleActions` refuses the acceptance that would enter
  Closing (the second acceptance) with `handover_unavailable` and the reason, when the
  capability isn't ready.
- **Arming is keyless and independent of the coordinator.** `HandoverGate.arm(businessId,
  snapshot)` creates the `gated` row from any pinned control read showing this business's deal
  Closing. It is called from:
  - `CustomerUses.prepare` and `execute`, which read `control` at a pinned block anyway;
  - the sale setup read;
  - `V3Observations` recording (refresh and reconciliation reads);
  - the coordinator.
  
  So an externally entered Closing is gated at the latest when the next customer use reads the
  contract, with or without a configured closer.

### 16.4 Purchases (Q4)

Purchases stay available: their units carry over as contract obligations. While a business is
gated, the purchase review shows the pause ("New uses are paused while this business changes
hands; the units you buy stay yours"). Existing requested/unknown purchase recovery is
unchanged. Nothing implies the service is usable during the pause.

### 16.5 Abort (Q5)

- Only the parties' reviewed wallets send it (`SaleActions` kind `abort`, offered only once the
  reading shows the deadline passed). The closer's key stays `close_sale` only.
- After the deadline, the business stays **paused until the `aborted` outcome is confirmed**
  (§16.6). The deadline alone never reopens admission, and nothing claims an automatic abort.

### 16.6 D1: terminal outcome and current authority are separate facts

- **Ordering.** Every coordinator read goes through `V3Observations.record`. Only an
  `accepted` or `duplicate` result moves a handover, and only from a block at or above the
  handover's `evidence_height` (monotone per handover). A lower or `stale` read changes nothing,
  so a late pinned read can't clear a newer gate.
- **`released_to_seller`** requires, in one decision over one accepted snapshot S:
  - S's outcome ring has `aborted` for this `deal_seq`;
  - S's control owner is `seller_account` at `expected_generation`;
  - S shows no other live deal in Closing;
  - locally, `businesses.owner_id == seller_person_id` and the ownership-row count equals the
    intent's `local_epoch`.
  
  If S shows a **newer** live Closing deal, the old row ends (`ended`) and the new handover row
  is created **in the same transaction**, so the gate never opens in between. Any other
  mismatch is `attention`.
- **`released_to_buyer`** requires the reconciliation result `applied` or `already` **and** a
  local check that `owner_id == buyer_person_id` with an ownership row whose `v3_intent_id` is
  this intent. A reconciliation result of **`superseded` is not success.** It goes to
  `attention` (reason `superseded`).
- **Leaving `attention`** happens only by **current-authority reconciliation**. A fresh accepted
  snapshot shows no live Closing deal, and the chain owner's account maps locally to
  `businesses.owner_id`, at a local epoch consistent with the ownership rows. The row then
  becomes the terminal **`released_current`**, recording the current owner and generation as
  evidence. It never restores historical authority.
- **Tests:** a stale read after a newer gate; an aborted deal 1 with a newer Closing deal 2;
  away and back (closed, resold, closed again); `superseded` leading to attention and then
  `released_current`.

### 16.7 D2: finite logs that can't exhaust recovery

- **Coalesced current diagnostics.** The mutable status columns on the handover row
  (`check_ms`, `check_reason`, `check_counts`, `check_repeat`) are updated every pass. They
  aren't appended.
- **`handover_journal`** (immutable, append-only) holds at most `journal_cap` entries (default
  256). The last `journal_reserve` slots are kept for **must** kinds:
  - `armed`, `order_created`, `attempt_recorded`, `attempt_final`;
  - `outcome`, `reconciled`, `terminal`, `attention`.
  
  Ordinary kinds (a *changed* readiness failure reason, `takeover`) are written only while
  `count < cap − reserve`, and only when the reason differs from the previous ordinary entry.
- `journal_reserve ≥ 3 × max_orders + 8` is validated, so the bounded orders and their attempts
  always fit. If a must kind still finds the journal full, the transition **still happens**
  (status columns and state are authoritative), and `journal_full` is set.
- **`handover_evidence`** rows (immutable) are written only at transitions (`ready`, each
  order's pre-check, `outcome`, `terminal`). They are bounded by `2 × max_orders + 8`.
- **Test:** caps of 6 journal and 2 reserve, and 200 unchanged failing passes. The journal stays
  at its cap, and the final close or abort is still read, applied once and recorded.

### 16.8 D4: ready to administer versus ready to serve

- At `reconciled`, the gate opens, whether or not service is ready, so the new owner can fix
  what's missing.
- **Service readiness** is computed per active offer from the existing checks:
  - the runtime is available (`runtime.availability()`);
  - the release is still active;
  - the writer is configured;
  - protection is available;
  - the platform meter is granted at the **current** generation (latest accepted observation,
    `platformMeters`).
  
  It is shown with each precise reason ("Customer service: paused: no model provider is
  configured"). The UI never says "customers served" from the gate and the meter alone.
- **Tests:** a restart with the provider config removed shows `runtime_unavailable`, the
  owner's writes work, and service readiness updates after the provider is restored.

### 16.9 D3: deployment compatibility

- **Presence.** `process_presence` gains a nullable `capabilities` column (`ALTER TABLE ADD
  COLUMN`). This code writes `{"handover_gate":1}`. Rows written by older code have NULL.
- **Checks.** The coordinator checks presence at each pass **and inside the order-creation
  transaction**. Any live row (`until_ms > now`) without `handover_gate ≥ 1` means no order, and
  the capability reports `incompatible_peer`. A closing acceptance through `SaleActions` is
  refused the same way.
- **The guarantee is limited, and stated.**
  - The presence check detects 003wf1-or-later processes that don't know the gate.
  - A binary older than 003wf1 writes no presence, and **can't be detected**, so a writable
    SQLite file shared with an arbitrary old binary isn't protected by a marker.
  - **Operational prerequisite:** quiesce every incompatible process before enabling
    `handover`. The README and capability text say so. No host or administrative setup is done
    here.
- **Tests:** a live incompatible peer refuses orders; a peer appearing after validation is
  refused at the order transaction; a stale (expired) peer is ignored.

### 16.10 D5: app checks, conversations and preview issuance

- **App checks** (`appChecks.ts`, the worker): a report applies only under the same owner epoch
  and a live lease. So a check running across a close **can't publish** for the buyer (fenced),
  and its result stays with the seller's version.
  - The isolated engine stays off in every configured composition (capability `checks:
    unavailable`), so none can run there. The fence is proven with the existing synthetic engine
    in a service test (barrier at the report).
  - New check starts are gated.
- **Studio conversations** (`authoring.ts`) are build jobs (W14) whose proposals record
  `owner_epoch`. A running one is fenced like a build (its proposal is bound to the seller's
  epoch, so applying it as the buyer is refused). Applying a proposal is gated. Its cost stays in
  the build usage ledger, unknown until a receipt.
- **Preview issuance** writes `app_preview_tokens` with `owner_id`/`owner_generation`. Issuance
  is gated. Phase B checks that serving a token after the close is refused, by its generation,
  and adds that check if it's missing.
- **Tests:** service barriers for each (a check report after the close, a conversation build
  finishing after the close, a preview token issued before the close and used after).

### 16.11 D6: exact caller-visible pause facts

The `handover_pause` refusal carries `detail.unit` from the request's actual state:

| State | Message |
|---|---|
| `none` (new admission) | "New uses are paused while this business changes hands. Nothing was signed, held or charged." |
| `returning` (a reserved unit with a release requested or unknown) | "This business is changing hands, so your reserved use can't run now. Its unit is being returned; you weren't charged." |
| `returned` (proven) | "…Its unit was returned; you weren't charged." |
| `unknown` (settlement unknown) | "…We're confirming what happened to its unit; you'll see it here." |

The request keeps its id and history. "Returned" is said only after proof.

### 16.12 D7: lease validity includes expiry

Every coordinator write runs in BEGIN IMMEDIATE and requires `holder = me AND gen = mine AND
until_ms > now`. A holder whose lease has expired, even before anyone else claims it, writes
nothing.

Transactions already durably admitted can still land. Their attempt rows are resolved by their
own hash, and the contract outcome decides. They are never recorded as absent.

**Tests:** an expired lease with no takeover yet; a takeover; recovery of the original order
after a takeover.
